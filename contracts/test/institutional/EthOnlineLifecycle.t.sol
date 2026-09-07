// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

import {EthOnlineFixture} from "./EthOnlineFixture.sol";
import {InstitutionalFacility} from "../../src/institutional/InstitutionalFacility.sol";
import {FacilityDecision, FacilityOperation} from "../../src/institutional/interfaces/IFacilityDecisions.sol";
import {HederaAtsCollateralAdapter} from "../../src/institutional/adapters/HederaAtsCollateralAdapter.sol";
import {EthOnlineAuthorityVerifier} from "../../src/institutional/adapters/EthOnlineDecisionVerifiers.sol";

/// @title ETHOnline institutional lifecycle — replace eligible collateral without unwinding
/// @notice The canonical Phase 07 demo (§25) and its negative cases (§26, §40), run locally with
///         deterministic doubles that model each sponsor's real semantics:
///           Hedera ATS  — MockAtsSecurityToken + HederaAtsCollateralAdapter (Hold facet)
///           ENSv2       — an EAC evidence digest in EthOnlineAuthorityVerifier; revoke = revokeEnsRole
///           Privy       — an org-approver key signs the exact FacilityDecision
///           Chainlink   — a CRE reporter key signs the confidential policy verdict
contract EthOnlineLifecycleTest is EthOnlineFixture {
    bytes32 internal constant REQ = keccak256("ETHONLINE-SUBSTITUTION-1");

    function setUp() public {
        deployEthOnline();
    }

    // ---------------------------------------------------------------------------------
    // Positive: A -> B without unwinding the facility
    // ---------------------------------------------------------------------------------

    function test_substitutionAtoBSucceedsAndFacilityStaysActive() public {
        _activate();
        assertEq(adapterA.committedOf(address(facility)), 150_000e18, "A committed at activation");

        FacilityDecision memory d = _decision(FacilityOperation.SUBSTITUTE, ASSET_B, REF_B, REQ);
        _authorizeAndAllow(d); // Privy signs, CRE allows

        vm.prank(borrowerAcct);
        facility.requestSubstitution(REQ, address(adapterB), 150_000e18, d, d);

        // Replacement committed FIRST (ATS Hold on series B).
        vm.prank(borrowerAcct);
        facility.commitReplacement();
        assertEq(
            uint8(facility.substitution().state), uint8(InstitutionalFacility.SubState.REPLACEMENT_COMMITTED)
        );
        assertEq(adapterB.committedOf(address(facility)), 150_000e18, "B held before A released");
        assertEq(adapterA.committedOf(address(facility)), 150_000e18, "A still held at this point");

        // Only now does the old release become reachable.
        vm.prank(borrowerAcct);
        facility.releaseOld(REQ);

        assertEq(adapterA.committedOf(address(facility)), 0, "A released after B committed");
        assertEq(adapterB.committedOf(address(facility)), 150_000e18, "B is the facility's collateral");
        assertEq(ats.balanceOfByPartition(PART_A, borrowerAcct), 400_000e18, "A returned to the borrower");
        assertEq(
            uint8(facility.status()), uint8(InstitutionalFacility.Status.ACTIVE), "facility stays ACTIVE"
        );

        InstitutionalFacility.Collateral memory c = facility.collateral();
        assertEq(c.assetId, ASSET_B);
        assertEq(c.adapter, address(adapterB));
    }

    // ---------------------------------------------------------------------------------
    // Negative: A -> C is refused by a real sponsor control; A remains secured
    // ---------------------------------------------------------------------------------

    function test_ineligibleAtsAssetCannotReleaseTheOldCollateral() public {
        _activate();
        // The borrower is not accredited for series C — a real ATS per-partition transfer
        // restriction. The commit's `canTransferByPartition` check fails, so the replacement is
        // never held and the old collateral is never released.
        FacilityDecision memory d = _decision(FacilityOperation.SUBSTITUTE, ASSET_C, REF_C, REQ);
        _authorizeAndAllow(d);

        vm.prank(borrowerAcct);
        facility.requestSubstitution(REQ, address(adapterC), 150_000e18, d, d);

        vm.prank(borrowerAcct);
        vm.expectRevert(); // HederaAtsCollateralAdapter.ComplianceRejected
        facility.commitReplacement();

        assertEq(
            uint8(facility.status()),
            uint8(InstitutionalFacility.Status.SUBSTITUTION_PENDING),
            "still pending, nothing released"
        );
        assertEq(adapterC.committedOf(address(facility)), 0, "C never committed");
        assertEq(adapterA.committedOf(address(facility)), 150_000e18, "A remains committed and secured");

        // The borrower can cancel the stuck request; A is still fully secured.
        vm.prank(borrowerAcct);
        facility.cancelSubstitution();
        assertEq(uint8(facility.status()), uint8(InstitutionalFacility.Status.ACTIVE));
        assertEq(adapterA.committedOf(address(facility)), 150_000e18, "A still secured after cancel");
    }

    function test_creDenyBlocksTheSubstitution() public {
        _activate();
        FacilityDecision memory d = _decision(FacilityOperation.SUBSTITUTE, ASSET_B, REF_B, REQ);

        // Privy approves, but CRE returns DENY on the confidential policy.
        vm.prank(relayer);
        authorityV.submitApproval(d, ENS_DIGEST, _privySign(d, ENS_DIGEST));
        uint64 exp = uint64(block.timestamp + 30 minutes);
        vm.prank(relayer);
        policyV.submitVerdict(
            d,
            false,
            POLICY_COMMITMENT,
            CRE_WORKFLOW_VERSION,
            "POLICY_EXCLUDED_SECTOR",
            exp,
            _creSign(d, false, "POLICY_EXCLUDED_SECTOR", exp)
        );

        vm.prank(borrowerAcct);
        vm.expectRevert(); // IPolicyVerifier.verify returns false -> DecisionRejected
        facility.requestSubstitution(REQ, address(adapterB), 150_000e18, d, d);
        assertEq(adapterA.committedOf(address(facility)), 150_000e18, "A remains committed");
    }

    function test_missingPrivyApprovalBlocksTheSubstitution() public {
        _activate();
        FacilityDecision memory d = _decision(FacilityOperation.SUBSTITUTE, ASSET_B, REF_B, REQ);
        // CRE allows, but no Privy org approval was submitted.
        uint64 exp = uint64(block.timestamp + 30 minutes);
        vm.prank(relayer);
        policyV.submitVerdict(
            d,
            true,
            POLICY_COMMITMENT,
            CRE_WORKFLOW_VERSION,
            "ELIGIBLE",
            exp,
            _creSign(d, true, "ELIGIBLE", exp)
        );

        vm.prank(borrowerAcct);
        vm.expectRevert();
        facility.requestSubstitution(REQ, address(adapterB), 150_000e18, d, d);
    }

    function test_ensRoleRevokedMidFlightBlocksReleaseButNotAHistoricalOne() public {
        _activate();

        // First substitution A -> B completes while the ENS role is valid.
        FacilityDecision memory d1 = _decision(FacilityOperation.SUBSTITUTE, ASSET_B, REF_B, REQ);
        _authorizeAndAllow(d1);
        vm.startPrank(borrowerAcct);
        facility.requestSubstitution(REQ, address(adapterB), 150_000e18, d1, d1);
        facility.commitReplacement();
        facility.releaseOld(REQ);
        vm.stopPrank();
        assertEq(
            adapterB.committedOf(address(facility)),
            150_000e18,
            "B is now the collateral (historical substitution valid)"
        );

        // Now the org revokes the EAC role on Sepolia. A NEW substitution B -> A is opened and
        // committed, then the role is revoked before release.
        bytes32 req2 = keccak256("SUB-2");
        FacilityDecision memory d2 = _decision(FacilityOperation.SUBSTITUTE, ASSET_A, REF_A, req2);
        _authorizeAndAllow(d2);
        vm.startPrank(borrowerAcct);
        facility.requestSubstitution(req2, address(adapterA), 150_000e18, d2, d2);
        facility.commitReplacement();
        vm.stopPrank();

        bytes32 fid = facility.facilityId();
        vm.prank(governance);
        authorityV.revokeEnsRole(fid);

        vm.prank(borrowerAcct);
        vm.expectRevert(InstitutionalFacility.AuthorityStale.selector);
        facility.releaseOld(req2);

        // B (the collateral from the completed historical substitution) is untouched; the new,
        // now-unauthorised substitution cannot release it.
        assertEq(adapterB.committedOf(address(facility)), 150_000e18, "historical collateral stays secured");
    }

    // ---------------------------------------------------------------------------------
    // Privy approval must bind the exact decision (§17)
    // ---------------------------------------------------------------------------------

    function test_privyApprovalForAnotherReplacementCannotAuthorizeThisOne() public {
        _activate();
        // Org signs an approval for replacement B...
        FacilityDecision memory dB = _decision(FacilityOperation.SUBSTITUTE, ASSET_B, REF_B, REQ);
        vm.prank(relayer);
        authorityV.submitApproval(dB, ENS_DIGEST, _privySign(dB, ENS_DIGEST));

        // ...but the request is for a decision describing replacement A. Its hash differs, so no
        // approval is on file for it.
        FacilityDecision memory dA = _decision(FacilityOperation.SUBSTITUTE, ASSET_A, REF_A, REQ);
        uint64 exp = uint64(block.timestamp + 30 minutes);
        vm.prank(relayer);
        policyV.submitVerdict(
            dA,
            true,
            POLICY_COMMITMENT,
            CRE_WORKFLOW_VERSION,
            "ELIGIBLE",
            exp,
            _creSign(dA, true, "ELIGIBLE", exp)
        );

        vm.prank(borrowerAcct);
        vm.expectRevert();
        facility.requestSubstitution(REQ, address(adapterA), 150_000e18, dA, dA);
    }

    function test_aStaleNonceApprovalCannotBeResubmitted() public {
        _activate();
        FacilityDecision memory d1 = _decision(FacilityOperation.SUBSTITUTE, ASSET_B, REF_B, REQ);
        vm.prank(relayer);
        authorityV.submitApproval(d1, ENS_DIGEST, _privySign(d1, ENS_DIGEST));

        // A second decision for the same (facility, SUBSTITUTE) with a lower/equal nonce is refused.
        FacilityDecision memory dStale = d1;
        dStale.requestId = keccak256("REQ-STALE");
        dStale.nonce = d1.nonce; // not greater
        vm.prank(relayer);
        vm.expectRevert(
            abi.encodeWithSelector(EthOnlineAuthorityVerifier.StaleNonce.selector, dStale.nonce, d1.nonce)
        );
        authorityV.submitApproval(dStale, ENS_DIGEST, _privySign(dStale, ENS_DIGEST));
    }

    function test_expiredPrivyApprovalIsRejectedAtSubmission() public {
        _activate();
        FacilityDecision memory d = _decision(FacilityOperation.SUBSTITUTE, ASSET_B, REF_B, REQ);
        d.expiry = uint64(block.timestamp); // already expired
        vm.prank(relayer);
        vm.expectRevert(EthOnlineAuthorityVerifier.DecisionExpired.selector);
        authorityV.submitApproval(d, ENS_DIGEST, _privySign(d, ENS_DIGEST));
    }

    function test_privyApprovalWithAWrongEnsDigestIsRejected() public {
        FacilityDecision memory d = _decision(FacilityOperation.SUBSTITUTE, ASSET_B, REF_B, REQ);
        vm.prank(relayer);
        vm.expectRevert(EthOnlineAuthorityVerifier.EnsDigestMismatch.selector);
        authorityV.submitApproval(
            d, keccak256("some-other-role"), _privySign(d, keccak256("some-other-role"))
        );
    }

    function test_replayedPrivyApprovalAcrossFacilitiesFails() public {
        // A decision bound to this facilityId cannot be reused: submitApproval reads
        // facilityAuthority[d.facilityId], and verify() re-checks the binding + decision hash.
        FacilityDecision memory d = _decision(FacilityOperation.SUBSTITUTE, ASSET_B, REF_B, REQ);
        d.facilityId = keccak256("SOME-OTHER-FACILITY");
        vm.prank(relayer);
        vm.expectRevert(
            abi.encodeWithSelector(EthOnlineAuthorityVerifier.NotConfigured.selector, d.facilityId)
        );
        authorityV.submitApproval(d, ENS_DIGEST, _privySign(d, ENS_DIGEST));
    }

    // ---------------------------------------------------------------------------------
    // Sponsor removal regressions (§26)
    // ---------------------------------------------------------------------------------

    function test_removal_hedera_noReplacementCommitmentMeansNoRelease() public {
        _activate();
        FacilityDecision memory d = _decision(FacilityOperation.SUBSTITUTE, ASSET_B, REF_B, REQ);
        _authorizeAndAllow(d);
        vm.prank(borrowerAcct);
        facility.requestSubstitution(REQ, address(adapterB), 150_000e18, d, d);
        // The ATS adapter is "unavailable": mark it reconciling so canCommit fails.
        adapterB.setReconciliationPending(true);
        vm.prank(borrowerAcct);
        facility.commitReplacement();
        assertEq(
            uint8(facility.substitution().state),
            uint8(InstitutionalFacility.SubState.NONE),
            "rejected, no commit"
        );
        assertEq(adapterA.committedOf(address(facility)), 150_000e18, "A stays secured");
    }

    function test_removal_cre_absentVerdictCannotDefaultAllow() public {
        _activate();
        FacilityDecision memory d = _decision(FacilityOperation.SUBSTITUTE, ASSET_B, REF_B, REQ);
        vm.prank(relayer);
        authorityV.submitApproval(d, ENS_DIGEST, _privySign(d, ENS_DIGEST));
        // No CRE verdict submitted at all.
        vm.prank(borrowerAcct);
        vm.expectRevert();
        facility.requestSubstitution(REQ, address(adapterB), 150_000e18, d, d);
    }

    // ---------------------------------------------------------------------------------
    // No silent fallback (§27)
    // ---------------------------------------------------------------------------------

    function test_noFallbackSigner_wrongKeyIsRejected() public {
        FacilityDecision memory d = _decision(FacilityOperation.SUBSTITUTE, ASSET_B, REF_B, REQ);
        // Sign with the CRE key instead of the org key.
        bytes32 signed = keccak256(abi.encode("USANCE_ORG_APPROVAL_V1", _hash(d), ENS_DIGEST));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(creReporterPk, signed);
        vm.prank(relayer);
        vm.expectRevert(); // WrongSigner
        authorityV.submitApproval(d, ENS_DIGEST, abi.encodePacked(r, s, v));
    }

    function _hash(FacilityDecision memory d) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                "USANCE_FACILITY_DECISION_V1",
                d.facilityId,
                d.operation,
                d.subjectAssetId,
                d.subjectInstrumentRef,
                d.requestId,
                d.pinnedEpoch,
                d.collateralPolicyVersion,
                d.decisionVersion,
                d.expiry,
                d.nonce,
                d.proofRef,
                d.attestationHash
            )
        );
    }
}

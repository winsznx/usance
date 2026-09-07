// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

import {Fixture} from "../Fixture.sol";
import {Types} from "../../src/libraries/Types.sol";
import {MockERC20, MockAggregator} from "../mocks/Mocks.sol";

import {FacilityValuation} from "../../src/institutional/FacilityValuation.sol";
import {InstitutionalFacility} from "../../src/institutional/InstitutionalFacility.sol";
import {
    DecisionBinding,
    FacilityDecision,
    FacilityDecisionLib,
    FacilityOperation
} from "../../src/institutional/interfaces/IFacilityDecisions.sol";
import {HederaAtsCollateralAdapter} from "../../src/institutional/adapters/HederaAtsCollateralAdapter.sol";
import {IAtsHold} from "../../src/institutional/adapters/IAtsHold.sol";
import {
    EthOnlineAuthorityVerifier,
    EthOnlinePolicyVerifier
} from "../../src/institutional/adapters/EthOnlineDecisionVerifiers.sol";
import {MockAtsSecurityToken} from "./mocks/MockAtsSecurityToken.sol";

/// @notice The ETHOnline institutional lifecycle wired end to end: a Hedera-ATS-fronted facility
///         whose substitution authority is a Privy-signed org approval bound to an ENSv2 EAC
///         evidence digest, and whose policy gate is a Chainlink-CRE-signed confidential verdict.
///         Every external system is a deterministic double that models its real semantics.
abstract contract EthOnlineFixture is Fixture {
    using FacilityDecisionLib for FacilityDecision;

    FacilityValuation internal fval;
    EthOnlineAuthorityVerifier internal authorityV;
    EthOnlinePolicyVerifier internal policyV;
    InstitutionalFacility internal facility;

    MockAtsSecurityToken internal ats; // one ATS token, three partitions A / B / C
    bytes32 internal constant PART_A = "SERIES-A";
    bytes32 internal constant PART_B = "SERIES-B";
    bytes32 internal constant PART_C = "SERIES-C";

    HederaAtsCollateralAdapter internal adapterA;
    HederaAtsCollateralAdapter internal adapterB;
    HederaAtsCollateralAdapter internal adapterC;

    bytes32 internal ASSET_A;
    bytes32 internal ASSET_B;
    bytes32 internal ASSET_C;
    bytes32 internal constant REF_A = keccak256("hedera:ATS:SERIES-A");
    bytes32 internal constant REF_B = keccak256("hedera:ATS:SERIES-B");
    bytes32 internal constant REF_C = keccak256("hedera:ATS:SERIES-C");

    bytes32 internal constant HOME_DOMAIN = keccak256("USANCE_DOMAIN_V1:hedera:testnet");
    bytes32 internal constant DISCRIMINATOR = keccak256("ETHONLINE-FACILITY-1");
    bytes32 internal constant ENS_DIGEST = keccak256("ensv2:facility-1.acme.usance.eth#COLLATERAL_OPS@block");
    bytes32 internal constant POLICY_COMMITMENT = keccak256("lender-acme:confidential-policy:v3");
    uint32 internal constant CRE_WORKFLOW_VERSION = 3;

    address internal borrowerAcct = address(0xB0B);
    address internal lenderAcct = address(0x1EDD);
    address internal operatorAcct = address(0x09E7);
    address internal treasuryAcct = address(0x7EA5);
    address internal relayer = address(0x521A1);

    uint256 internal orgApproverPk = 0xA11CE;
    address internal orgApprover; // the Privy-controlled signer
    uint256 internal creReporterPk = 0xC1E0;
    address internal creReporter; // the CRE DON / relayer report signer

    uint256 internal constant PRINCIPAL = 100_000e6;
    uint16 internal constant RATE_BPS = 400;
    uint16 internal constant ORIG_FEE_BPS = 20;

    function deployEthOnline() internal {
        deployProtocol();
        orgApprover = vm.addr(orgApproverPk);
        creReporter = vm.addr(creReporterPk);

        ats = new MockAtsSecurityToken();

        // Three ATS collateral series, registered in the core registries so FacilityValuation can
        // price and recognise them (same policy as USTB). A and B holders are ATS-compliant; C's
        // holder is not — that is the negative lifecycle.
        ASSET_A = _registerSeries(keccak256("US-TBILL-A"));
        ASSET_B = _registerSeries(keccak256("US-TBILL-B"));
        ASSET_C = _registerSeries(keccak256("US-TBILL-C"));

        address holdDest = makeAddr("hederaHoldDestination");
        adapterA = new HederaAtsCollateralAdapter(
            IAtsHold(address(ats)), PART_A, REF_A, ASSET_A, 18, holdDest, address(this)
        );
        adapterB = new HederaAtsCollateralAdapter(
            IAtsHold(address(ats)), PART_B, REF_B, ASSET_B, 18, holdDest, address(this)
        );
        adapterC = new HederaAtsCollateralAdapter(
            IAtsHold(address(ats)), PART_C, REF_C, ASSET_C, 18, holdDest, address(this)
        );

        fval = new FacilityValuation(oracle, policyReg, assetsReg, passportReg);
        authorityV = new EthOnlineAuthorityVerifier(governance);
        policyV = new EthOnlinePolicyVerifier(governance);

        InstitutionalFacility.Terms memory t = InstitutionalFacility.Terms({
            homeDomainId: HOME_DOMAIN,
            discriminator: DISCRIMINATOR,
            borrower: borrowerAcct,
            lender: lenderAcct,
            operator: operatorAcct,
            treasury: treasuryAcct,
            settlementToken: usdc,
            settlementAssetId: USDC_ID,
            settlementDecimals: 6,
            principalLimit: PRINCIPAL,
            maturityAt: uint64(block.timestamp + 365 days),
            interestRateBps: RATE_BPS,
            originationFeeBps: ORIG_FEE_BPS,
            feePolicyVersion: 1,
            collateralPolicyId: POLICY_TBILL,
            initialCollateralAssetId: ASSET_A,
            initialCollateralAdapter: address(adapterA),
            settlementMaxPriceAge: SETTLEMENT_MAX_PRICE_AGE,
            recallGracePeriod: 7 days,
            maturityGracePeriod: 3 days
        });
        facility = new InstitutionalFacility(authority, fval, policyReg, authorityV, policyV, t);

        adapterA.bindFacility(address(facility));
        adapterB.bindFacility(address(facility));
        adapterC.bindFacility(address(facility));

        vm.startPrank(governance);
        authorityV.configureFacility(facility.facilityId(), orgApprover, ENS_DIGEST);
        policyV.configureFacility(facility.facilityId(), creReporter, POLICY_COMMITMENT, CRE_WORKFLOW_VERSION);
        vm.stopPrank();

        // ATS balances + compliance. The borrower holds all three series and is globally KYC'd,
        // but is NOT accredited for series C (a real ATS per-partition transfer restriction) —
        // that is the negative lifecycle: an ineligible replacement cannot be committed.
        ats.setCompliant(borrowerAcct, true);
        ats.setCompliant(holdDest, true);
        ats.mint(PART_A, borrowerAcct, 400_000e18);
        ats.mint(PART_B, borrowerAcct, 400_000e18);
        ats.mint(PART_C, borrowerAcct, 400_000e18);
        ats.setPartitionBlocked(PART_C, borrowerAcct, true);

        usdc.mint(lenderAcct, PRINCIPAL);
    }

    /// @dev One Usance financial `assetId` per ATS partition/series. `AssetRegistry.registerAsset`
    ///      keys on `keccak(chainId, token)`, so three partitions of one ATS token need three
    ///      registration vehicles; on Hedera each series gets its own registered id. The
    ///      registration token is never moved — custody is the ATS token, via the adapter.
    function _registerSeries(bytes32 underlying) internal returns (bytes32 id) {
        MockERC20 wrap = new MockERC20("ATS series", "ATS", 18);
        vm.prank(admission);
        id = assetsReg.registerAsset(block.chainid, address(wrap), underlying, 18);

        MockAggregator feed = new MockAggregator(8, "ATS / USD", 1e8, block.timestamp);
        vm.startPrank(governance);
        oracle.setFeed(id, address(feed));
        assetsReg.bindRiskPolicy(id, POLICY_TBILL);
        vm.stopPrank();

        vm.startPrank(admission);
        (bytes32[] memory ev, bytes32 root) = _fileEvidence(id, string(abi.encodePacked("ATS_", underlying)));
        passportReg.commitPassport(
            id, 1, ev, root, keccak256(abi.encodePacked("ATS_CLAIMS", underlying)), 0, true, 9900, false
        );
        assetsReg.setCapabilities(
            id, uint16(1) << uint16(Types.Capability.HOLD) | uint16(1) << uint16(Types.Capability.COLLATERAL)
        );
        vm.stopPrank();
        vm.prank(governance);
        assetsReg.setStatus(id, Types.AssetStatus.ACTIVE);
    }

    // ---- decision + signature helpers ----

    uint64 internal nonceCounter = 1;

    function _decision(FacilityOperation op, bytes32 subjectAssetId, bytes32 subjectRef, bytes32 requestId)
        internal
        returns (FacilityDecision memory d)
    {
        d.facilityId = facility.facilityId();
        d.operation = op;
        d.subjectAssetId = subjectAssetId;
        d.subjectInstrumentRef = subjectRef;
        d.requestId = requestId;
        d.pinnedEpoch = policyReg.riskEpoch();
        d.collateralPolicyVersion = policyReg.riskEpoch();
        d.decisionVersion = 1;
        d.expiry = uint64(block.timestamp + 1 hours);
        d.nonce = nonceCounter++; // strictly monotone; the verifiers require it (§17 replay defence)
        d.proofRef = keccak256(abi.encode("proof", op, requestId));
        d.attestationHash = keccak256(abi.encode("attestation", d.proofRef));
    }

    function _privySign(FacilityDecision memory d, bytes32 ensDigest) internal view returns (bytes memory) {
        bytes32 signed = keccak256(abi.encode("USANCE_ORG_APPROVAL_V1", d.hash(), ensDigest));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(orgApproverPk, signed);
        return abi.encodePacked(r, s, v);
    }

    function _creSign(FacilityDecision memory d, bool allow, bytes32 reason, uint64 expiry)
        internal
        view
        returns (bytes memory)
    {
        bytes32 signed = keccak256(
            abi.encode(
                "USANCE_CRE_POLICY_V1",
                d.hash(),
                allow,
                POLICY_COMMITMENT,
                CRE_WORKFLOW_VERSION,
                reason,
                expiry
            )
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(creReporterPk, signed);
        return abi.encodePacked(r, s, v);
    }

    /// @notice The full external authority path for one decision: Privy signs, CRE allows, the
    ///         relayer submits both.
    function _authorizeAndAllow(FacilityDecision memory d) internal {
        vm.prank(relayer);
        authorityV.submitApproval(d, ENS_DIGEST, _privySign(d, ENS_DIGEST));
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
    }

    function _activate() internal {
        vm.startPrank(lenderAcct);
        usdc.approve(address(facility), PRINCIPAL);
        facility.fund();
        vm.stopPrank();
        vm.prank(borrowerAcct);
        facility.commitInitialCollateral(150_000e18);

        FacilityDecision memory d = _decision(FacilityOperation.ACTIVATE, ASSET_A, REF_A, bytes32(0));
        _authorizeAndAllow(d);
        vm.prank(lenderAcct);
        facility.activate(d, d);
    }
}

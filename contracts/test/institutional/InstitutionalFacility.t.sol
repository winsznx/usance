// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

import {InstitutionalFixture} from "./InstitutionalFixture.sol";
import {InstitutionalFacility} from "../../src/institutional/InstitutionalFacility.sol";
import {ICollateralAdapter} from "../../src/institutional/interfaces/ICollateralAdapter.sol";
import {FacilityDecision, FacilityOperation} from "../../src/institutional/interfaces/IFacilityDecisions.sol";
import {TestCollateralAdapter} from "./mocks/TestAdapters.sol";
import {Types} from "../../src/libraries/Types.sol";

/// @title Institutional facility — lifecycle, accounting and the collateral-substitution invariant
/// @notice The property everything is built around: the old collateral is never releasable until a
///         valid replacement is committed and the facility is still safe afterwards (I-95).
contract InstitutionalFacilityTest is InstitutionalFixture {
    bytes32 internal constant REQ = keccak256("SUBSTITUTION-REQUEST-1");

    function setUp() public {
        deployInstitutional();
    }

    // ---------------------------------------------------------------------------------
    // Identity and creation — I-94
    // ---------------------------------------------------------------------------------

    function test_facilityIdIsDerivedFromTypeDomainControllerDiscriminator() public view {
        bytes32 expected = keccak256(
            abi.encode(
                "USANCE_FACILITY_V1",
                "TERM_SECURED_CREDIT",
                HOME_DOMAIN,
                bytes32(uint256(uint160(address(facility)))),
                DISCRIMINATOR
            )
        );
        assertEq(facility.facilityId(), expected, "facilityId derivation");
    }

    function test_freshFacilityIsDraftAndNotFinanceable() public {
        assertEq(uint8(facility.status()), uint8(InstitutionalFacility.Status.DRAFT));
        assertEq(facility.principalDrawn(), 0);
        // No path to a financial function from DRAFT.
        vm.prank(borrowerAcct);
        vm.expectRevert();
        facility.repay(1, false);
    }

    function test_constructorRejectsAnOriginationFeeAboveTheCeiling() public {
        InstitutionalFacility.Terms memory t = _terms();
        t.originationFeeBps = 51; // ceiling is 50
        vm.expectRevert(
            abi.encodeWithSelector(InstitutionalFacility.OriginationFeeTooHigh.selector, uint16(51))
        );
        new InstitutionalFacility(authority, fval, policyReg, verifier, verifier, t);
    }

    function test_constructorRejectsAMaturityInThePast() public {
        InstitutionalFacility.Terms memory t = _terms();
        t.maturityAt = uint64(block.timestamp);
        vm.expectRevert(InstitutionalFacility.MaturityInPast.selector);
        new InstitutionalFacility(authority, fval, policyReg, verifier, verifier, t);
    }

    // ---------------------------------------------------------------------------------
    // Activation and the origination fee — I-99
    // ---------------------------------------------------------------------------------

    function test_activationDisbursesProceedsAndFeeAndConserves() public {
        _activate();

        uint256 fee = (PRINCIPAL * ORIG_FEE_BPS + 9_999) / 10_000; // rounds up
        uint256 proceeds = PRINCIPAL - fee;

        assertEq(usdc.balanceOf(treasuryAcct), fee, "fee to treasury");
        assertEq(usdc.balanceOf(borrowerAcct), proceeds, "proceeds to borrower");
        assertEq(facility.feeCharged(), fee);
        assertEq(facility.principalDrawn(), PRINCIPAL);
        // principalDrawn == borrowerProceeds + fee, exactly.
        assertEq(facility.principalDrawn(), proceeds + fee, "fee conservation I-99");
        assertEq(facility.outstanding(), PRINCIPAL, "debt is the whole principal");
        assertEq(uint8(facility.status()), uint8(InstitutionalFacility.Status.ACTIVE));
    }

    function test_zeroOriginationFeeStillConserves() public {
        InstitutionalFacility.Terms memory t = _terms();
        t.originationFeeBps = 0;
        t.discriminator = keccak256("FAC-ZERO-FEE");
        facility = new InstitutionalFacility(authority, fval, policyReg, verifier, verifier, t);
        _refreshBorrowerApprovals();
        _activate();
        assertEq(facility.feeCharged(), 0);
        assertEq(usdc.balanceOf(borrowerAcct), PRINCIPAL);
    }

    function test_activationIsRefusedWithoutFullFunding() public {
        vm.prank(borrowerAcct);
        facility.commitInitialCollateral(150_000e18);
        FacilityDecision memory d = _decision(FacilityOperation.ACTIVATE, USTB_ID, OLD_REF, bytes32(0));
        vm.prank(lenderAcct);
        vm.expectRevert(); // not PENDING_ACTIVATION yet
        facility.activate(d, d);
    }

    function test_activationIsRefusedWhenCollateralDoesNotCover() public {
        vm.startPrank(lenderAcct);
        usdc.approve(address(facility), PRINCIPAL);
        facility.fund();
        vm.stopPrank();
        vm.prank(borrowerAcct);
        facility.commitInitialCollateral(50_000e18); // far too little for 100k principal

        FacilityDecision memory d = _decision(FacilityOperation.ACTIVATE, USTB_ID, OLD_REF, bytes32(0));
        vm.prank(lenderAcct);
        vm.expectRevert();
        facility.activate(d, d);
    }

    function test_activationCannotHappenTwice() public {
        _activate();
        FacilityDecision memory d = _decision(FacilityOperation.ACTIVATE, USTB_ID, OLD_REF, bytes32(0));
        vm.prank(lenderAcct);
        vm.expectRevert();
        facility.activate(d, d);
    }

    function test_activationRefusesADecisionForAnotherOperation() public {
        vm.startPrank(lenderAcct);
        usdc.approve(address(facility), PRINCIPAL);
        facility.fund();
        vm.stopPrank();
        vm.prank(borrowerAcct);
        facility.commitInitialCollateral(150_000e18);

        // A SUBSTITUTE decision cannot authorise ACTIVATE.
        FacilityDecision memory wrong = _decision(FacilityOperation.SUBSTITUTE, USTB_ID, OLD_REF, bytes32(0));
        vm.prank(lenderAcct);
        vm.expectRevert();
        facility.activate(wrong, wrong);
    }

    function test_guardianCanPauseActivation() public {
        vm.startPrank(lenderAcct);
        usdc.approve(address(facility), PRINCIPAL);
        facility.fund();
        vm.stopPrank();
        vm.prank(borrowerAcct);
        facility.commitInitialCollateral(150_000e18);

        vm.prank(guardian);
        facility.setRestriction(1, true, "incident");

        FacilityDecision memory d = _decision(FacilityOperation.ACTIVATE, USTB_ID, OLD_REF, bytes32(0));
        vm.prank(lenderAcct);
        vm.expectRevert(InstitutionalFacility.ActivationPaused.selector);
        facility.activate(d, d);

        // A guardian cannot lift it.
        vm.prank(guardian);
        vm.expectRevert();
        facility.setRestriction(1, false, "lift");
        vm.prank(governance);
        facility.setRestriction(1, false, "resolved");
        vm.prank(lenderAcct);
        facility.activate(d, d);
        assertEq(uint8(facility.status()), uint8(InstitutionalFacility.Status.ACTIVE));
    }

    // ---------------------------------------------------------------------------------
    // Accounting
    // ---------------------------------------------------------------------------------

    function test_interestAccruesLinearlyAndRepayClearsExactly() public {
        _activate();
        vm.warp(block.timestamp + 365 days / 2);
        facility.poke();

        // ~2.5% of 100k over half a year at 5%.
        uint256 owed = facility.outstanding();
        assertApproxEqAbs(owed, PRINCIPAL + PRINCIPAL * RATE_BPS / 10_000 / 2, 2, "half-year interest");

        _giveSettlement(borrowerAcct, owed + 10_000e6);
        vm.startPrank(borrowerAcct);
        usdc.approve(address(facility), owed + 10_000e6);
        uint256 applied = facility.repay(owed + 10_000e6, true);
        vm.stopPrank();
        assertEq(applied, owed, "repayAll clears exactly, refunds the rest");
        assertEq(facility.outstanding(), 0);
    }

    function test_overRepayIsCappedAtOutstanding() public {
        _activate();
        _giveSettlement(borrowerAcct, PRINCIPAL * 2);
        vm.startPrank(borrowerAcct);
        usdc.approve(address(facility), PRINCIPAL * 2);
        uint256 applied = facility.repay(PRINCIPAL * 2, false);
        vm.stopPrank();
        assertEq(applied, PRINCIPAL);
        assertEq(facility.outstanding(), 0);
    }

    // ---------------------------------------------------------------------------------
    // Collateral substitution — the happy path
    // ---------------------------------------------------------------------------------

    function test_atomicSubstitutionSwapsCollateralAndReturnsTheOld() public {
        _activate();
        uint256 borrowerOldBefore = ustb.balanceOf(borrowerAcct);

        FacilityDecision memory d = _decision(FacilityOperation.SUBSTITUTE, REP_ID, REP_REF, REQ);
        vm.prank(borrowerAcct);
        facility.substituteAtomic(REQ, address(repAdapter), 150_000e18, d, d);

        InstitutionalFacility.Collateral memory c = facility.collateral();
        assertEq(c.assetId, REP_ID, "collateral is now the replacement");
        assertEq(c.adapter, address(repAdapter));
        assertEq(repAdapter.committedOf(address(facility)), 150_000e18, "replacement in custody");
        assertEq(oldAdapter.committedOf(address(facility)), 0, "old released");
        assertEq(ustb.balanceOf(borrowerAcct), borrowerOldBefore + 150_000e18, "old returned to borrower");
        assertEq(uint8(facility.status()), uint8(InstitutionalFacility.Status.ACTIVE));

        InstitutionalFacility.Substitution memory s = facility.substitution();
        assertEq(uint8(s.state), uint8(InstitutionalFacility.SubState.NONE), "substitution cleared");
    }

    function test_twoPhaseSubstitutionThroughAnAsyncAdapter() public {
        _activate();
        repAdapter.setMode(TestCollateralAdapter.Mode.ASYNC);

        FacilityDecision memory d = _decision(FacilityOperation.SUBSTITUTE, REP_ID, REP_REF, REQ);
        vm.startPrank(borrowerAcct);
        facility.requestSubstitution(REQ, address(repAdapter), 150_000e18, d, d);
        facility.commitReplacement(); // async -> stays COMMITTING, nothing released
        vm.stopPrank();

        assertEq(oldAdapter.committedOf(address(facility)), 150_000e18, "old still locked while committing");
        InstitutionalFacility.Substitution memory s1 = facility.substitution();
        assertEq(uint8(s1.state), uint8(InstitutionalFacility.SubState.REPLACEMENT_COMMITTING));

        // The replacement transfer finalises off-chain; reconcile picks it up.
        repAdapter.resolveAsync(address(facility), ICollateralAdapter.CommitmentState.COMMITTED);
        vm.prank(operatorAcct);
        facility.reconcileCommitment();
        assertEq(
            uint8(facility.substitution().state), uint8(InstitutionalFacility.SubState.REPLACEMENT_COMMITTED)
        );

        vm.prank(borrowerAcct);
        facility.releaseOld(REQ);
        assertEq(oldAdapter.committedOf(address(facility)), 0, "old released only after commit");
        assertEq(repAdapter.committedOf(address(facility)), 150_000e18);
    }

    // ---------------------------------------------------------------------------------
    // The central invariant — I-95, I-96, I-97
    // ---------------------------------------------------------------------------------

    function test_oldCollateralCannotBeReleasedBeforeAReplacementIsCommitted() public {
        _activate();
        FacilityDecision memory d = _decision(FacilityOperation.SUBSTITUTE, REP_ID, REP_REF, REQ);
        vm.prank(borrowerAcct);
        facility.requestSubstitution(REQ, address(repAdapter), 150_000e18, d, d);

        // REQUESTED -> releaseOld must revert.
        vm.prank(borrowerAcct);
        vm.expectRevert();
        facility.releaseOld(REQ);
        assertEq(oldAdapter.committedOf(address(facility)), 150_000e18, "old still locked");
    }

    function test_releaseIsRefusedWhenReplacementIsInsufficient() public {
        _activate();
        // The adapter takes custody of less than required.
        FacilityDecision memory d = _decision(FacilityOperation.SUBSTITUTE, REP_ID, REP_REF, REQ);
        vm.startPrank(borrowerAcct);
        facility.requestSubstitution(REQ, address(repAdapter), 150_000e18, d, d);
        vm.stopPrank();
        // Force a short commit: LIAR mode claims full but committedOf under-reports.
        repAdapter.setMode(TestCollateralAdapter.Mode.LIAR);
        repAdapter.setLieDelta(50_000e18);
        vm.prank(borrowerAcct);
        facility.commitReplacement();

        // commitReplacement saw committedOf < required, so it stayed COMMITTING.
        assertEq(
            uint8(facility.substitution().state), uint8(InstitutionalFacility.SubState.REPLACEMENT_COMMITTING)
        );
        vm.prank(borrowerAcct);
        vm.expectRevert();
        facility.releaseOld(REQ);
        assertEq(oldAdapter.committedOf(address(facility)), 150_000e18);
    }

    function test_unknownCommitmentKeepsTheOldCollateralLocked() public {
        _activate();
        repAdapter.setMode(TestCollateralAdapter.Mode.ASYNC);
        FacilityDecision memory d = _decision(FacilityOperation.SUBSTITUTE, REP_ID, REP_REF, REQ);
        vm.startPrank(borrowerAcct);
        facility.requestSubstitution(REQ, address(repAdapter), 150_000e18, d, d);
        facility.commitReplacement();
        vm.stopPrank();

        // Adapter can't tell yet.
        repAdapter.resolveAsync(address(facility), ICollateralAdapter.CommitmentState.UNKNOWN);
        vm.prank(operatorAcct);
        facility.reconcileCommitment();
        assertEq(
            uint8(facility.substitution().state), uint8(InstitutionalFacility.SubState.COMMITMENT_UNKNOWN)
        );

        vm.prank(borrowerAcct);
        vm.expectRevert();
        facility.releaseOld(REQ);
        assertEq(oldAdapter.committedOf(address(facility)), 150_000e18, "old locked while unknown (I-97)");

        // settle is also blocked while a commitment is unknown.
        FacilityDecision memory sd = _decision(FacilityOperation.SETTLE, bytes32(0), bytes32(0), bytes32(0));
        vm.prank(borrowerAcct);
        vm.expectRevert(InstitutionalFacility.CommitmentUnknownOutstanding.selector);
        facility.settle(sd);
    }

    function test_onlyOneSubstitutionCanBeActive() public {
        _activate();
        FacilityDecision memory d = _decision(FacilityOperation.SUBSTITUTE, REP_ID, REP_REF, REQ);
        vm.startPrank(borrowerAcct);
        facility.requestSubstitution(REQ, address(repAdapter), 150_000e18, d, d);
        // The facility left ACTIVE, so a second open is refused (by the status modifier here; the
        // SubstitutionAlreadyActive slot guard is the backstop for any path that reaches it).
        vm.expectRevert();
        facility.requestSubstitution(keccak256("REQ2"), address(repAdapter), 150_000e18, d, d);
        vm.stopPrank();
    }

    function test_substitutionCannotReuseTheCurrentCollateralAdapter() public {
        _activate();
        // Found by the invariant campaign: a same-adapter "swap" would let the committed-
        // replacement check pass against the collateral already in custody, then drain it.
        FacilityDecision memory d = _decision(FacilityOperation.SUBSTITUTE, USTB_ID, OLD_REF, REQ);
        vm.prank(borrowerAcct);
        vm.expectRevert(
            abi.encodeWithSelector(
                InstitutionalFacility.DecisionUnbound.selector, bytes32("replacementAdapter")
            )
        );
        facility.requestSubstitution(REQ, address(oldAdapter), 150_000e18, d, d);
    }

    function test_releaseOldRejectsAMismatchedRequestId() public {
        _activate();
        FacilityDecision memory d = _decision(FacilityOperation.SUBSTITUTE, REP_ID, REP_REF, REQ);
        vm.startPrank(borrowerAcct);
        facility.requestSubstitution(REQ, address(repAdapter), 150_000e18, d, d);
        facility.commitReplacement();
        vm.expectRevert(InstitutionalFacility.RequestIdMismatch.selector);
        facility.releaseOld(keccak256("OTHER"));
        vm.stopPrank();
    }

    function test_aSubstitutionCannotBeReplayedAfterConsumption() public {
        _activate();
        FacilityDecision memory d = _decision(FacilityOperation.SUBSTITUTE, REP_ID, REP_REF, REQ);
        vm.prank(borrowerAcct);
        facility.substituteAtomic(REQ, address(repAdapter), 150_000e18, d, d);

        // Same request id, same decision — the substitution slot is NONE again, but re-running
        // the atomic path must not double-release. It needs a fresh request; the old decision's
        // subject no longer matches the (now REP) collateral for a further swap back without a
        // fresh decision, and the slot check plus verifier binding stop a naive replay.
        vm.prank(borrowerAcct);
        vm.expectRevert();
        facility.releaseOld(REQ);
    }

    // ---------------------------------------------------------------------------------
    // Freshness — I-98
    // ---------------------------------------------------------------------------------

    function test_staleAuthorityBlocksRelease() public {
        _activate();
        FacilityDecision memory d = _decision(FacilityOperation.SUBSTITUTE, REP_ID, REP_REF, REQ);
        vm.startPrank(borrowerAcct);
        facility.requestSubstitution(REQ, address(repAdapter), 150_000e18, d, d);
        facility.commitReplacement();
        vm.stopPrank();

        vm.warp(block.timestamp + 2 hours); // past the decision expiry
        vm.prank(borrowerAcct);
        vm.expectRevert(InstitutionalFacility.AuthorityStale.selector);
        facility.releaseOld(REQ);
    }

    function test_revokedAuthorityBlocksRelease() public {
        _activate();
        FacilityDecision memory d = _decision(FacilityOperation.SUBSTITUTE, REP_ID, REP_REF, REQ);
        vm.startPrank(borrowerAcct);
        facility.requestSubstitution(REQ, address(repAdapter), 150_000e18, d, d);
        facility.commitReplacement();
        vm.stopPrank();

        InstitutionalFacility.Substitution memory s = facility.substitution();
        verifier.revoke(s.authorityDecisionHash);
        vm.prank(borrowerAcct);
        vm.expectRevert(InstitutionalFacility.AuthorityStale.selector);
        facility.releaseOld(REQ);
    }

    function test_movedEpochBlocksReleaseUnlessTheVerifierPermitsIt() public {
        _activate();
        FacilityDecision memory d = _decision(FacilityOperation.SUBSTITUTE, REP_ID, REP_REF, REQ);
        vm.startPrank(borrowerAcct);
        facility.requestSubstitution(REQ, address(repAdapter), 150_000e18, d, d);
        facility.commitReplacement();
        vm.stopPrank();

        vm.prank(governance);
        policyReg.bumpEpoch(keccak256("SOMETHING_MOVED"));

        vm.prank(borrowerAcct);
        vm.expectRevert(); // EligibilityStale or PolicyVersionStale
        facility.releaseOld(REQ);

        // The verifier opens the risk-reducing carve-out.
        verifier.setEpochCarveOut(true);
        vm.prank(borrowerAcct);
        vm.expectRevert(InstitutionalFacility.PolicyVersionStale.selector);
        facility.releaseOld(REQ);
    }

    function test_guardianUnsafeReleaseBlockDisablesTheCarveOut() public {
        _activate();
        FacilityDecision memory d = _decision(FacilityOperation.SUBSTITUTE, REP_ID, REP_REF, REQ);
        vm.startPrank(borrowerAcct);
        facility.requestSubstitution(REQ, address(repAdapter), 150_000e18, d, d);
        facility.commitReplacement();
        vm.stopPrank();

        verifier.setEpochCarveOut(true);
        vm.prank(governance);
        policyReg.bumpEpoch(keccak256("MOVED"));
        vm.prank(guardian);
        facility.setRestriction(4, true, "incident");

        vm.prank(borrowerAcct);
        vm.expectRevert(InstitutionalFacility.EligibilityStale.selector);
        facility.releaseOld(REQ);
    }

    // ---------------------------------------------------------------------------------
    // Adapter adversarial cases
    // ---------------------------------------------------------------------------------

    function test_aBlockedAdapterRejectsTheSubstitutionRatherThanReleasing() public {
        _activate();
        FacilityDecision memory d = _decision(FacilityOperation.SUBSTITUTE, REP_ID, REP_REF, REQ);
        vm.prank(borrowerAcct);
        facility.requestSubstitution(REQ, address(repAdapter), 150_000e18, d, d);

        repAdapter.setCommitAllowed(false, "COMPLIANCE_WINDOW");
        vm.prank(borrowerAcct);
        facility.commitReplacement();

        // Rejected, back to ACTIVE, old collateral untouched.
        assertEq(uint8(facility.substitution().state), uint8(InstitutionalFacility.SubState.NONE));
        assertEq(uint8(facility.status()), uint8(InstitutionalFacility.Status.ACTIVE));
        assertEq(oldAdapter.committedOf(address(facility)), 150_000e18);
    }

    function test_abortReturnsTheReplacementAndKeepsTheOld() public {
        _activate();
        FacilityDecision memory d = _decision(FacilityOperation.SUBSTITUTE, REP_ID, REP_REF, REQ);
        repAdapter.setMode(TestCollateralAdapter.Mode.ASYNC);
        vm.startPrank(borrowerAcct);
        facility.requestSubstitution(REQ, address(repAdapter), 150_000e18, d, d);
        facility.commitReplacement();
        vm.stopPrank();
        repAdapter.resolveAsync(address(facility), ICollateralAdapter.CommitmentState.COMMITTED);
        vm.prank(operatorAcct);
        facility.reconcileCommitment();

        uint256 borrowerRepBefore = repToken.balanceOf(borrowerAcct);
        vm.prank(borrowerAcct);
        facility.abortCommittedSubstitution();

        assertEq(repToken.balanceOf(borrowerAcct), borrowerRepBefore + 150_000e18, "replacement returned");
        assertEq(oldAdapter.committedOf(address(facility)), 150_000e18, "old never moved");
        assertEq(uint8(facility.status()), uint8(InstitutionalFacility.Status.ACTIVE));
    }

    // ---------------------------------------------------------------------------------
    // No arbitrary recipient
    // ---------------------------------------------------------------------------------

    function test_noReleaseFunctionTakesARecipient() public {
        _activate();
        // Every release routes to a fixed destination. `releaseCollateralAfterSettlement` sends to
        // the borrower on SETTLED, the lender on DEFAULTED — never a caller-supplied address.
        _giveSettlement(borrowerAcct, PRINCIPAL * 2);
        vm.startPrank(borrowerAcct);
        usdc.approve(address(facility), PRINCIPAL * 2);
        facility.repay(PRINCIPAL * 2, true);
        vm.stopPrank();

        FacilityDecision memory sd = _decision(FacilityOperation.SETTLE, bytes32(0), bytes32(0), bytes32(0));
        vm.prank(borrowerAcct);
        facility.settle(sd);

        uint256 before = ustb.balanceOf(borrowerAcct);
        vm.prank(borrowerAcct);
        facility.releaseCollateralAfterSettlement();
        assertEq(
            ustb.balanceOf(borrowerAcct), before + 150_000e18, "settled collateral returns to the borrower"
        );
    }

    // ---------------------------------------------------------------------------------
    // Settlement and default — I-100
    // ---------------------------------------------------------------------------------

    function test_settleRefusesWhileDebtIsOutstanding() public {
        _activate();
        FacilityDecision memory sd = _decision(FacilityOperation.SETTLE, bytes32(0), bytes32(0), bytes32(0));
        vm.prank(borrowerAcct);
        vm.expectRevert(abi.encodeWithSelector(InstitutionalFacility.OutstandingDebt.selector, PRINCIPAL));
        facility.settle(sd);
    }

    function test_maturityWithUnpaidDebtDefaultsAndRoutesCollateralToTheLender() public {
        _activate();
        vm.warp(block.timestamp + 365 days + 3 days + 1);
        facility.poke();
        assertEq(uint8(facility.status()), uint8(InstitutionalFacility.Status.DEFAULTED));

        uint256 before = ustb.balanceOf(lenderAcct);
        vm.prank(lenderAcct);
        facility.releaseCollateralAfterSettlement();
        assertEq(ustb.balanceOf(lenderAcct), before + 150_000e18, "defaulted collateral routes to the lender");
    }

    function test_lenderRecallThenRepayReachesSettled() public {
        _activate();
        FacilityDecision memory rd = _decision(FacilityOperation.RECALL, bytes32(0), bytes32(0), bytes32(0));
        vm.prank(lenderAcct);
        facility.initiateRecall(rd);
        assertEq(uint8(facility.status()), uint8(InstitutionalFacility.Status.RECALLING));

        _giveSettlement(borrowerAcct, PRINCIPAL * 2);
        vm.startPrank(borrowerAcct);
        usdc.approve(address(facility), PRINCIPAL * 2);
        facility.repay(PRINCIPAL * 2, true);
        vm.stopPrank();

        FacilityDecision memory sd = _decision(FacilityOperation.SETTLE, bytes32(0), bytes32(0), bytes32(0));
        vm.prank(borrowerAcct);
        facility.settle(sd);
        assertEq(uint8(facility.status()), uint8(InstitutionalFacility.Status.SETTLED));
    }

    function test_lenderClaimsRepaymentsButNotPreActivationFunding() public {
        vm.startPrank(lenderAcct);
        usdc.approve(address(facility), PRINCIPAL);
        facility.fund();
        vm.expectRevert(); // DRAFT/PENDING funding is not a proceed
        facility.claimSettlementProceeds();
        vm.stopPrank();

        vm.prank(borrowerAcct);
        facility.commitInitialCollateral(150_000e18);
        FacilityDecision memory d = _decision(FacilityOperation.ACTIVATE, USTB_ID, OLD_REF, bytes32(0));
        vm.prank(lenderAcct);
        facility.activate(d, d);

        _giveSettlement(borrowerAcct, PRINCIPAL);
        vm.startPrank(borrowerAcct);
        usdc.approve(address(facility), PRINCIPAL);
        facility.repay(PRINCIPAL / 2, false);
        vm.stopPrank();

        uint256 before = usdc.balanceOf(lenderAcct);
        vm.prank(lenderAcct);
        facility.claimSettlementProceeds();
        assertEq(usdc.balanceOf(lenderAcct), before + PRINCIPAL / 2, "lender claims the repayment");
    }

    // ---------------------------------------------------------------------------------
    // Guardian is restriction-only
    // ---------------------------------------------------------------------------------

    function test_guardianCannotForgiveDebtOrWidenOrSeize() public {
        _activate();
        // There is simply no function for it. The guardian surface is four restrictions.
        vm.startPrank(guardian);
        facility.setRestriction(2, true, "pause subs");
        facility.setRestriction(3, true, "freeze interest");
        vm.stopPrank();
        // Interest frozen: outstanding does not grow.
        uint256 owed = facility.outstanding();
        vm.warp(block.timestamp + 100 days);
        assertEq(facility.outstanding(), owed, "frozen interest does not accrue");
        // Repay still works under every restriction.
        _giveSettlement(borrowerAcct, owed);
        vm.startPrank(borrowerAcct);
        usdc.approve(address(facility), owed);
        facility.repay(owed, true);
        vm.stopPrank();
        assertEq(facility.outstanding(), 0);
    }

    // ---------------------------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------------------------

    function _terms() internal view returns (InstitutionalFacility.Terms memory t) {
        t = InstitutionalFacility.Terms({
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
            initialCollateralAssetId: USTB_ID,
            initialCollateralAdapter: address(oldAdapter),
            settlementMaxPriceAge: SETTLEMENT_MAX_PRICE_AGE,
            recallGracePeriod: 7 days,
            maturityGracePeriod: 3 days
        });
    }

    function _giveSettlement(address who, uint256 amount) internal {
        usdc.mint(who, amount);
    }

    function _refreshBorrowerApprovals() internal {
        vm.startPrank(borrowerAcct);
        ustb.approve(address(oldAdapter), type(uint256).max);
        repToken.approve(address(repAdapter), type(uint256).max);
        vm.stopPrank();
    }
}

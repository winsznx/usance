// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

import {Fixture} from "./Fixture.sol";
import {ClearingHouse} from "../src/core/ClearingHouse.sol";
import {CollateralVault} from "../src/core/CollateralVault.sol";
import {Types} from "../src/libraries/Types.sol";

/// @title The core financial lifecycle, end to end
/// @notice This is the path a real user walks and the path the demo shows:
///         deposit → recognise → borrow → get refused above the limit → repay → withdraw,
///         then evidence changes and capacity reacts on its own.
contract LifecycleTest is Fixture {
    function setUp() public {
        deployProtocol();
        fundLenders(1_000_000e6);
        giveCollateral(alice, 10_000e18);
    }

    // ---------------------------------------------------------------------------------
    // Deposit and recognition
    // ---------------------------------------------------------------------------------

    function test_depositRecognisesLessThanMarketValue() public {
        depositCollateral(alice, 1_000e18);

        (Types.RiskResult memory r, Types.AssetValuation[] memory vals) = clearing.accountHealth(alice);

        // $1,000 of market value. The user must be shown why it is not $1,000 of borrowing power.
        assertEq(vals[0].marketValueUsd18, 1_000e18, "market value");

        // Same haircut stack as canonical fixture S02: 980.130906... after five sequential cuts.
        assertEq(vals[0].haircutMarkUsd18, 980_130_906_562_500_000_000, "haircut mark");
        assertEq(vals[0].recognizedUsd18, 980_130_906_562_500_000_000, "recognised");
        assertLt(r.totalRecognizedUsd18, vals[0].marketValueUsd18, "recognised must be conservative");

        // 85% initial LTV on the recognised value.
        assertEq(r.borrowLimitUsd18, 833_111_270_578_125_000_000, "borrow limit");
        assertEq(r.availableBorrowUsd18, r.borrowLimitUsd18, "no debt yet");
        assertEq(uint8(r.status), uint8(Types.AccountStatus.NORMAL));
    }

    function test_depositIsCreditedByMeasuredDelta() public {
        uint256 before = collateralVault.balanceOf(USTB_ID, alice);
        depositCollateral(alice, 1_000e18);
        assertEq(collateralVault.balanceOf(USTB_ID, alice) - before, 1_000e18);
        assertTrue(collateralVault.isSolvent(USTB_ID), "I-01");
    }

    // ---------------------------------------------------------------------------------
    // Borrow, and the guardrail
    // ---------------------------------------------------------------------------------

    function test_borrowWithinLimitSucceeds() public {
        depositCollateral(alice, 1_000e18);

        uint256 usdcBefore = usdc.balanceOf(alice);
        vm.prank(alice);
        clearing.borrow(500e18, 0);

        // Debt is denominated in USD; USDC is at $1 so 500 USD is 500e6 tokens.
        assertEq(usdc.balanceOf(alice) - usdcBefore, 500e6, "settlement tokens received");
        assertEq(clearing.debtOf(alice), 500e18, "debt in USD");

        (Types.RiskResult memory r,) = clearing.accountHealth(alice);
        assertEq(uint8(r.status), uint8(Types.AccountStatus.NORMAL));
        assertGt(r.healthFactorWad, 1e18, "healthy");
    }

    /// @notice The demo's guardrail moment. The excess is refused deterministically, by the
    ///         contract, with the exact maximum in the revert — not by a disabled button.
    function test_borrowAboveLimitIsRefusedWithExactMaximum() public {
        depositCollateral(alice, 1_000e18);

        (Types.RiskResult memory r,) = clearing.accountHealth(alice);
        uint256 max = r.availableBorrowUsd18;

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(ClearingHouse.RiskLimitExceeded.selector, max + 1, max));
        clearing.borrow(max + 1, 0);

        // Exactly at the limit is allowed. Off-by-one at the boundary is where lending protocols
        // either work or embarrass themselves.
        vm.prank(alice);
        clearing.borrow(max, 0);
        assertEq(clearing.debtOf(alice), max);
    }

    function test_borrowIsBoundedByLenderCashNotOnlyByRisk() public {
        // Enough collateral to justify far more than the vault holds.
        depositCollateral(alice, 10_000e18);

        // Drain the vault down to $100 of deployable cash. The share balance is read first:
        // vm.prank applies to the next external call, and an inline read would consume it.
        uint256 drain = liquidityVault.balanceOf(lender) - 100e6;
        vm.prank(lender);
        liquidityVault.withdraw(drain, lender);

        (uint256 avail, bool byLiquidity) = clearing.availableBorrow(alice);
        assertTrue(byLiquidity, "liquidity must be reported as the binding constraint");
        assertEq(avail, 100e18, "capacity is cash, not collateral");

        vm.prank(alice);
        vm.expectRevert();
        clearing.borrow(200e18, 0);
    }

    function test_borrowUnderStaleEpochReverts() public {
        depositCollateral(alice, 1_000e18);
        uint64 quotedEpoch = policyReg.riskEpoch();

        // Policy moves between the quote and the signature.
        vm.prank(admission);
        policyReg.bumpEpoch(keccak256("PASSPORT_UPDATED"));

        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(ClearingHouse.StaleRiskEpoch.selector, policyReg.riskEpoch(), quotedEpoch)
        );
        clearing.borrow(100e18, quotedEpoch);
    }

    // ---------------------------------------------------------------------------------
    // Repay
    // ---------------------------------------------------------------------------------

    function test_repayAllClearsDebtExactly() public {
        depositCollateral(alice, 1_000e18);
        vm.prank(alice);
        clearing.borrow(500e18, 0);

        warpAndRefreshFeeds(30 days);

        uint256 debt = clearing.debtOf(alice);
        assertGt(debt, 500e18, "interest must have accrued");

        usdc.mint(alice, 1_000e6);
        vm.startPrank(alice);
        usdc.approve(address(clearing), type(uint256).max);
        clearing.repay(0, true);
        vm.stopPrank();

        // "Repay all" must land on exactly zero. Dust debt is how an account becomes impossible
        // to close, so it gets an explicit path rather than relying on rounding.
        assertEq(clearing.debtOf(alice), 0, "debt fully cleared");
    }

    function test_duplicateRepayDoesNotDoubleReduce() public {
        depositCollateral(alice, 1_000e18);
        vm.prank(alice);
        clearing.borrow(500e18, 0);

        usdc.mint(alice, 1_000e6);
        vm.startPrank(alice);
        usdc.approve(address(clearing), type(uint256).max);

        clearing.repay(200e18, false);
        uint256 afterFirst = clearing.debtOf(alice);

        clearing.repay(200e18, false);
        uint256 afterSecond = clearing.debtOf(alice);
        vm.stopPrank();

        // Each repayment reduces exactly once (invariant I-04): the second call removes another
        // 200 and not the same 200 again.
        assertApproxEqAbs(afterFirst - afterSecond, 200e18, 1e12, "second repay applied once");
        assertApproxEqAbs(afterSecond, 100e18, 1e12, "total reduction is 400");
    }

    // ---------------------------------------------------------------------------------
    // Withdraw
    // ---------------------------------------------------------------------------------

    function test_withdrawAllWithNoDebt() public {
        depositCollateral(alice, 1_000e18);
        uint256 before = ustb.balanceOf(alice);

        vm.prank(alice);
        clearing.withdrawCollateral(USTB_ID, 1_000e18);

        assertEq(ustb.balanceOf(alice) - before, 1_000e18);
        assertEq(clearing.heldAssets(alice).length, 0, "asset removed from the held list");
    }

    function test_withdrawBlockedBelowMaintenanceAndReportsSafeMaximum() public {
        depositCollateral(alice, 1_000e18);
        vm.prank(alice);
        clearing.borrow(700e18, 0);

        uint256 safeMax = clearing.maxWithdrawable(alice, USTB_ID);
        assertGt(safeMax, 0, "some withdrawal must remain possible");
        assertLt(safeMax, 1_000e18, "but not all of it");

        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(ClearingHouse.WithdrawWouldBreachMaintenance.selector, safeMax)
        );
        clearing.withdrawCollateral(USTB_ID, safeMax + 1e15);

        // The advertised maximum must actually be accepted. A UI number the contract rejects is
        // worse than no number at all.
        vm.prank(alice);
        clearing.withdrawCollateral(USTB_ID, safeMax);

        (Types.RiskResult memory r,) = clearing.accountHealth(alice);
        assertLe(r.debtUsd18, r.maintenanceLimitUsd18, "still above maintenance");
    }

    // ---------------------------------------------------------------------------------
    // Evidence change drives capacity — the mechanism the whole protocol exists for
    // ---------------------------------------------------------------------------------

    function test_passportUpdateChangesCapacityAndBlocksNewRisk() public {
        depositCollateral(alice, 1_000e18);
        vm.prank(alice);
        clearing.borrow(700e18, 0);

        (Types.RiskResult memory before,) = clearing.accountHealth(alice);
        assertEq(uint8(before.status), uint8(Types.AccountStatus.NORMAL));

        // New evidence lands: the issuer's redemption terms worsened. A new Passport version is
        // committed with a lower redemption floor. Nobody edits a database row; the registry
        // moves and the risk pipeline reads the new value on the next call.
        vm.startPrank(admission);
        (bytes32[] memory v2Evidence, bytes32 v2Root) = _fileEvidence(USTB_ID, "USTB_V2");
        passportReg.commitPassport(
            USTB_ID, 2, v2Evidence, v2Root, keccak256("CLAIMS_ROOT_V2"), 0, true, 6_000, false
        );
        vm.stopPrank();
        vm.prank(admission);
        policyReg.bumpEpoch(keccak256("PASSPORT_V2"));

        (Types.RiskResult memory afterR,) = clearing.accountHealth(alice);

        // The redemption floor is now the binding term of the min(): recognised value falls to
        // 60% of market, and with it every limit derived from it.
        assertLt(afterR.totalRecognizedUsd18, before.totalRecognizedUsd18, "capacity fell");
        assertEq(afterR.totalRecognizedUsd18, 600e18, "redemption floor binds at 60%");
        assertEq(afterR.availableBorrowUsd18, 0, "no new borrowing");
        assertGt(uint8(afterR.status), uint8(Types.AccountStatus.NORMAL), "account is restricted");

        // And the restriction is enforced, not merely displayed.
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(ClearingHouse.AccountNotHealthy.selector, afterR.status));
        clearing.borrow(1e18, 0);
    }

    function test_recoveryAfterRestriction() public {
        depositCollateral(alice, 1_000e18);
        vm.prank(alice);
        clearing.borrow(700e18, 0);

        vm.startPrank(admission);
        (bytes32[] memory v2Evidence, bytes32 v2Root) = _fileEvidence(USTB_ID, "USTB_V2");
        passportReg.commitPassport(
            USTB_ID, 2, v2Evidence, v2Root, keccak256("CLAIMS_ROOT_V2"), 0, true, 6_000, false
        );
        vm.stopPrank();

        (Types.RiskResult memory restricted,) = clearing.accountHealth(alice);
        assertGt(uint8(restricted.status), uint8(Types.AccountStatus.NORMAL));

        // The user repairs it the way the UI tells them to: repay.
        usdc.mint(alice, 1_000e6);
        vm.startPrank(alice);
        usdc.approve(address(clearing), type(uint256).max);
        clearing.repay(0, true);
        vm.stopPrank();

        (Types.RiskResult memory healed,) = clearing.accountHealth(alice);
        assertEq(uint8(healed.status), uint8(Types.AccountStatus.NORMAL), "back to healthy");
        assertGt(healed.availableBorrowUsd18, 0, "capacity restored");
    }

    // ---------------------------------------------------------------------------------
    // Degraded inputs
    // ---------------------------------------------------------------------------------

    function test_staleOracleBlocksNewRiskButNotRepayment() public {
        depositCollateral(alice, 1_000e18);
        vm.prank(alice);
        clearing.borrow(300e18, 0);

        // Move past the feed's maximum age without refreshing it.
        vm.warp(block.timestamp + 86_401);

        (Types.RiskResult memory r,) = clearing.accountHealth(alice);
        assertTrue(r.gates & Types.GATE_ORACLE_STALE != 0, "stale gate raised");
        assertEq(r.availableBorrowUsd18, 0, "I-09");

        vm.prank(alice);
        vm.expectRevert();
        clearing.borrow(1e18, 0);

        // Reducing risk must stay available. Freezing a user out of repayment because a price
        // feed went quiet would turn an oracle incident into a liquidation event.
        usdc.mint(alice, 1_000e6);
        vm.startPrank(alice);
        usdc.approve(address(clearing), type(uint256).max);
        clearing.repay(0, true);
        vm.stopPrank();
        assertEq(clearing.debtOf(alice), 0);
    }

    function test_sequencerDownBlocksNewRisk() public {
        depositCollateral(alice, 1_000e18);

        sequencerFeed.set(1, block.timestamp); // 1 == down
        (Types.RiskResult memory r,) = clearing.accountHealth(alice);

        assertTrue(r.gates & Types.GATE_SEQUENCER_DOWN != 0, "sequencer gate raised");
        assertEq(r.availableBorrowUsd18, 0);

        vm.prank(alice);
        vm.expectRevert();
        clearing.borrow(1e18, 0);
    }

    function test_guardianCanOnlyRestrict() public {
        depositCollateral(alice, 1_000e18);

        vm.prank(guardian);
        clearing.setAccountRiskState(alice, Types.AccountStatus.REDUCE_ONLY, keccak256("INVESTIGATION"));

        (Types.RiskResult memory r,) = clearing.accountHealth(alice);
        assertEq(uint8(r.status), uint8(Types.AccountStatus.REDUCE_ONLY));
        assertEq(r.availableBorrowUsd18, 0);

        // A guardian cannot walk it back — that is governance's call (invariant I-25).
        vm.prank(guardian);
        vm.expectRevert("override may only restrict");
        clearing.setAccountRiskState(alice, Types.AccountStatus.NORMAL, keccak256("OOPS"));
    }

    function test_suspendedAssetKeepsExitPathsOpen() public {
        depositCollateral(alice, 1_000e18);
        vm.prank(alice);
        clearing.borrow(300e18, 0);

        vm.prank(guardian);
        assetsReg.setStatus(USTB_ID, Types.AssetStatus.SUSPENDED);

        (Types.RiskResult memory r,) = clearing.accountHealth(alice);
        assertTrue(r.gates & Types.GATE_ASSET_SUSPENDED != 0);
        assertEq(r.availableBorrowUsd18, 0);

        // The user is not trapped: they can still repay and then take their collateral back.
        usdc.mint(alice, 1_000e6);
        vm.startPrank(alice);
        usdc.approve(address(clearing), type(uint256).max);
        clearing.repay(0, true);
        clearing.withdrawCollateral(USTB_ID, 1_000e18);
        vm.stopPrank();

        assertEq(ustb.balanceOf(alice), 10_000e18, "collateral returned in full");
    }
}

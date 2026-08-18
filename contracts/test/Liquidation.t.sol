// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Fixture} from "./Fixture.sol";
import {ClearingHouse} from "../src/core/ClearingHouse.sol";
import {LiquidationManager} from "../src/core/LiquidationManager.sol";
import {DirectSettlementRoute} from "../src/routes/DirectSettlementRoute.sol";
import {Types} from "../src/libraries/Types.sol";

/**
 * Progressive liquidation.
 *
 * The invariants here are the ones that decide whether a liquidation engine is safe to point at
 * real money. Every one of them is a way an engine can be wrong while appearing to work.
 */
contract LiquidationTest is Fixture {
    LiquidationManager internal manager;
    DirectSettlementRoute internal route;

    function setUp() public {
        deployProtocol();
        fundLenders(1_000_000e6);
        giveCollateral(alice, 10_000e18);

        manager = new LiquidationManager(authority, clearing);
        route = new DirectSettlementRoute(authority, assetsReg, oracle, usdc, 6);

        vm.startPrank(governance);
        manager.registerRoute(route);
        // The route needs settlement tokens to pay with. An empty buffer is not a route, and
        // `isAvailable` says so.
        authority.grantRole(authority.LIQUIDATOR(), address(this));
        authority.grantRole(authority.CLEARING(), address(this));
        vm.stopPrank();

        usdc.mint(address(route), 500_000e6);
    }

    /// Borrow to the limit, then halve the collateral price. Debt then exceeds the liquidation
    /// limit, which is what MARGIN_CALL means.
    function _pushIntoMarginCall() internal returns (uint256 debt) {
        depositCollateral(alice, 1_000e18);
        (uint256 available,) = clearing.availableBorrow(alice);
        vm.prank(alice);
        clearing.borrow(available, 0);

        ustbFeed.set(0.5e8, block.timestamp);
        vm.prank(admission);
        policyReg.bumpEpoch(keccak256("COLLATERAL_REPRICED"));

        (Types.RiskResult memory r,) = clearing.accountHealth(alice);
        debt = r.debtUsd18;
    }

    // ------------------------------------------------------------------ eligibility

    function test_healthyAccountCannotBeLiquidated() public {
        depositCollateral(alice, 1_000e18);
        vm.prank(alice);
        clearing.borrow(100e18, 0);

        LiquidationManager.Plan memory plan = manager.planFor(alice, USTB_ID);
        assertEq(uint8(plan.status), uint8(Types.AccountStatus.NORMAL));
        assertFalse(plan.eligible, "a healthy account was planned for liquidation");

        vm.expectRevert(
            abi.encodeWithSelector(ClearingHouse.AccountNotLiquidatable.selector, Types.AccountStatus.NORMAL)
        );
        clearing.executeLiquidation(alice, USTB_ID, 100e18, address(route), 0);
    }

    /// A restriction is not a liquidation trigger. An account blocked from borrowing is still
    /// solvent against its own maintenance limit, and liquidating it would be theft with extra steps.
    function test_noNewRiskAloneIsNotLiquidationEligibility() public {
        depositCollateral(alice, 1_000e18);
        (uint256 available,) = clearing.availableBorrow(alice);
        vm.prank(alice);
        clearing.borrow(available, 0);

        // A small deterioration: enough to restrict, not enough to breach liquidation.
        ustbFeed.set(0.93e8, block.timestamp);
        vm.prank(admission);
        policyReg.bumpEpoch(keccak256("SMALL_MOVE"));

        (Types.RiskResult memory r,) = clearing.accountHealth(alice);
        assertLt(uint8(r.status), uint8(Types.AccountStatus.MARGIN_CALL), "test setup went too far");
        assertGt(uint8(r.status), uint8(Types.AccountStatus.NORMAL), "test setup did not restrict");

        assertFalse(manager.planFor(alice, USTB_ID).eligible);
        vm.expectRevert();
        clearing.executeLiquidation(alice, USTB_ID, 100e18, address(route), 0);
    }

    function test_marginCallIsEligible() public {
        _pushIntoMarginCall();
        LiquidationManager.Plan memory plan = manager.planFor(alice, USTB_ID);
        assertTrue(plan.eligible);
        assertGt(plan.repayTargetUsd18, 0);
        assertGt(plan.seizeValueUsd18, plan.repayTargetUsd18, "no bonus was priced in");
    }

    // ------------------------------------------------------------------ partial deleveraging

    /// The point of the whole design: cure the breach, do not close the account.
    function test_liquidationIsPartialRatherThanTotal() public {
        uint256 debt = _pushIntoMarginCall();
        LiquidationManager.Plan memory plan = manager.planFor(alice, USTB_ID);

        assertLt(plan.repayTargetUsd18, debt, "planned to repay the entire debt for a partial breach");
        assertFalse(plan.wouldExhaustCollateral, "planned to consume every unit of collateral");
    }

    function test_aSmallBreachTakesLessCollateralThanALargeOne() public {
        depositCollateral(alice, 1_000e18);
        (uint256 available,) = clearing.availableBorrow(alice);
        vm.prank(alice);
        clearing.borrow(available, 0);

        ustbFeed.set(0.6e8, block.timestamp);
        vm.prank(admission);
        policyReg.bumpEpoch(keccak256("MOVE_A"));
        LiquidationManager.Plan memory a = manager.planFor(alice, USTB_ID);

        ustbFeed.set(0.45e8, block.timestamp);
        vm.prank(admission);
        policyReg.bumpEpoch(keccak256("MOVE_B"));
        LiquidationManager.Plan memory b = manager.planFor(alice, USTB_ID);

        // Monotonicity lives on the curing amount, not on what a single round takes. Once both
        // breaches exceed the close factor the round is capped at the same fraction of the same
        // debt, so asserting the seizures differ would be asserting the cap does not work.
        assertGt(b.curingRepayUsd18, a.curingRepayUsd18, "a worse breach did not need more repayment");
        assertGe(b.repayTargetUsd18, a.repayTargetUsd18, "a worse breach took strictly less this round");
    }

    /**
     * The plan must be honest about whether one liquidation is enough.
     *
     * The version of this test that shipped compared the post-liquidation debt against the
     * *pre*-liquidation maintenance limit — the one number guaranteed not to apply afterwards — and
     * therefore passed while the planner was wrong. A live liquidation on X Layer testnet caught it:
     * the seizure matched the plan exactly, the debt fell, and the account stayed in MARGIN_CALL,
     * because taking collateral removes borrowing capacity as well as debt.
     */
    function test_thePlanSaysWhetherOneLiquidationCuresTheBreach() public {
        _pushIntoMarginCall();
        LiquidationManager.Plan memory plan = manager.planFor(alice, USTB_ID);

        if (plan.curesTheBreach) {
            // Curable: the post-liquidation debt must sit under the post-liquidation maintenance
            // limit, which shrinks with the collateral that was taken.
            uint256 seized = plan.seizeValueUsd18;
            uint256 mBps = (plan.maintenanceLimitUsd18 * 10_000) / _recognised(alice);
            uint256 debtAfter = plan.debtUsd18 - plan.repayTargetUsd18;
            uint256 maintenanceAfter = plan.maintenanceLimitUsd18 - (seized * mBps) / 10_000;
            assertLe(debtAfter, maintenanceAfter, "claimed a cure that does not clear the new limit");
        } else {
            // Not curable: the amount needed is stated even though it cannot be taken this round.
            assertGt(plan.repayTargetUsd18, 0, "gave up entirely instead of deleveraging");
            assertLe(
                plan.repayTargetUsd18,
                (plan.debtUsd18 * manager.closeFactorBps()) / 10_000,
                "took more than the close factor allows"
            );
        }
    }

    function _recognised(address who) internal view returns (uint256) {
        (Types.RiskResult memory r,) = clearing.accountHealth(who);
        return r.totalRecognizedUsd18;
    }

    /// A liquidation that cannot cure still has to reduce exposure, and has to say it did not cure.
    function test_anUncurableBreachIsDeleveragedAndReportedHonestly() public {
        _pushIntoMarginCall();
        LiquidationManager.Plan memory plan = manager.planFor(alice, USTB_ID);
        if (plan.curesTheBreach) return; // covered by the branch above

        (Types.RiskResult memory before,) = clearing.accountHealth(alice);
        uint256 seize = (plan.seizeValueUsd18 * 1e18) / _price();
        clearing.executeLiquidation(alice, USTB_ID, seize, address(route), 0);

        (Types.RiskResult memory afterR,) = clearing.accountHealth(alice);
        assertLt(afterR.debtUsd18, before.debtUsd18, "exposure did not fall");
        assertGt(plan.curingRepayUsd18, plan.repayTargetUsd18, "the curing amount was not reported as larger");
    }

    function _price() internal view returns (uint256) {
        (uint256 p,) = oracle.getPrice(USTB_ID);
        return p;
    }

    /// Every dollar seized removes capacity as well as debt, so a bounded round is the norm rather
    /// than the exception. This pins that the bound is the close factor and not an accident.
    function test_theCloseFactorBoundsASingleRound() public {
        _pushIntoMarginCall();
        LiquidationManager.Plan memory plan = manager.planFor(alice, USTB_ID);
        assertLe(plan.repayTargetUsd18, (plan.debtUsd18 * manager.closeFactorBps()) / 10_000);
    }

    // ------------------------------------------------------------------ execution

    function test_liquidationReducesDebtAndSeizesOnlyWhatWasAuthorized() public {
        _pushIntoMarginCall();
        (Types.RiskResult memory before,) = clearing.accountHealth(alice);
        uint256 heldBefore = collateralVault.balanceOf(USTB_ID, alice);

        uint256 seize = 200e18;
        clearing.executeLiquidation(alice, USTB_ID, seize, address(route), 0);

        (Types.RiskResult memory afterR,) = clearing.accountHealth(alice);
        assertLt(afterR.debtUsd18, before.debtUsd18, "debt did not fall");
        assertEq(collateralVault.balanceOf(USTB_ID, alice), heldBefore - seize, "seized the wrong amount");
    }

    function test_liquidationCannotSeizeMoreThanTheAccountHolds() public {
        _pushIntoMarginCall();
        uint256 held = collateralVault.balanceOf(USTB_ID, alice);

        vm.expectRevert(abi.encodeWithSelector(ClearingHouse.SeizureExceedsHoldings.selector, held + 1, held));
        clearing.executeLiquidation(alice, USTB_ID, held + 1, address(route), 0);
    }

    /// Liquidation reduces risk or it is not liquidation. There is no path from here that increases
    /// debt, and this pins that the direction cannot invert.
    function test_liquidationCannotCreateDebt() public {
        _pushIntoMarginCall();
        (Types.RiskResult memory before,) = clearing.accountHealth(alice);

        clearing.executeLiquidation(alice, USTB_ID, 200e18, address(route), 0);

        (Types.RiskResult memory afterR,) = clearing.accountHealth(alice);
        assertLe(afterR.debtUsd18, before.debtUsd18, "liquidation increased debt");
    }

    /// A route that under-delivers must abandon the liquidation rather than realise the loss.
    function test_aRouteThatCannotMeetTheFloorAbandonsRatherThanRealisingALoss() public {
        _pushIntoMarginCall();
        (Types.RiskResult memory before,) = clearing.accountHealth(alice);
        uint256 heldBefore = collateralVault.balanceOf(USTB_ID, alice);

        vm.expectRevert();
        clearing.executeLiquidation(alice, USTB_ID, 200e18, address(route), 1_000_000e6);

        (Types.RiskResult memory afterR,) = clearing.accountHealth(alice);
        assertEq(afterR.debtUsd18, before.debtUsd18, "debt moved on an abandoned liquidation");
        assertEq(collateralVault.balanceOf(USTB_ID, alice), heldBefore, "collateral left in transit");
    }

    function test_repaymentStillWorksDuringMarginCall() public {
        _pushIntoMarginCall();

        usdc.mint(alice, 2_000e6);
        vm.startPrank(alice);
        usdc.approve(address(clearing), type(uint256).max);
        clearing.repay(0, true);
        vm.stopPrank();

        (Types.RiskResult memory r,) = clearing.accountHealth(alice);
        assertEq(r.debtUsd18, 0, "the cure was blocked by the state it exists to cure");
        assertEq(uint8(r.status), uint8(Types.AccountStatus.NORMAL));
    }

    /// Curing the account removes eligibility. An engine that kept a stale verdict would liquidate
    /// an account that had already fixed itself.
    function test_curingTheAccountRemovesEligibility() public {
        _pushIntoMarginCall();
        assertTrue(manager.planFor(alice, USTB_ID).eligible);

        giveCollateral(alice, 5_000e18);
        depositCollateral(alice, 5_000e18);

        assertFalse(manager.planFor(alice, USTB_ID).eligible, "a cured account stayed liquidatable");
    }

    // ------------------------------------------------------------------ routing

    function test_theRouterRanksOnExpectedRecoveryNotGrossProceeds() public view {
        (uint256 proceeds, uint256 fees, uint256 latency, uint256 failure, uint256 recovery) =
            route.quote(USTB_ID, 100e18);

        // Every deduction is separate because they behave differently under stress; a single net
        // number hides which one moved.
        assertGt(proceeds, recovery, "expected recovery was not net of deductions");
        assertEq(recovery, proceeds - fees - latency - failure);
        assertGt(failure, 0, "no failure haircut is priced");
    }

    function test_anUnfundedRouteIsNotAvailable() public {
        assertTrue(route.isAvailable(USTB_ID));

        // Drain the buffer by moving it out, since the mock has no burn. The balance is read
        // before the prank: `vm.prank` applies to the next call of any kind, and a view call in an
        // argument list consumes it.
        uint256 buffer = usdc.balanceOf(address(route));
        vm.prank(address(route));
        usdc.transfer(address(0xdead), buffer);

        assertFalse(route.isAvailable(USTB_ID), "an empty buffer still advertised itself as a route");
        (bytes32 id,) = manager.bestRoute(USTB_ID, 100e18);
        assertEq(id, bytes32(0), "the router selected a route that cannot pay");
    }

    function test_noRouteMeansNoPlan() public {
        bytes32 id = route.routeId();
        vm.prank(governance);
        manager.removeRoute(id);

        _pushIntoMarginCall();
        LiquidationManager.Plan memory plan = manager.planFor(alice, USTB_ID);
        assertTrue(plan.eligible, "the account is still liquidatable");
        assertEq(plan.routeId, bytes32(0), "a route was selected from an empty registry");
    }

    // ------------------------------------------------------------------ authority

    function test_onlyALiquidatorMayExecute() public {
        _pushIntoMarginCall();
        vm.prank(makeAddr("stranger"));
        vm.expectRevert();
        clearing.executeLiquidation(alice, USTB_ID, 100e18, address(route), 0);
    }

    function test_onlyGovernanceMayRegisterARoute() public {
        DirectSettlementRoute other = new DirectSettlementRoute(authority, assetsReg, oracle, usdc, 6);
        vm.prank(makeAddr("stranger"));
        vm.expectRevert();
        manager.registerRoute(other);
    }

    function test_theSameRouteCannotBeRegisteredTwice() public {
        bytes32 id = route.routeId();
        vm.prank(governance);
        vm.expectRevert(abi.encodeWithSelector(LiquidationManager.RouteAlreadyRegistered.selector, id));
        manager.registerRoute(route);
    }

    /// A route pricing a seizure off a stale figure decides how much collateral leaves the account.
    /// Being wrong there is not a blocked transaction, it is the wrong amount of somebody's money.
    function test_aRouteWillNotSeizeOnAStalePrice() public {
        _pushIntoMarginCall();
        assertTrue(route.isAvailable(USTB_ID));

        vm.warp(block.timestamp + 3 days);

        assertFalse(route.isAvailable(USTB_ID), "a route quoted off a three-day-old price");
        (bytes32 id,) = manager.bestRoute(USTB_ID, 100e18);
        assertEq(id, bytes32(0), "the router selected a route that cannot price");
    }

    function test_aBonusThatCouldExceedThePositionIsRefused() public {
        vm.prank(governance);
        vm.expectRevert(LiquidationManager.BadParameters.selector);
        manager.setParameters(2_000, 200, 5_000);
    }
}

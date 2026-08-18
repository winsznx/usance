// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Fixture} from "./Fixture.sol";
import {ClearingHouse} from "../src/core/ClearingHouse.sol";
import {FeeController} from "../src/core/FeeController.sol";
import {LiquidationManager} from "../src/core/LiquidationManager.sol";
import {DirectSettlementRoute} from "../src/routes/DirectSettlementRoute.sol";
import {Types} from "../src/libraries/Types.sol";

/**
 * Who gets paid for a liquidation, and out of what.
 *
 * The previous design applied every unit of proceeds to the borrower's debt, so the liquidation
 * "bonus" accrued to the borrower as extra debt retirement and nobody was paid to perform
 * liquidations. That is a working proof of mechanics and not a liquidation market: a protocol whose
 * keepers earn nothing has no keepers on the day it first needs them.
 *
 * The equation every test here defends:
 *
 *     collateral seized (market) = debt retired
 *                                + keeper incentive
 *                                + protocol fee
 *                                + route loss
 */
contract LiquidatorEconomicsTest is Fixture {
    FeeController internal feeController;
    LiquidationManager internal manager;
    DirectSettlementRoute internal route;

    address internal keeper;
    address internal treasury;

    function setUp() public {
        deployProtocol();
        fundLenders(1_000_000e6);
        giveCollateral(alice, 10_000e18);

        keeper = makeAddr("keeper");
        treasury = makeAddr("treasury");

        feeController = new FeeController(authority, policyReg, treasury);
        manager = new LiquidationManager(authority, clearing);
        route = new DirectSettlementRoute(authority, assetsReg, oracle, usdc, 6);

        vm.startPrank(governance);
        // Raising a fee changes what an outstanding quote means, so FeeController must be able to
        // advance the epoch. An explicit capability, not a money role.
        policyReg.setEpochBumper(address(feeController), true);
        clearing.setFeeController(feeController);
        manager.registerRoute(route);
        authority.grantRole(authority.LIQUIDATOR(), keeper);
        authority.grantRole(authority.CLEARING(), address(this));
        vm.stopPrank();

        usdc.mint(address(route), 500_000e6);
    }

    function _pushIntoMarginCall() internal {
        depositCollateral(alice, 1_000e18);
        (uint256 available,) = clearing.availableBorrow(alice);
        vm.prank(alice);
        clearing.borrow(available, 0);

        ustbFeed.set(0.5e8, block.timestamp);
        vm.prank(admission);
        policyReg.bumpEpoch(keccak256("COLLATERAL_REPRICED"));
    }

    function _seizeFor(uint256 valueUsd18) internal view returns (uint256) {
        (uint256 price,) = oracle.getPrice(USTB_ID);
        return (valueUsd18 * 1e18) / price;
    }

    // ------------------------------------------------------------------ the keeper gets paid

    function test_theKeeperIsPaidOutOfTheProceeds() public {
        _pushIntoMarginCall();
        uint256 before = usdc.balanceOf(keeper);

        vm.prank(keeper);
        (, uint256 proceeds) = clearing.executeLiquidation(alice, USTB_ID, 200e18, address(route), 0);

        uint256 paid = usdc.balanceOf(keeper) - before;
        assertGt(paid, 0, "the keeper performed a liquidation and was paid nothing");
        assertEq(
            paid,
            (proceeds * feeController.liquidatorIncentiveBps()) / 10_000,
            "incentive is not the configured share"
        );
    }

    /// The reward follows the caller, never a parameter. A recipient argument would let one
    /// compromised LIQUIDATOR key direct every reward anywhere.
    function test_theRewardGoesToWhoeverDidTheWork() public {
        _pushIntoMarginCall();
        address other = makeAddr("someone-else");

        vm.prank(keeper);
        clearing.executeLiquidation(alice, USTB_ID, 200e18, address(route), 0);

        assertGt(usdc.balanceOf(keeper), 0);
        assertEq(usdc.balanceOf(other), 0, "a party that did no work was paid");
    }

    function test_theProtocolFeeReachesTheTreasury() public {
        _pushIntoMarginCall();

        vm.prank(keeper);
        (, uint256 proceeds) = clearing.executeLiquidation(alice, USTB_ID, 200e18, address(route), 0);

        assertEq(
            usdc.balanceOf(treasury),
            (proceeds * feeController.protocolLiquidationFeeBps()) / 10_000,
            "protocol fee is not the configured share"
        );
    }

    // ------------------------------------------------------------------ conservation

    /// Every unit the route returned goes somewhere, and nowhere twice.
    function test_proceedsAreConservedAcrossTheThreeDestinations() public {
        _pushIntoMarginCall();
        (Types.RiskResult memory before,) = clearing.accountHealth(alice);

        uint256 vaultBefore = usdc.balanceOf(address(liquidityVault));
        uint256 aliceBefore = usdc.balanceOf(alice);

        vm.prank(keeper);
        (, uint256 proceeds) = clearing.executeLiquidation(alice, USTB_ID, 200e18, address(route), 0);

        uint256 toVault = usdc.balanceOf(address(liquidityVault)) - vaultBefore;
        uint256 toKeeper = usdc.balanceOf(keeper);
        uint256 toTreasury = usdc.balanceOf(treasury);
        uint256 toBorrower = usdc.balanceOf(alice) - aliceBefore;

        assertEq(toVault + toKeeper + toTreasury + toBorrower, proceeds, "value was created or destroyed");
        assertGt(before.debtUsd18, 0);
    }

    /// The keeper is paid from the proceeds, so the borrower's debt falls by less than it would
    /// have under the old model. That is the honest cost of a liquidation market, not a regression.
    function test_theKeeperIsPaidFromProceedsNotConjuredAlongside() public {
        _pushIntoMarginCall();
        (Types.RiskResult memory before,) = clearing.accountHealth(alice);

        vm.prank(keeper);
        (uint256 repaid, uint256 proceeds) =
            clearing.executeLiquidation(alice, USTB_ID, 200e18, address(route), 0);

        (Types.RiskResult memory afterR,) = clearing.accountHealth(alice);
        assertLt(afterR.debtUsd18, before.debtUsd18);

        // Debt retirement is strictly less than the proceeds, and the gap is exactly what was paid
        // out. If the keeper were funded from anywhere else, this would not hold.
        uint256 takeBps = feeController.liquidationTakeBps();
        assertLt(repaid, _tokensToUsd(proceeds), "the keeper was funded from outside the proceeds");
        assertApproxEqRel(repaid, (_tokensToUsd(proceeds) * (10_000 - takeBps)) / 10_000, 1e15);
    }

    function _tokensToUsd(uint256 tokens) internal pure returns (uint256) {
        return tokens * 1e12;
    }

    // ------------------------------------------------------------------ nothing pays twice

    function test_aRouteThatFailsPaysNoReward() public {
        _pushIntoMarginCall();

        vm.prank(keeper);
        vm.expectRevert();
        clearing.executeLiquidation(alice, USTB_ID, 200e18, address(route), 1_000_000e6);

        assertEq(usdc.balanceOf(keeper), 0, "a failed liquidation paid a reward");
        assertEq(usdc.balanceOf(treasury), 0, "a failed liquidation paid a protocol fee");
    }

    function test_aHealthyAccountGeneratesNoReward() public {
        depositCollateral(alice, 1_000e18);
        vm.prank(alice);
        clearing.borrow(100e18, 0);

        vm.prank(keeper);
        vm.expectRevert(
            abi.encodeWithSelector(ClearingHouse.AccountNotLiquidatable.selector, Types.AccountStatus.NORMAL)
        );
        clearing.executeLiquidation(alice, USTB_ID, 100e18, address(route), 0);

        assertEq(usdc.balanceOf(keeper), 0);
    }

    function test_anUnauthorisedCallerEarnsNothing() public {
        _pushIntoMarginCall();
        address stranger = makeAddr("stranger");

        vm.prank(stranger);
        vm.expectRevert();
        clearing.executeLiquidation(alice, USTB_ID, 200e18, address(route), 0);

        assertEq(usdc.balanceOf(stranger), 0);
    }

    /// A smaller seizure pays proportionally less. A reward that did not scale would make a keeper
    /// indifferent to size and reward the smallest liquidation that qualified.
    function test_rewardScalesWithTheSizeOfTheLiquidation() public {
        _pushIntoMarginCall();

        vm.prank(keeper);
        clearing.executeLiquidation(alice, USTB_ID, 100e18, address(route), 0);
        uint256 small = usdc.balanceOf(keeper);

        vm.prank(keeper);
        clearing.executeLiquidation(alice, USTB_ID, 200e18, address(route), 0);
        uint256 total = usdc.balanceOf(keeper);

        assertApproxEqRel(total - small, small * 2, 1e16, "reward did not scale with size");
    }

    // ------------------------------------------------------------------ bounds

    function test_theIncentiveCannotBeRaisedAboveItsCeiling() public {
        vm.prank(governance);
        vm.expectRevert(
            abi.encodeWithSelector(
                FeeController.AboveCeiling.selector,
                bytes32("liquidatorIncentive"),
                uint256(1_001),
                uint256(1_000)
            )
        );
        feeController.setLiquidatorIncentive(1_001);
    }

    function test_theCombinedTakeIsBoundedEvenWhenEachPartIsNot() public {
        // Each parameter alone is legal; together they exceed what a borrower can be asked to give
        // up in one round. Bounding them individually would miss this entirely.
        vm.startPrank(governance);
        feeController.setLiquidatorIncentive(1_000);
        vm.expectRevert(
            abi.encodeWithSelector(
                FeeController.CombinedLiquidationTakeTooHigh.selector, uint256(1_100), uint256(1_050)
            )
        );
        feeController.setProtocolLiquidationFee(100);
        vm.stopPrank();
    }

    function test_onlyGovernanceMaySetFees() public {
        vm.prank(makeAddr("stranger"));
        vm.expectRevert();
        feeController.setLiquidatorIncentive(100);
    }

    function test_raisingAFeeAdvancesTheEpochAndLoweringDoesNot() public {
        uint64 start = policyReg.riskEpoch();

        vm.prank(governance);
        feeController.setLiquidatorIncentive(600);
        uint64 afterRaise = policyReg.riskEpoch();
        assertGt(afterRaise, start, "raising a fee left outstanding quotes valid");

        vm.prank(governance);
        feeController.setLiquidatorIncentive(400);
        assertEq(policyReg.riskEpoch(), afterRaise, "lowering a fee disturbed quotes it cannot harm");
    }

    function test_feesForProductsThatDoNotExistCannotBeCharged() public {
        vm.startPrank(governance);
        vm.expectRevert(abi.encodeWithSelector(FeeController.ProductNotLive.selector, bytes32("tradingFee")));
        feeController.setTradingFee(10);
        vm.expectRevert(abi.encodeWithSelector(FeeController.ProductNotLive.selector, bytes32("repoFee")));
        feeController.setRepoFee(10);
        vm.stopPrank();
    }

    // ------------------------------------------------------------------ split arithmetic

    function test_theSplitIsExactAndDustFallsToTheDebt() public view {
        // toDebt is the residual by construction, so rounding can never create a wei for a fee at
        // the borrower's expense — it can only ever leave one more on the debt.
        for (uint256 proceeds = 1; proceeds < 1_000; proceeds += 137) {
            (uint256 k, uint256 p, uint256 d) = feeController.splitLiquidationProceeds(proceeds);
            assertEq(k + p + d, proceeds, "the split does not conserve");
        }
    }

    function testFuzz_theSplitAlwaysConserves(uint128 proceeds) public view {
        (uint256 k, uint256 p, uint256 d) = feeController.splitLiquidationProceeds(proceeds);
        assertEq(k + p + d, proceeds);
    }

    function test_aZeroFeeConfigurationSendsEverythingToTheDebt() public {
        vm.startPrank(governance);
        feeController.setLiquidatorIncentive(0);
        feeController.setProtocolLiquidationFee(0);
        vm.stopPrank();

        (uint256 k, uint256 p, uint256 d) = feeController.splitLiquidationProceeds(1_000_000);
        assertEq(k, 0);
        assertEq(p, 0);
        assertEq(d, 1_000_000);
    }

    /// Paying keepers makes each round repair less, because value genuinely leaves the system.
    /// The planner has to price that or it sizes every seizure short.
    function test_thePlannerPricesTheKeeperTake() public {
        _pushIntoMarginCall();
        uint256 withFees = manager.planFor(alice, USTB_ID).seizeValueUsd18;

        vm.startPrank(governance);
        feeController.setLiquidatorIncentive(0);
        feeController.setProtocolLiquidationFee(0);
        vm.stopPrank();

        uint256 withoutFees = manager.planFor(alice, USTB_ID).seizeValueUsd18;
        assertGt(withFees, withoutFees, "the planner ignored the keeper take");
    }
}

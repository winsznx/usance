// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Fixture} from "./Fixture.sol";
import {ClearingHouse} from "../src/core/ClearingHouse.sol";
import {Types} from "../src/libraries/Types.sol";

/**
 * Settlement-price freshness.
 *
 * The rule the whole file exists to prove: a stale or unknown settlement price stops the protocol
 * taking on new risk and does not stop anybody getting out.
 *
 * The threshold is not a guess. `make characterize-feeds` walks 23 rounds of each Chainlink feed on
 * X Layer mainnet; the documented heartbeat is 86,400s and the worst observed gap was 86,479s, so a
 * bound set at one heartbeat would reject feeds that are behaving. The fixture uses two heartbeats,
 * which means a feed has to miss a full publication cycle before Usance refuses new risk.
 *
 * The measurement also found that USDC/USD and USDT/USD — the settlement-relevant pairs — publish
 * only on heartbeat, at a median of 86,419s. A settlement feed is therefore roughly a day stale at
 * almost all times, which is precisely why the threshold could not have been guessed downward.
 */
contract OracleFreshnessTest is Fixture {
    function setUp() public {
        deployProtocol();
        fundLenders(1_000_000e6);
        giveCollateral(alice, 10_000e18);
    }

    /// Refresh the collateral feed so only the settlement feed is old. Warping past every feed's age
    /// would trip the collateral gate too and the test would pass for the wrong reason.
    function _ageOnlyTheSettlementFeed(uint256 by) internal {
        vm.warp(block.timestamp + by);
        ustbFeed.set(1e8, block.timestamp);
    }

    // ------------------------------------------------------------------ configured and fresh

    function test_freshConfiguredFeedPermitsBorrowing() public {
        (bool configured, uint64 maxAge) = clearing.settlementFreshness();
        assertTrue(configured);
        assertEq(maxAge, SETTLEMENT_MAX_PRICE_AGE);

        depositCollateral(alice, 1_000e18);
        vm.prank(alice);
        clearing.borrow(100e18, 0);

        (Types.RiskResult memory r,) = clearing.accountHealth(alice);
        assertEq(r.debtUsd18, 100e18);
    }

    /// A settlement feed a day old is normal, not broken. This pins that the bound is above the
    /// cadence the feeds actually publish at rather than merely above zero.
    function test_aFeedInsideTheBoundIsNotStaleEvenWhenItIsADayOld() public {
        depositCollateral(alice, 1_000e18);
        _ageOnlyTheSettlementFeed(86_400 + 79); // the worst gap measured on mainnet

        vm.prank(alice);
        clearing.borrow(100e18, 0);
    }

    // ------------------------------------------------------------------ stale

    function test_staleFeedBlocksNewBorrowing() public {
        depositCollateral(alice, 1_000e18);
        _ageOnlyTheSettlementFeed(SETTLEMENT_MAX_PRICE_AGE + 1);

        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(
                ClearingHouse.SettlementPriceStale.selector,
                uint64(SETTLEMENT_MAX_PRICE_AGE + 1),
                SETTLEMENT_MAX_PRICE_AGE
            )
        );
        clearing.borrow(100e18, 0);
    }

    function test_staleFeedStillPermitsRepayment() public {
        depositCollateral(alice, 1_000e18);
        vm.prank(alice);
        clearing.borrow(100e18, 0);

        _ageOnlyTheSettlementFeed(SETTLEMENT_MAX_PRICE_AGE * 10);

        usdc.mint(alice, 1_000e6);
        vm.startPrank(alice);
        usdc.approve(address(clearing), type(uint256).max);
        clearing.repay(0, true);
        vm.stopPrank();

        (Types.RiskResult memory r,) = clearing.accountHealth(alice);
        assertEq(r.debtUsd18, 0, "a stale settlement feed locked the exit");
    }

    function test_staleFeedStillPermitsAddingCollateral() public {
        depositCollateral(alice, 1_000e18);
        vm.prank(alice);
        clearing.borrow(100e18, 0);

        _ageOnlyTheSettlementFeed(SETTLEMENT_MAX_PRICE_AGE * 10);

        // Adding collateral reduces risk. Blocking it because a price is old would push accounts
        // toward liquidation for a reason that has nothing to do with them.
        vm.prank(alice);
        clearing.addCollateral(USTB_ID, 1_000e18);

        // Recognised value roughly doubles: the deposit landed even though the settlement price is
        // ten bounds old, because adding collateral is not taking on risk.
        (Types.RiskResult memory r,) = clearing.accountHealth(alice);
        assertGt(r.totalRecognizedUsd18, 1_900e18, "collateral top-up was blocked by a stale settlement feed");
    }

    // ------------------------------------------------------------------ unconfigured

    /**
     * The important case, and the one the previous design got backwards.
     *
     * `maxAge == 0` used to mean "no bound", so a deployment that had simply never been configured
     * was indistinguishable from one that had deliberately opted out — and the shared reading was
     * the permissive one. Every deployment was one forgotten transaction away from lending against
     * a feed that had stopped publishing.
     */
    function test_unconfiguredFreshnessRefusesNewRisk() public {
        vm.prank(governance);
        clearing.clearSettlementFreshness();

        (bool configured,) = clearing.settlementFreshness();
        assertFalse(configured);

        depositCollateral(alice, 1_000e18);
        vm.prank(alice);
        vm.expectRevert(ClearingHouse.SettlementFreshnessUnconfigured.selector);
        clearing.borrow(100e18, 0);
    }

    function test_unconfiguredFreshnessStillPermitsExit() public {
        depositCollateral(alice, 1_000e18);
        vm.prank(alice);
        clearing.borrow(100e18, 0);

        vm.prank(governance);
        clearing.clearSettlementFreshness();

        usdc.mint(alice, 1_000e6);
        vm.startPrank(alice);
        usdc.approve(address(clearing), type(uint256).max);
        clearing.repay(0, true);
        clearing.withdrawCollateral(USTB_ID, 1_000e18);
        vm.stopPrank();

        (Types.RiskResult memory r,) = clearing.accountHealth(alice);
        assertEq(r.debtUsd18, 0);
        assertEq(r.totalRecognizedUsd18, 0, "collateral was trapped by an unconfigured policy");
    }

    /// Zero is rejected rather than quietly accepted as "no bound". A caller who means to stop
    /// enforcing has an explicit function for it, and that function is priced as risk-increasing.
    function test_zeroIsNotAnAcceptableBound() public {
        vm.prank(governance);
        vm.expectRevert(ClearingHouse.SettlementFreshnessUnconfigured.selector);
        clearing.setSettlementMaxPriceAge(0);
    }

    // ------------------------------------------------------------------ epoch behaviour

    function test_relaxingTheBoundAdvancesTheEpoch() public {
        uint64 before = policyReg.riskEpoch();
        vm.prank(governance);
        clearing.setSettlementMaxPriceAge(SETTLEMENT_MAX_PRICE_AGE * 2);
        assertGt(policyReg.riskEpoch(), before, "widening the window left quotes valid under old rules");
    }

    function test_tighteningTheBoundDoesNotAdvanceTheEpoch() public {
        uint64 before = policyReg.riskEpoch();
        vm.prank(governance);
        clearing.setSettlementMaxPriceAge(SETTLEMENT_MAX_PRICE_AGE / 2);
        assertEq(policyReg.riskEpoch(), before, "a tighter bound cannot make an outstanding quote unsafe");
    }

    function test_clearingTheBoundAdvancesTheEpoch() public {
        uint64 before = policyReg.riskEpoch();
        vm.prank(governance);
        clearing.clearSettlementFreshness();
        assertGt(policyReg.riskEpoch(), before);
    }

    /// After the feed recovers, the account quotes again under an epoch that reflects the recovery.
    function test_recoveredFeedRequotesUnderTheCurrentEpoch() public {
        depositCollateral(alice, 1_000e18);
        _ageOnlyTheSettlementFeed(SETTLEMENT_MAX_PRICE_AGE + 1);

        vm.prank(alice);
        vm.expectRevert();
        clearing.borrow(100e18, 0);

        usdcFeed.set(1e8, block.timestamp);

        uint64 epoch = policyReg.riskEpoch();
        vm.prank(alice);
        clearing.borrow(100e18, epoch);

        // Greater-or-equal, not equal: the warp above is long enough for the interest index to move,
        // so the debt is the principal plus a wei. Asserting equality here would be asserting that
        // interest does not accrue.
        (Types.RiskResult memory r,) = clearing.accountHealth(alice);
        assertGe(r.debtUsd18, 100e18);
        assertLt(r.debtUsd18, 100e18 + 1e12, "more than dust interest on a single borrow");
    }

    /// A quote stamped with a superseded epoch is refused even once the feed is healthy again.
    function test_aQuoteFromBeforeTheChangeIsRefused() public {
        depositCollateral(alice, 1_000e18);
        uint64 quotedUnder = policyReg.riskEpoch();

        vm.prank(governance);
        clearing.setSettlementMaxPriceAge(SETTLEMENT_MAX_PRICE_AGE * 2);

        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(ClearingHouse.StaleRiskEpoch.selector, policyReg.riskEpoch(), quotedUnder)
        );
        clearing.borrow(100e18, quotedUnder);
    }

    // ------------------------------------------------------------------ guardian

    /// The guardian can pause a collateral feed. It must not be able to reach the exit, and a stale
    /// settlement price must not hand it that power indirectly.
    function test_noGuardianInducedRepaymentLockout() public {
        depositCollateral(alice, 1_000e18);
        vm.prank(alice);
        clearing.borrow(100e18, 0);

        vm.prank(guardian);
        vm.expectRevert();
        oracle.disableFeed(USDC_ID);

        _ageOnlyTheSettlementFeed(SETTLEMENT_MAX_PRICE_AGE * 10);

        usdc.mint(alice, 1_000e6);
        vm.startPrank(alice);
        usdc.approve(address(clearing), type(uint256).max);
        clearing.repay(0, true);
        vm.stopPrank();

        (Types.RiskResult memory r,) = clearing.accountHealth(alice);
        assertEq(r.debtUsd18, 0);
    }
}

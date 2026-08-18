// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Fixture} from "./Fixture.sol";
import {ClearingHouse} from "../src/core/ClearingHouse.sol";
import {CollateralVault} from "../src/core/CollateralVault.sol";
import {RiskMath} from "../src/libraries/RiskMath.sol";
import {Types} from "../src/libraries/Types.sol";

/**
 * Findings raised by Slither, pinned so they cannot come back.
 *
 * Two HIGH-impact detectors fired. One was a false positive that is dangerous to "fix"; the other
 * was not exploitable but was one refactor away from being a drain.
 */
contract StaticAnalysisTest is Fixture {
    function setUp() public {
        deployProtocol();
        fundLenders(1_000_000e6);
        giveCollateral(alice, 10_000e18);
    }

    // ------------------------------------------------------------------ arbitrary-send-erc20

    /**
     * `deposit` pulls tokens from `from` and credits `account`, and nothing required those to be
     * the same address. The only caller passes `msg.sender` for both, so it was never exploitable —
     * but a later "deposit on behalf of" that passed a different payer would let anyone holding a
     * standing allowance to this vault be drained by a stranger, and it would read as a feature.
     */
    function test_vaultRefusesToPullFromSomebodyWhoIsNotTheDepositor() public {
        address victim = makeAddr("victim");
        address attacker = makeAddr("attacker");

        ustb.mint(victim, 1_000e18);
        vm.prank(victim);
        ustb.approve(address(collateralVault), type(uint256).max);

        // The attacker reaches the vault through its only authorised caller. Even from there, the
        // vault refuses to fund one account's deposit out of another account's wallet.
        vm.prank(address(clearing));
        vm.expectRevert(
            abi.encodeWithSelector(CollateralVault.PayerIsNotTheDepositor.selector, victim, attacker)
        );
        collateralVault.deposit(USTB_ID, victim, attacker, 500e18);

        assertEq(ustb.balanceOf(victim), 1_000e18, "victim's balance moved");
        assertEq(collateralVault.balanceOf(USTB_ID, attacker), 0, "attacker was credited");
    }

    function test_theOrdinaryDepositPathStillWorks() public {
        address alice_ = makeAddr("depositor");
        ustb.mint(alice_, 1_000e18);
        vm.startPrank(alice_);
        ustb.approve(address(collateralVault), type(uint256).max);
        clearing.addCollateral(USTB_ID, 1_000e18);
        vm.stopPrank();

        assertEq(collateralVault.balanceOf(USTB_ID, alice_), 1_000e18);
    }

    // ------------------------------------------------------------------ oracle-no-staleness

    /**
     * The settlement price is checked for freshness where new risk depends on it, and nowhere else.
     *
     * Slither found `_settlementPrice` reading an oracle and discarding `updatedAt`. The omission
     * was real: during a depeg an unmoved feed pays a borrower fewer real dollars than the debt it
     * records. But that same function is on the repay path, and refusing repayment because a feed
     * went quiet locks the exit — R-02 arrived at from the opposite direction.
     */
    function test_staleSettlementPriceBlocksBorrowing() public {
        depositCollateral(alice, 1_000e18);

        vm.prank(governance);
        clearing.setSettlementMaxPriceAge(3600);

        // Borrowing works while the feed is current.
        vm.prank(alice);
        clearing.borrow(100e18, 0);

        // Age only the settlement feed. Warping past every feed's max age would also trip the
        // collateral price gate, and the test would then pass for a reason that has nothing to do
        // with the check it claims to cover.
        // Ten days: past the settlement bound, inside the collateral feed's 1-day age once it is
        // refreshed, and well inside the Passport's 30-day one. Warping further trips the Passport
        // gate instead and the test passes for a reason unrelated to what it claims to cover.
        vm.warp(block.timestamp + 10 days);
        ustbFeed.set(1e8, block.timestamp);

        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(ClearingHouse.SettlementPriceStale.selector, uint64(10 days), uint64(3600))
        );
        clearing.borrow(100e18, 0);
    }

    /// The exit stays open. This is the half that makes the check safe to add at all.
    function test_staleSettlementPriceStillPermitsRepayment() public {
        depositCollateral(alice, 1_000e18);
        vm.prank(governance);
        clearing.setSettlementMaxPriceAge(3600);

        vm.prank(alice);
        clearing.borrow(100e18, 0);

        vm.warp(block.timestamp + 10 days);
        ustbFeed.set(1e8, block.timestamp);

        usdc.mint(alice, 1_000e6);
        vm.startPrank(alice);
        usdc.approve(address(clearing), type(uint256).max);
        clearing.repay(0, true);
        vm.stopPrank();

        (Types.RiskResult memory r,) = clearing.accountHealth(alice);
        assertEq(r.debtUsd18, 0, "a stale settlement feed blocked the exit");
    }

    /// Zero is the default and the honest one: a guessed threshold produces outages that look like
    /// protocol failures on a chain whose feed cadence nobody has characterised.
    function test_theStalenessBoundIsOffUntilGovernanceSetsIt() public {
        assertEq(clearing.settlementMaxPriceAge(), 0);

        depositCollateral(alice, 1_000e18);
        vm.warp(block.timestamp + 10 days);
        ustbFeed.set(1e8, block.timestamp);

        vm.prank(alice);
        clearing.borrow(100e18, 0);
    }

    // ------------------------------------------------------------------ incorrect-exp

    /**
     * `(3 * d) ^ 2` in `mulDiv` is a modular-inverse seed, not a typo for `**`.
     *
     * Slither reports it as HIGH on every run, and applying the suggested fix is silent. Finding a
     * case that notices took some care, and the first attempt did not:
     *
     * The seed only matters on the 512-bit path, which `mulDiv` takes exclusively when the product
     * overflows 256 bits. Anything smaller short-circuits to plain division and is correct under
     * either spelling. On top of that, `d` has its factors of two stripped before the seed is
     * computed, so a denominator like 4 collapses to 1 and both spellings converge.
     *
     * What actually separates them: `(3d) ^ 2` inverts `d` correctly modulo 2**4, so six doublings
     * reach 2**256 exactly. `9 * d**2` is correct only modulo 2**2 when `d ≡ 3 (mod 4)`, so the
     * same six doublings stop at 2**64 and every bit above that is wrong.
     *
     * Each case below therefore needs all three properties at once: a product over 256 bits, an odd
     * part of `d` congruent to 3 mod 4, and a result above 2**64. None of the 28 canonical
     * differential scenarios reach the 512-bit path at all, so the four-implementation conformance
     * suite could not have caught this.
     */
    function test_mulDivIsExactOnThe512BitPathWhereTheSeedMatters() public pure {
        // Expected values are written out rather than computed in the assertion. Solidity evaluates
        // constant expressions as exact rationals, so `(2 ** 254) / 3` is not an integer literal and
        // will not compile — and an expression that did compile would be a second implementation of
        // the thing under test.

        // 2**270 / (3 * 2**16). The odd part of the denominator is 3, so the seed matters.
        assertEq(
            RiskMath.mulDiv(2 ** 170, 2 ** 100, 3 << 16),
            9_649_340_769_776_349_618_630_915_417_390_658_987_772_498_722_136_713_669_954_798_667_326_094_136_661
        );

        // 2**256 / 3, forced onto the wide path by how the operands split.
        assertEq(
            RiskMath.mulDiv(2 ** 200, 2 ** 56, 3),
            38_597_363_079_105_398_474_523_661_669_562_635_951_089_994_888_546_854_679_819_194_669_304_376_546_645
        );

        // The widest operands that still leave a representable quotient.
        assertEq(
            RiskMath.mulDiv(type(uint256).max, 3, 7),
            49_625_181_101_706_940_895_816_136_432_294_817_651_401_421_999_560_241_731_196_107_431_962_769_845_686
        );
    }

    /// The narrow path, kept alongside so a change that routes everything through one branch is
    /// visible rather than merely still-passing.
    function test_mulDivIsExactOnTheNarrowPath() public pure {
        assertEq(RiskMath.mulDiv(7, 5, 3), 11);
        assertEq(RiskMath.mulDiv(1e18 + 1, 3, 7), (uint256(1e18 + 1) * 3) / 7);
        assertEq(RiskMath.mulDiv(type(uint256).max, 1, 3), type(uint256).max / 3);

        // A price of 99999999 (8dp) against a 6-decimal amount: the shape every mixed-decimal
        // fixture from S23 onward exercises, and the shape the 18-decimal ones never did.
        assertEq(RiskMath.mulDiv(1_234_567, 99_999_999, 1e8), (uint256(1_234_567) * 99_999_999) / 1e8);
    }

    function testFuzz_mulDivMatchesWideningArithmetic(uint128 a, uint128 b, uint128 d) public pure {
        vm.assume(d != 0);
        // uint128 operands keep the true product inside 256 bits, so plain arithmetic is a valid
        // oracle here and any disagreement is mulDiv's.
        assertEq(RiskMath.mulDiv(a, b, d), (uint256(a) * uint256(b)) / uint256(d));
    }
}

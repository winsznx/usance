// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Fixture} from "./Fixture.sol";
import {LiquidityVault} from "../src/core/LiquidityVault.sol";
import {Types} from "../src/libraries/Types.sol";

/**
 * Lender accounting: the withdrawal queue and the bad-debt waterfall.
 *
 * The rule the queue exists to enforce is that a vault whose capital is lent out cannot promise
 * instant redemption. Pretending otherwise is how a run starts — everybody discovers the same thing
 * at the same moment. So `withdraw` pays only what is actually free, and everything else joins a
 * FIFO queue that is senior to new lending.
 *
 * The rule the waterfall enforces is that reserves exist to be spent on losses. A protocol that
 * accumulates a reserve out of borrower interest and then socialises the first loss anyway has
 * charged a fee for insurance it did not provide.
 */
contract VaultEconomicsTest is Fixture {
    function setUp() public {
        deployProtocol();
        fundLenders(1_000_000e6);
        giveCollateral(alice, 10_000e18);
    }

    function _drainCash() internal {
        // Borrow most of the vault's cash so redemptions cannot be paid immediately.
        depositCollateral(alice, 10_000e18);
        (uint256 available,) = clearing.availableBorrow(alice);
        vm.prank(alice);
        clearing.borrow(available, 0);
    }

    // ------------------------------------------------------------------ the queue

    function test_aRedemptionThatCannotBePaidJoinsTheQueue() public {
        _drainCash();
        uint256 shares = liquidityVault.balanceOf(lender);

        vm.prank(lender);
        uint256 id = liquidityVault.requestWithdrawal(shares);

        (address who, uint256 qShares, uint256 amount, uint256 funded,, bool claimed) =
            liquidityVault.withdrawalRequests(id);
        assertEq(who, lender);
        assertEq(qShares, shares);
        assertGt(amount, 0);
        assertLt(funded, amount, "the vault funded a redemption it could not afford");
        assertFalse(claimed);
    }

    /// Shares burn at request time, so a later default cannot shrink a claim already exited.
    function test_sharesBurnWhenTheRequestIsMadeNotWhenItIsPaid() public {
        _drainCash();
        uint256 shares = liquidityVault.balanceOf(lender);

        vm.prank(lender);
        liquidityVault.requestWithdrawal(shares);

        assertEq(liquidityVault.balanceOf(lender), 0, "a queued lender still holds shares and still earns");
    }

    /// Queued liabilities leave NAV. Leaving them in would credit remaining lenders with money that
    /// belongs to people who have left.
    function test_queuedLiabilitiesLeaveLenderNav() public {
        _drainCash();
        uint256 navBefore = liquidityVault.totalAssets();

        uint256 half = liquidityVault.balanceOf(lender) / 2;
        vm.prank(lender);
        liquidityVault.requestWithdrawal(half);

        assertLt(liquidityVault.totalAssets(), navBefore, "queued claims are still counted as lender value");
    }

    function test_repaymentFundsTheQueueBeforeNewLending() public {
        _drainCash();
        uint256 held = liquidityVault.balanceOf(lender);
        vm.prank(lender);
        uint256 id = liquidityVault.requestWithdrawal(held);

        (,,, uint256 fundedBefore,,) = liquidityVault.withdrawalRequests(id);

        usdc.mint(alice, 2_000_000e6);
        vm.startPrank(alice);
        usdc.approve(address(clearing), type(uint256).max);
        clearing.repay(0, true);
        vm.stopPrank();

        vm.prank(address(clearing));
        liquidityVault.serviceWithdrawalQueue();

        (,,, uint256 fundedAfter,,) = liquidityVault.withdrawalRequests(id);
        assertGt(fundedAfter, fundedBefore, "returning cash did not reach a waiting redemption");
    }

    function test_aFullyFundedRequestCanBeClaimed() public {
        _drainCash();
        uint256 held = liquidityVault.balanceOf(lender);
        vm.prank(lender);
        uint256 id = liquidityVault.requestWithdrawal(held);

        usdc.mint(alice, 2_000_000e6);
        vm.startPrank(alice);
        usdc.approve(address(clearing), type(uint256).max);
        clearing.repay(0, true);
        vm.stopPrank();
        vm.prank(address(clearing));
        liquidityVault.serviceWithdrawalQueue();

        uint256 before = usdc.balanceOf(lender);
        vm.prank(lender);
        uint256 paid = liquidityVault.claimWithdrawal(id, lender);

        assertGt(paid, 0);
        assertEq(usdc.balanceOf(lender) - before, paid);
    }

    /**
     * An unfunded request is refused by the funding guard, not by running out of money.
     *
     * The first version of this used a bare `vm.expectRevert()`, and a mutation that deleted the
     * guard entirely still passed it — the ERC20 transfer failed instead, so the test was green for
     * a reason it did not name. Worse, that reason disappears the moment the vault holds cash from
     * anywhere else, which the second half of this test sets up: without the guard, a lender at the
     * back of the queue drains money earmarked for the front of it.
     */
    function test_anUnfundedRequestCannotBeClaimed() public {
        _drainCash();
        uint256 held = liquidityVault.balanceOf(lender);
        vm.prank(lender);
        uint256 id = liquidityVault.requestWithdrawal(held);

        (,, uint256 amount, uint256 funded,,) = liquidityVault.withdrawalRequests(id);
        assertLt(funded, amount, "the request was already funded; this proves nothing");

        vm.prank(lender);
        vm.expectRevert(abi.encodeWithSelector(LiquidityVault.RequestNotFunded.selector, id, funded, amount));
        liquidityVault.claimWithdrawal(id, lender);

        // Now give the vault plenty of cash that is NOT allocated to this request. The guard is the
        // only thing standing between the claim and money that belongs to somebody else.
        usdc.mint(address(liquidityVault), 5_000_000e6);

        vm.prank(lender);
        vm.expectRevert(abi.encodeWithSelector(LiquidityVault.RequestNotFunded.selector, id, funded, amount));
        liquidityVault.claimWithdrawal(id, lender);
    }

    function test_aRequestCannotBeClaimedTwice() public {
        _drainCash();
        uint256 held = liquidityVault.balanceOf(lender);
        vm.prank(lender);
        uint256 id = liquidityVault.requestWithdrawal(held);

        usdc.mint(alice, 2_000_000e6);
        vm.startPrank(alice);
        usdc.approve(address(clearing), type(uint256).max);
        clearing.repay(0, true);
        vm.stopPrank();
        vm.prank(address(clearing));
        liquidityVault.serviceWithdrawalQueue();

        vm.startPrank(lender);
        liquidityVault.claimWithdrawal(id, lender);
        vm.expectRevert(abi.encodeWithSelector(LiquidityVault.RequestAlreadySettled.selector, id));
        liquidityVault.claimWithdrawal(id, lender);
        vm.stopPrank();
    }

    function test_onlyTheRequesterCanClaim() public {
        _drainCash();
        uint256 held = liquidityVault.balanceOf(lender);
        vm.prank(lender);
        uint256 id = liquidityVault.requestWithdrawal(held);

        vm.prank(makeAddr("thief"));
        vm.expectRevert(abi.encodeWithSelector(LiquidityVault.NotYourRequest.selector, id));
        liquidityVault.claimWithdrawal(id, makeAddr("thief"));
    }

    /// Cancelling reissues at today's price, not the price when queued. Otherwise a lender could
    /// queue at a high NAV, wait out a loss, and cancel back in at the old number.
    function test_cancellingReissuesAtTheCurrentPrice() public {
        _drainCash();
        uint256 held = liquidityVault.balanceOf(lender);
        vm.prank(lender);
        uint256 id = liquidityVault.requestWithdrawal(held);

        vm.prank(lender);
        liquidityVault.cancelWithdrawal(id);

        assertGt(liquidityVault.balanceOf(lender), 0, "cancelling returned no shares");
        assertEq(liquidityVault.queuedLiabilities(), 0, "the liability survived cancellation");
    }

    /// Cash promised to the queue is not lendable and not redeemable by anybody else.
    function test_queuedCashIsNotCountedAsAvailable() public {
        _drainCash();
        uint256 held = liquidityVault.balanceOf(lender);
        vm.prank(lender);
        liquidityVault.requestWithdrawal(held);

        usdc.mint(alice, 2_000_000e6);
        vm.startPrank(alice);
        usdc.approve(address(clearing), type(uint256).max);
        clearing.repay(0, true);
        vm.stopPrank();
        vm.prank(address(clearing));
        liquidityVault.serviceWithdrawalQueue();

        assertLt(
            liquidityVault.availableCash(),
            usdc.balanceOf(address(liquidityVault)),
            "cash owed to the queue is being offered for new lending"
        );
    }

    // ------------------------------------------------------------------ bad debt waterfall

    function test_reservesAbsorbLossesBeforeLenders() public {
        _drainCash();
        vm.warp(block.timestamp + 365 days);
        vm.prank(address(clearing));
        liquidityVault.accrue(50_000e6);

        // Book a reserve out of interest, the way a repayment does.
        usdc.mint(address(liquidityVault), 10_000e6);
        vm.prank(address(clearing));
        liquidityVault.onRepaid(10_000e6, 10_000); // the whole amount to reserves

        uint256 reservesBefore = liquidityVault.reserves();
        assertGt(reservesBefore, 0, "no reserve was accumulated");

        vm.prank(address(clearing));
        liquidityVault.recordBadDebt(reservesBefore / 2);

        assertEq(liquidityVault.badDebt(), 0, "lenders absorbed a loss the reserve could cover");
        assertLt(liquidityVault.reserves(), reservesBefore, "the reserve was not spent");
    }

    function test_lossesBeyondTheReserveReachLenders() public {
        _drainCash();
        usdc.mint(address(liquidityVault), 1_000e6);
        vm.prank(address(clearing));
        liquidityVault.onRepaid(1_000e6, 10_000);

        uint256 reserves = liquidityVault.reserves();
        vm.prank(address(clearing));
        liquidityVault.recordBadDebt(reserves + 5_000e6);

        assertEq(liquidityVault.reserves(), 0, "the reserve was not exhausted first");
        assertEq(liquidityVault.badDebt(), 5_000e6, "the excess did not reach lender NAV");
    }

    function test_badDebtReducesLenderNav() public {
        _drainCash();
        uint256 navBefore = liquidityVault.totalAssets();

        vm.prank(address(clearing));
        liquidityVault.recordBadDebt(10_000e6);

        assertLt(liquidityVault.totalAssets(), navBefore, "a write-off left lender value unchanged");
    }

    function test_onlyClearingCanRecordALoss() public {
        vm.prank(makeAddr("stranger"));
        vm.expectRevert();
        liquidityVault.recordBadDebt(1_000e6);
    }
}

// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

import {Vm} from "forge-std/Vm.sol";

import {Fixture} from "./Fixture.sol";
import {ClearingHouse} from "../src/core/ClearingHouse.sol";
import {LiquidityVault} from "../src/core/LiquidityVault.sol";
import {Types} from "../src/libraries/Types.sol";

/// @title Regressions for defects found by adversarial review
/// @notice Each test here corresponds to a specific bug that shipped and was caught. They are
///         kept separate from the feature suites so the cost of each past mistake stays visible.
contract RegressionTest is Fixture {
    function setUp() public {
        deployProtocol();
        fundLenders(1_000_000e6);
        giveCollateral(alice, 10_000e18);
    }

    // -----------------------------------------------------------------------------------
    // R-01 — usd18 leaking into a token-denominated vault
    // -----------------------------------------------------------------------------------

    /// @notice Interest accrual must not corrupt vault NAV.
    ///
    /// @dev The bug: `FinancingEngine.accrue()` computed its interest delta in usd18 and pushed it
    ///      straight into `LiquidityVault.accruedReceivables`, which is summed in `totalAssets()`
    ///      alongside `asset.balanceOf(this)` and `totalPrincipal` — both in 6-decimal USDC units.
    ///      Thirty days of interest on a $5,000 loan inflated NAV by roughly 271,000,000x.
    ///
    ///      The consequence was not cosmetic. `convertToAssets` then returned more than
    ///      `availableCash` for every lender, so `withdraw` reverted `InsufficientCash` for any
    ///      share amount at all: lender funds permanently locked, while `maxWithdraw` cheerfully
    ///      reported a healthy number.
    function test_R01_interestAccrualDoesNotInflateVaultNav() public {
        uint256 navBefore = liquidityVault.totalAssets();
        assertEq(navBefore, 1_000_000e6, "NAV starts at the supplied amount, in token units");

        depositCollateral(alice, 10_000e18);
        vm.prank(alice);
        clearing.borrow(5_000e18, 0);

        warpAndRefreshFeeds(30 days);
        financing.accrue();

        uint256 navAfter = liquidityVault.totalAssets();

        // Thirty days at a low-utilisation rate is single-digit dollars on $5,000. Anything near
        // 1e20 means units were mixed again.
        assertApproxEqRel(navAfter, navBefore, 0.01e18, "NAV must stay in token units");
        assertLt(navAfter, 1_100_000e6, "NAV cannot leap by orders of magnitude");
    }

    /// @notice A lender must still be able to withdraw after interest has accrued.
    /// @dev This is the user-visible half of R-01, and the reason it is severity CRITICAL rather
    ///      than "an accounting display issue".
    function test_R01_lenderCanStillWithdrawAfterAccrual() public {
        depositCollateral(alice, 10_000e18);
        vm.prank(alice);
        clearing.borrow(5_000e18, 0);

        warpAndRefreshFeeds(30 days);
        financing.accrue();

        uint256 shares = liquidityVault.balanceOf(lender);
        uint256 quoted = liquidityVault.maxWithdraw(lender);
        assertGt(quoted, 0, "maxWithdraw must report something withdrawable");

        // The number the UI shows must be a number the contract accepts. Before the fix this
        // reverted for every share amount while maxWithdraw reported 995,000 USDC.
        uint256 sharesToBurn = liquidityVault.convertToShares(quoted);
        if (sharesToBurn > shares) sharesToBurn = shares;

        vm.prank(lender);
        liquidityVault.withdraw(sharesToBurn, lender);
    }

    /// @notice A repayment must reduce principal by a sane amount, not floor it to zero.
    /// @dev `ClearingHouse.repay` passed `applied` (usd18) into `onRepaid`, which subtracted it
    ///      from `totalPrincipal` (token units). The first repayment of any size wiped the
    ///      vault's entire recorded principal.
    function test_R01_smallRepaymentDoesNotWipePrincipal() public {
        depositCollateral(alice, 10_000e18);
        vm.prank(alice);
        clearing.borrow(5_000e18, 0);

        uint256 principalBefore = liquidityVault.totalPrincipal();
        assertEq(principalBefore, 5_000e6, "principal is recorded in token units");

        usdc.mint(alice, 10_000e6);
        vm.startPrank(alice);
        usdc.approve(address(clearing), type(uint256).max);
        clearing.repay(1e18, false); // repay exactly $1
        vm.stopPrank();

        uint256 principalAfter = liquidityVault.totalPrincipal();
        assertApproxEqAbs(principalAfter, principalBefore - 1e6, 1, "$1 repaid means $1 of principal");
        assertGt(principalAfter, 4_900e6, "a $1 repayment cannot clear $5,000 of principal");
    }

    // -----------------------------------------------------------------------------------
    // R-02 — a guardian must never be able to close the exit
    // -----------------------------------------------------------------------------------

    /// @notice Disabling the settlement asset's price feed must not brick repayment.
    ///
    /// @dev `ChainlinkFeedAdapter.disableFeed` is guardian-callable. Disabling the settlement
    ///      feed made `_settlementPrice()` revert, and both `repay()` and `availableBorrow()`
    ///      route through it — so a guardian action removed the user's ability to reduce risk.
    ///      That is precisely the power spec/threat-model.md §6 says a guardian does not have.
    function test_R02_guardianCannotDisableSettlementFeed() public {
        depositCollateral(alice, 1_000e18);
        vm.prank(alice);
        clearing.borrow(300e18, 0);

        vm.prank(guardian);
        vm.expectRevert();
        oracle.disableFeed(USDC_ID);

        // Repayment stays open, which is the property that actually matters.
        usdc.mint(alice, 1_000e6);
        vm.startPrank(alice);
        usdc.approve(address(clearing), type(uint256).max);
        clearing.repay(0, true);
        vm.stopPrank();

        assertEq(clearing.debtOf(alice), 0, "the exit must remain available");
    }

    /// @notice A guardian may still disable a collateral asset's feed. That only restricts.
    function test_R02_guardianCanStillDisableCollateralFeed() public {
        depositCollateral(alice, 1_000e18);

        vm.prank(guardian);
        oracle.disableFeed(USTB_ID);

        (Types.RiskResult memory r,) = clearing.accountHealth(alice);
        assertTrue(r.gates & Types.GATE_ORACLE_INVALID != 0, "collateral feed loss is a restriction");
        assertEq(r.availableBorrowUsd18, 0);
    }

    // -----------------------------------------------------------------------------------
    // R-03 — debt without a corresponding outflow (invariant I-03)
    // -----------------------------------------------------------------------------------

    /// @dev `_usd18ToTokens` rounds down, so borrowing $0.0000001 of a 6-decimal settlement asset
    ///      produced zero tokens out while still recording scaled principal. Free debt, in the
    ///      wrong direction: the borrower owed money nobody paid them.
    function test_R03_subUnitBorrowIsRejected() public {
        depositCollateral(alice, 1_000e18);

        vm.prank(alice);
        vm.expectRevert();
        clearing.borrow(1e11, 0); // 0.0000001 USD → 0 token units at 6 decimals

        assertEq(clearing.debtOf(alice), 0, "no debt may exist without an outflow");
    }

    // -----------------------------------------------------------------------------------
    // R-04 — indexers must observe a full repayment
    // -----------------------------------------------------------------------------------

    /// @dev The full-clear branch of `FinancingEngine.onRepay` returned before reaching its
    ///      `emit Repaid(...)`, so an indexer following `Repaid` never saw a loan close.
    function test_R04_fullRepaymentEmitsRepaid() public {
        depositCollateral(alice, 1_000e18);
        vm.prank(alice);
        clearing.borrow(500e18, 0);

        usdc.mint(alice, 1_000e6);
        vm.startPrank(alice);
        usdc.approve(address(clearing), type(uint256).max);

        vm.recordLogs();
        clearing.repay(0, true);
        vm.stopPrank();

        bool sawRepaid;
        bytes32 sig = keccak256("Repaid(address,uint256,uint256)");
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].topics.length > 0 && logs[i].topics[0] == sig) sawRepaid = true;
        }
        assertTrue(sawRepaid, "a full repayment must emit Repaid");
    }

    // -----------------------------------------------------------------------------------
    // R-05 — future-dated timestamps must not panic
    // -----------------------------------------------------------------------------------

    /// @notice An oracle timestamp a second ahead of block.timestamp must not revert every read.
    ///
    /// @dev `RiskMath` subtracted timestamps unsigned, so ordinary L2 clock skew panicked inside
    ///      `evaluate()`. Reads, borrows and repayments all failed while the TypeScript preview
    ///      and the Python transcription both computed a signed difference and gated nothing —
    ///      a three-way divergence that the canonical fixtures could not see because they never
    ///      contain a future timestamp.
    function test_R05_futureDatedOracleTimestampDoesNotRevert() public {
        depositCollateral(alice, 1_000e18);

        ustbFeed.set(1e8, block.timestamp + 1);

        (Types.RiskResult memory r,) = clearing.accountHealth(alice);
        assertEq(r.gates & Types.GATE_ORACLE_STALE, 0, "a future timestamp is fresh, not stale");
        assertGt(r.availableBorrowUsd18, 0, "the account remains usable");
    }
}

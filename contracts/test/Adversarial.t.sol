// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

import {stdError} from "forge-std/StdError.sol";

import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {Fixture} from "./Fixture.sol";
import {Authority, Authorized} from "../src/core/Authority.sol";
import {ClearingHouse} from "../src/core/ClearingHouse.sol";
import {ChainlinkFeedAdapter} from "../src/adapters/ChainlinkFeedAdapter.sol";
import {CollateralVault} from "../src/core/CollateralVault.sol";
import {
    EmergencyController,
    IAccountStatusRestrictor,
    IAssetStatusRestrictor,
    IRiskEpochBumper
} from "../src/core/EmergencyController.sol";
import {Types} from "../src/libraries/Types.sol";

import {
    FalseReturnToken,
    FeeOnTransferToken,
    HostileAggregator,
    IVaultProbe,
    NoReturnToken,
    PlainToken,
    RebasingToken,
    ReentrantToken,
    ShiftingBalanceToken
} from "./mocks/Hostile.sol";

/// @notice The three functions every fixture token in this suite shares.
/// @dev Lets the funding helper stay one line per token instead of one overload per token; the
///      hostile behaviour under test is never in `mint` or `approve`.
interface IMintableToken {
    function mint(address to, uint256 value) external;
    function approve(address spender, uint256 value) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/// @title Adversarial custody, token and oracle behaviour
/// @notice Invariants I-25 (guardians restrict only), I-32 (reentrancy), I-33 (measured delta)
///         and I-34 (rebase solvency), driven by fixtures that actually misbehave.
///
/// @dev Two of the tests below assert behaviour that is wrong and say so in their names. They are
///      here because a finding recorded as a passing test that flips when the bug is fixed is
///      worth more than a finding recorded in a document nobody reruns. Neither assertion has
///      been weakened to make the suite green — each asserts exactly what the current code does,
///      and the doc comment says what it should do instead.
contract AdversarialTest is Fixture {
    EmergencyController internal emergency;

    address internal bob = address(0xB0B);

    bytes32 internal constant REASON = keccak256("INCIDENT_2026_08");

    /// @dev Cached because `authority.ROLE()` is an external call, and an external call in the
    ///      argument list of a pranked statement consumes the prank before the pranked call is
    ///      made. `Fixture` records the same hazard for `vm.prank` plus an inline balance read.
    bytes32 internal GOVERNANCE_ROLE;
    bytes32 internal GUARDIAN_ROLE;
    bytes32 internal CLEARING_ROLE;

    function setUp() public {
        deployProtocol();
        fundLenders(1_000_000e6);
        giveCollateral(alice, 10_000e18);

        GOVERNANCE_ROLE = authority.GOVERNANCE();
        GUARDIAN_ROLE = authority.GUARDIAN();
        CLEARING_ROLE = authority.CLEARING();

        emergency = new EmergencyController(
            authority,
            IAssetStatusRestrictor(address(assetsReg)),
            IAccountStatusRestrictor(address(clearing)),
            IRiskEpochBumper(address(policyReg))
        );

        vm.prank(governance);
        authority.grantRole(GUARDIAN_ROLE, address(emergency));
    }

    // ---------------------------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------------------------

    /// @dev Admits a fixture token through the same path a real asset walks: register, bind a
    ///      policy, wire a feed, commit a Passport, grant capabilities, activate. Short-cutting
    ///      any of these in a test would mean the hostile token is exercised against a
    ///      configuration that cannot exist in production.
    function _admitAsset(address token, uint8 dec, int256 priceAnswer)
        internal
        returns (bytes32 assetId, HostileAggregator feed)
    {
        vm.prank(admission);
        assetId = assetsReg.registerAsset(block.chainid, token, keccak256("HOSTILE_UNDERLYING"), dec);

        vm.prank(governance);
        assetsReg.bindRiskPolicy(assetId, POLICY_TBILL);

        feed = new HostileAggregator(8, priceAnswer, block.timestamp);
        vm.prank(governance);
        oracle.setFeed(assetId, address(feed));

        vm.startPrank(admission);
        passportReg.commitPassport(
            assetId, 1, keccak256("HOSTILE_EVIDENCE"), keccak256("HOSTILE_CLAIMS"), 0, true, 9900, false
        );
        assetsReg.setCapabilities(
            assetId,
            uint16(1) << uint16(Types.Capability.HOLD) | uint16(1) << uint16(Types.Capability.COLLATERAL)
        );
        vm.stopPrank();

        vm.prank(governance);
        assetsReg.setStatus(assetId, Types.AssetStatus.ACTIVE);
    }

    function _fund(address token, address who, uint256 amount) internal {
        IMintableToken(token).mint(who, amount);
        vm.prank(who);
        IMintableToken(token).approve(address(collateralVault), type(uint256).max);
    }

    function _selectorOf(bytes memory data) internal pure returns (bytes4 sel) {
        if (data.length < 4) return bytes4(0);
        assembly ("memory-safe") {
            sel := mload(add(data, 0x20))
        }
    }

    // ---------------------------------------------------------------------------------
    // I-32 — reentrancy
    // ---------------------------------------------------------------------------------

    function test_reentrantTokenCannotReenterDeposit() public {
        ReentrantToken tok = new ReentrantToken();
        (bytes32 id,) = _admitAsset(address(tok), 18, 1e8);
        _fund(address(tok), alice, 1_000e18);

        tok.arm(address(clearing), abi.encodeCall(ClearingHouse.addCollateral, (id, 100e18)), true);

        vm.prank(alice);
        clearing.addCollateral(id, 1_000e18);

        assertEq(tok.attempts(), 1, "the fixture must actually have tried");
        assertFalse(tok.lastCallSucceeded(), "reentrant deposit must fail");
        assertEq(
            _selectorOf(tok.lastReturnData()),
            ReentrancyGuard.ReentrancyGuardReentrantCall.selector,
            "must fail on the guard, not on something incidental"
        );

        // Credited exactly once, at the measured amount, and no second position appeared.
        assertEq(collateralVault.balanceOf(id, alice), 1_000e18, "credited once");
        assertEq(collateralVault.totalDeposited(id), 1_000e18, "ledger total credited once");
        assertEq(clearing.heldAssets(alice).length, 1, "one held asset");
        assertTrue(collateralVault.isSolvent(id), "I-01");
    }

    function test_reentrantTokenCannotReenterWithdraw() public {
        ReentrantToken tok = new ReentrantToken();
        (bytes32 id,) = _admitAsset(address(tok), 18, 1e8);
        _fund(address(tok), alice, 1_000e18);

        vm.prank(alice);
        clearing.addCollateral(id, 1_000e18);

        tok.arm(address(clearing), abi.encodeCall(ClearingHouse.withdrawCollateral, (id, 500e18)), true);

        vm.prank(alice);
        clearing.withdrawCollateral(id, 500e18);

        assertEq(tok.attempts(), 1);
        assertFalse(tok.lastCallSucceeded(), "reentrant withdraw must fail");
        assertEq(_selectorOf(tok.lastReturnData()), ReentrancyGuard.ReentrancyGuardReentrantCall.selector);

        // The double-spend the reentry was reaching for: 500 out, not 1,000.
        assertEq(tok.balanceOf(alice), 500e18, "exactly one withdrawal was paid");
        assertEq(collateralVault.balanceOf(id, alice), 500e18);
        assertEq(collateralVault.totalDeposited(id), 500e18);
        assertTrue(collateralVault.isSolvent(id), "I-01");
    }

    function test_reentrantTokenCannotBorrowOrRepayMidTransfer() public {
        ReentrantToken tok = new ReentrantToken();
        (bytes32 id,) = _admitAsset(address(tok), 18, 1e8);
        _fund(address(tok), alice, 2_000e18);

        vm.prank(alice);
        clearing.addCollateral(id, 1_000e18);

        tok.arm(address(clearing), abi.encodeCall(ClearingHouse.borrow, (100e18, 0)), true);
        vm.prank(alice);
        clearing.addCollateral(id, 1_000e18);

        assertFalse(tok.lastCallSucceeded(), "borrow must not execute from inside a transfer");
        assertEq(_selectorOf(tok.lastReturnData()), ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        assertEq(clearing.debtOf(alice), 0, "no debt was created mid-transfer");

        tok.arm(address(clearing), abi.encodeCall(ClearingHouse.repay, (1e18, false)), true);
        vm.prank(alice);
        clearing.withdrawCollateral(id, 1e18);

        assertFalse(tok.lastCallSucceeded(), "repay must not execute from inside a transfer");
        assertEq(_selectorOf(tok.lastReturnData()), ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
    }

    /// @dev Custody must refuse a caller that is not ClearingHouse even when that caller arrives
    ///      in the middle of a legitimate ClearingHouse-initiated transfer. The guard is not the
    ///      only thing holding here — the role check fires first, which is why the selector below
    ///      is `OnlyClearingHouse` and not `ReentrancyGuardReentrantCall`.
    function test_reentrantTokenCannotCallTheVaultDirectly() public {
        ReentrantToken tok = new ReentrantToken();
        (bytes32 id,) = _admitAsset(address(tok), 18, 1e8);
        _fund(address(tok), alice, 2_000e18);

        tok.arm(
            address(collateralVault),
            abi.encodeCall(CollateralVault.deposit, (id, alice, address(tok), 1e18)),
            true
        );
        vm.prank(alice);
        clearing.addCollateral(id, 1_000e18);

        assertFalse(tok.lastCallSucceeded());
        assertEq(_selectorOf(tok.lastReturnData()), CollateralVault.OnlyClearingHouse.selector);
        assertEq(collateralVault.balanceOf(id, address(tok)), 0, "no credit to the attacker");

        tok.arm(
            address(collateralVault),
            abi.encodeCall(CollateralVault.withdraw, (id, alice, address(tok), 1_000e18)),
            true
        );
        vm.prank(alice);
        clearing.addCollateral(id, 1_000e18);

        assertFalse(tok.lastCallSucceeded());
        assertEq(_selectorOf(tok.lastReturnData()), CollateralVault.OnlyClearingHouse.selector);
        assertEq(tok.balanceOf(address(tok)), 0, "no collateral was redirected");
        assertEq(collateralVault.balanceOf(id, alice), 2_000e18);
    }

    /// @dev The reentrancy guard stops the exploit; this test is about the weaker property that
    ///      has to hold anyway, because a future code path may not be guarded. At every moment a
    ///      token can observe, the vault's ledger and its holdings must already agree.
    function test_reentrantObserverOnlyEverSeesConsistentState() public {
        ReentrantToken tok = new ReentrantToken();
        (bytes32 id,) = _admitAsset(address(tok), 18, 1e8);
        _fund(address(tok), alice, 2_000e18);

        // Window 1: inside `transferFrom`, before the token's own balances move.
        tok.watch(IVaultProbe(address(collateralVault)), id, alice);
        tok.arm(address(0), "", true);
        vm.prank(alice);
        clearing.addCollateral(id, 1_000e18);

        assertTrue(tok.observed(), "the fixture must have looked");
        assertEq(tok.seenLedgerBalance(), 0, "no credit before the tokens arrive");
        assertEq(tok.seenTotalDeposited(), 0);
        assertEq(tok.seenVaultTokenBalance(), 0);
        assertTrue(tok.seenSolvent(), "I-01 holds inside the deposit window");

        // Window 2: inside `transferFrom`, after the token's balances move but before the credit.
        tok.arm(address(0), "", false);
        vm.prank(alice);
        clearing.addCollateral(id, 500e18);

        assertEq(tok.seenLedgerBalance(), 1_000e18, "still only the settled credit");
        assertEq(tok.seenTotalDeposited(), 1_000e18);
        assertEq(tok.seenVaultTokenBalance(), 1_500e18, "tokens have landed, credit has not");
        assertTrue(tok.seenSolvent(), "surplus, never a shortfall");

        // Window 3: inside `transfer` on the way out. Effects precede interactions, so the ledger
        // is already final while the tokens are still in the vault.
        tok.arm(address(0), "", true);
        vm.prank(alice);
        clearing.withdrawCollateral(id, 600e18);

        assertEq(tok.seenLedgerBalance(), 900e18, "ledger already debited");
        assertEq(tok.seenTotalDeposited(), 900e18);
        assertEq(tok.seenVaultTokenBalance(), 1_500e18, "tokens not yet sent");
        assertTrue(tok.seenSolvent(), "I-01 holds inside the withdrawal window");
    }

    // ---------------------------------------------------------------------------------
    // I-33 — fee-on-transfer
    // ---------------------------------------------------------------------------------

    function test_feeOnTransferIsCreditedByMeasuredDeltaNotRequestedAmount() public {
        FeeOnTransferToken tok = new FeeOnTransferToken(100); // 1%
        (bytes32 id,) = _admitAsset(address(tok), 18, 1e8);
        _fund(address(tok), alice, 1_000e18);

        vm.prank(alice);
        clearing.addCollateral(id, 1_000e18);

        assertEq(collateralVault.balanceOf(id, alice), 990e18, "credited the delta, not the ask");
        assertEq(collateralVault.totalDeposited(id), 990e18);
        assertEq(tok.balanceOf(address(collateralVault)), 990e18);
        assertTrue(collateralVault.isSolvent(id), "I-01");

        // And the risk pipeline values what arrived, so the fee cannot be borrowed against.
        (, Types.AssetValuation[] memory vals) = clearing.accountHealth(alice);
        assertEq(vals[0].marketValueUsd18, 990e18, "market value follows the credited quantity");
    }

    function test_feeOnTransferVaultStaysSolventThroughAFullExit() public {
        FeeOnTransferToken tok = new FeeOnTransferToken(100);
        (bytes32 id,) = _admitAsset(address(tok), 18, 1e8);
        _fund(address(tok), alice, 1_000e18);
        _fund(address(tok), bob, 1_000e18);

        vm.prank(alice);
        clearing.addCollateral(id, 1_000e18);
        vm.prank(bob);
        clearing.addCollateral(id, 1_000e18);

        assertEq(collateralVault.totalDeposited(id), 1_980e18);

        vm.prank(alice);
        clearing.withdrawCollateral(id, 990e18);

        // The exit fee is paid by the withdrawer out of their own proceeds. The vault ships the
        // full ledger amount, so the second holder is never short because the first one left.
        assertEq(tok.balanceOf(alice), 980.1e18, "withdrawer bears the exit fee");
        assertEq(collateralVault.totalDeposited(id), 990e18);
        assertTrue(collateralVault.isSolvent(id), "I-01 after a partial exit");

        vm.prank(bob);
        clearing.withdrawCollateral(id, 990e18);

        assertEq(collateralVault.totalDeposited(id), 0);
        assertEq(tok.balanceOf(address(collateralVault)), 0);
        assertTrue(collateralVault.isSolvent(id), "I-01 after the last exit");
    }

    // ---------------------------------------------------------------------------------
    // I-34 — rebase
    // ---------------------------------------------------------------------------------

    function test_positiveRebaseCannotMoveValueBetweenAccounts() public {
        RebasingToken tok = new RebasingToken();
        (bytes32 id,) = _admitAsset(address(tok), 18, 1e8);
        _fund(address(tok), alice, 1_000e18);
        _fund(address(tok), bob, 1_000e18);

        vm.prank(alice);
        clearing.addCollateral(id, 1_000e18);
        vm.prank(bob);
        clearing.addCollateral(id, 1_000e18);

        tok.rebase(1_000); // +10%

        // The ledger is denominated in raw units and does not move on its own. The inflation
        // lands in `surplus`, where I-01 stays checkable, rather than becoming someone's credit.
        assertEq(collateralVault.balanceOf(id, alice), 1_000e18, "alice's credit is unchanged");
        assertEq(collateralVault.balanceOf(id, bob), 1_000e18, "bob's credit is unchanged");
        assertEq(collateralVault.totalDeposited(id), 2_000e18);
        assertEq(collateralVault.surplus(id), 200e18, "the corporate action is visible, not booked");
        assertTrue(collateralVault.isSolvent(id), "I-01");

        // Neither holder can reach the other's position, and neither can reach the surplus. The
        // refusal happens in the risk layer, before custody is asked to move anything.
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(ClearingHouse.WithdrawWouldBreachMaintenance.selector, 1_000e18)
        );
        clearing.withdrawCollateral(id, 1_001e18);

        vm.prank(alice);
        clearing.withdrawCollateral(id, 1_000e18);
        vm.prank(bob);
        clearing.withdrawCollateral(id, 1_000e18);

        assertApproxEqAbs(tok.balanceOf(alice), 1_000e18, 2, "alice got her own position back");
        assertApproxEqAbs(tok.balanceOf(bob), 1_000e18, 2, "bob got his own position back");
        assertEq(collateralVault.totalDeposited(id), 0);
        assertApproxEqAbs(tok.balanceOf(address(collateralVault)), 200e18, 2, "surplus stayed put");
    }

    /// @dev **Recorded finding.** A negative rebase burns tokens the vault is already holding, so
    ///      solvency cannot be preserved by any accounting choice — the assets are gone. What a
    ///      custody contract *can* do is refuse to pretend otherwise, and that is what this test
    ///      pins: the shortfall is publicly detectable through `isSolvent`, no phantom credit is
    ///      created, and no ledger entry silently changes.
    ///
    ///      What it is **not** able to pin is loss allocation. `CollateralVault` pays withdrawals
    ///      first-come-first-served out of raw units, so the first holder out is made whole and
    ///      the last one absorbs the entire rebase. Value does move between accounts, just not
    ///      silently. Closing that needs share-based custody or an explicit socialisation step,
    ///      and both are changes to `CollateralVault` rather than to this test.
    function test_negativeRebaseIsDetectableAndCreditsNoPhantomValue() public {
        RebasingToken tok = new RebasingToken();
        (bytes32 id,) = _admitAsset(address(tok), 18, 1e8);
        _fund(address(tok), alice, 1_000e18);
        _fund(address(tok), bob, 1_000e18);

        vm.prank(alice);
        clearing.addCollateral(id, 1_000e18);
        vm.prank(bob);
        clearing.addCollateral(id, 1_000e18);

        tok.rebase(-2_000); // -20%

        assertFalse(collateralVault.isSolvent(id), "the shortfall must be publicly visible");
        assertEq(collateralVault.surplus(id), 0, "a shortfall is never reported as surplus");
        assertEq(tok.balanceOf(address(collateralVault)), 1_600e18);
        assertEq(collateralVault.balanceOf(id, alice), 1_000e18, "no ledger entry moved on its own");
        assertEq(collateralVault.balanceOf(id, bob), 1_000e18);

        vm.prank(alice);
        clearing.withdrawCollateral(id, 1_000e18);
        assertApproxEqAbs(tok.balanceOf(alice), 1_000e18, 2);

        // Bob's ledger still says 1,000 and only 600 of value remains. The vault cannot conjure
        // the difference: the token transfer reverts rather than the ledger being decremented
        // against tokens that do not exist.
        vm.prank(bob);
        vm.expectRevert(
            abi.encodeWithSelector(
                RebasingToken.InsufficientShares.selector, address(collateralVault), 750e18, 1_250e18
            )
        );
        clearing.withdrawCollateral(id, 1_000e18);

        assertEq(collateralVault.balanceOf(id, bob), 1_000e18, "the failed exit changed nothing");

        vm.prank(bob);
        clearing.withdrawCollateral(id, 600e18);
        assertApproxEqAbs(tok.balanceOf(bob), 600e18, 2, "bob absorbed the entire rebase");
    }

    // ---------------------------------------------------------------------------------
    // Non-standard ERC-20 return conventions
    // ---------------------------------------------------------------------------------

    function test_tokenReturningFalseIsRejectedOnDeposit() public {
        FalseReturnToken tok = new FalseReturnToken();
        (bytes32 id,) = _admitAsset(address(tok), 18, 1e8);

        tok.setReturnsFalse(false);
        _fund(address(tok), alice, 1_000e18);
        tok.setReturnsFalse(true);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(SafeERC20.SafeERC20FailedOperation.selector, address(tok)));
        clearing.addCollateral(id, 1_000e18);

        assertEq(collateralVault.balanceOf(id, alice), 0, "a silent false credits nothing");
        assertEq(collateralVault.totalDeposited(id), 0);
    }

    function test_tokenReturningFalseIsRejectedOnWithdraw() public {
        FalseReturnToken tok = new FalseReturnToken();
        (bytes32 id,) = _admitAsset(address(tok), 18, 1e8);

        tok.setReturnsFalse(false);
        _fund(address(tok), alice, 1_000e18);
        vm.prank(alice);
        clearing.addCollateral(id, 1_000e18);

        tok.setReturnsFalse(true);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(SafeERC20.SafeERC20FailedOperation.selector, address(tok)));
        clearing.withdrawCollateral(id, 1_000e18);

        // The dangerous outcome would be a decremented ledger against tokens still in the vault.
        assertEq(collateralVault.balanceOf(id, alice), 1_000e18, "ledger intact after the revert");
        assertEq(collateralVault.totalDeposited(id), 1_000e18);
        assertTrue(collateralVault.isSolvent(id), "I-01");
    }

    function test_tokenReturningNoDataIsAcceptedAndAccountedExactly() public {
        NoReturnToken tok = new NoReturnToken(6);
        (bytes32 id,) = _admitAsset(address(tok), 6, 1e8);
        _fund(address(tok), alice, 1_000e6);

        vm.prank(alice);
        clearing.addCollateral(id, 1_000e6);

        assertEq(collateralVault.balanceOf(id, alice), 1_000e6, "empty returndata is success");
        assertTrue(collateralVault.isSolvent(id), "I-01");

        // Decimals are the asset's, not the protocol's: $1,000 of a 6dp token is still $1,000.
        (, Types.AssetValuation[] memory vals) = clearing.accountHealth(alice);
        assertEq(vals[0].marketValueUsd18, 1_000e18);

        vm.prank(alice);
        clearing.withdrawCollateral(id, 1_000e6);
        assertEq(tok.balanceOf(alice), 1_000e6);
        assertEq(collateralVault.totalDeposited(id), 0);
    }

    // ---------------------------------------------------------------------------------
    // A balance that changes between two reads in one transaction
    // ---------------------------------------------------------------------------------

    function test_balanceShiftUpCreditsTheMeasuredDeltaAndStaysSolvent() public {
        ShiftingBalanceToken tok = new ShiftingBalanceToken();
        (bytes32 id,) = _admitAsset(address(tok), 18, 1e8);
        _fund(address(tok), alice, 1_000e18);
        _fund(address(tok), bob, 1_000e18);

        vm.prank(bob);
        clearing.addCollateral(id, 1_000e18);

        tok.armShift(address(collateralVault), 5e18, 0);
        vm.prank(alice);
        clearing.addCollateral(id, 1_000e18);

        // The credit is what the vault measured, which is the only number the token itself will
        // honour later. Crediting the requested 1,000 would understate what the vault holds and
        // strand five tokens; crediting anything larger would overdraw bob.
        assertEq(collateralVault.balanceOf(id, alice), 1_005e18, "measured delta");
        assertEq(collateralVault.balanceOf(id, bob), 1_000e18, "bob is untouched");
        assertEq(collateralVault.totalDeposited(id), 2_005e18);
        assertEq(tok.balanceOf(address(collateralVault)), 2_005e18);
        assertTrue(collateralVault.isSolvent(id), "I-01");
    }

    function test_balanceShiftDownRevertsRatherThanCreditingPhantomTokens() public {
        ShiftingBalanceToken tok = new ShiftingBalanceToken();
        (bytes32 id,) = _admitAsset(address(tok), 18, 1e8);
        _fund(address(tok), alice, 2_000e18);

        vm.prank(alice);
        clearing.addCollateral(id, 1_000e18);

        // Second read lands below the first. An unchecked subtraction would wrap to ~2^256 and
        // credit the attacker the entire uint256 space.
        tok.armShift(address(collateralVault), 0, 500e18);
        vm.prank(alice);
        vm.expectRevert(stdError.arithmeticError);
        clearing.addCollateral(id, 100e18);

        assertEq(collateralVault.balanceOf(id, alice), 1_000e18, "nothing credited");
        assertEq(collateralVault.totalDeposited(id), 1_000e18);
    }

    function test_balanceShiftThatCancelsTheDepositIsRejectedAsNothingReceived() public {
        ShiftingBalanceToken tok = new ShiftingBalanceToken();
        (bytes32 id,) = _admitAsset(address(tok), 18, 1e8);
        _fund(address(tok), alice, 2_000e18);

        tok.armShift(address(collateralVault), 0, 1_000e18);
        vm.prank(alice);
        vm.expectRevert(CollateralVault.NothingReceived.selector);
        clearing.addCollateral(id, 1_000e18);

        assertEq(collateralVault.balanceOf(id, alice), 0);
    }

    // ---------------------------------------------------------------------------------
    // Reservations
    // ---------------------------------------------------------------------------------

    /// @dev A reservation is capital already promised to an in-flight execution. Letting the
    ///      collateral behind it leave would mean the reservation is backed by nothing at exactly
    ///      the moment nobody can tell whether the execution happened.
    function test_withdrawWhileAReservationExistsIsRejected() public {
        depositCollateral(alice, 1_000e18);

        vm.prank(governance);
        authority.grantRole(CLEARING_ROLE, address(this));

        (Types.RiskResult memory before,) = clearing.accountHealth(alice);
        clearing.reserve(alice, 100e18, keccak256("INTENT_1"));

        assertEq(clearing.reservedOf(alice), 100e18);
        assertEq(clearing.maxWithdrawable(alice, USTB_ID), 0, "nothing is safe to release");

        vm.prank(alice);
        vm.expectRevert(ClearingHouse.ReservationOutstanding.selector);
        clearing.withdrawCollateral(USTB_ID, 1);

        (Types.RiskResult memory during,) = clearing.accountHealth(alice);
        assertEq(
            during.availableBorrowUsd18,
            before.availableBorrowUsd18 - 100e18,
            "the reservation is subtracted from capacity immediately"
        );

        clearing.releaseReservation(alice, 100e18, keccak256("INTENT_1"));

        vm.prank(alice);
        clearing.withdrawCollateral(USTB_ID, 1_000e18);
        assertEq(collateralVault.balanceOf(USTB_ID, alice), 0);
    }

    // ---------------------------------------------------------------------------------
    // Hostile oracles
    // ---------------------------------------------------------------------------------

    function test_negativeAggregatorAnswerDegradesToOracleInvalid() public {
        (bytes32 id, HostileAggregator feed) = _admitAsset(address(new PlainToken(18)), 18, 1e8);
        _fund(_tokenOf(id), alice, 1_000e18);
        vm.prank(alice);
        clearing.addCollateral(id, 1_000e18);

        feed.setAnswer(-1);

        // The read degrades. It does not revert, because a reverting price read would take every
        // account holding the asset offline including the ones trying to get out.
        (uint256 price, uint64 updatedAt) = oracle.getPrice(id);
        assertEq(price, 0, "a negative answer is not a price");
        assertEq(updatedAt, 0);

        (Types.RiskResult memory r,) = clearing.accountHealth(alice);
        assertTrue(r.gates & Types.GATE_ORACLE_INVALID != 0, "ORACLE_INVALID");
        assertEq(r.availableBorrowUsd18, 0, "I-09");
        assertGt(uint8(r.status), uint8(Types.AccountStatus.NORMAL));

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(ClearingHouse.AccountNotHealthy.selector, r.status));
        clearing.borrow(1e18, 0);

        // Exit stays open with no price at all: the withdrawal simulation recognises nothing, and
        // an account with no debt is under no maintenance requirement.
        vm.prank(alice);
        clearing.withdrawCollateral(id, 1_000e18);
        assertEq(collateralVault.balanceOf(id, alice), 0);
    }

    function test_zeroAggregatorAnswerDegradesToOracleInvalid() public {
        (bytes32 id, HostileAggregator feed) = _admitAsset(address(new PlainToken(18)), 18, 1e8);
        _fund(_tokenOf(id), alice, 1_000e18);
        vm.prank(alice);
        clearing.addCollateral(id, 1_000e18);

        feed.setAnswer(0);

        (uint256 price,) = oracle.getPrice(id);
        assertEq(price, 0);

        (Types.RiskResult memory r, Types.AssetValuation[] memory vals) = clearing.accountHealth(alice);
        assertEq(vals[0].marketValueUsd18, 0, "no price means no recognised value");
        assertTrue(r.gates & Types.GATE_ORACLE_INVALID != 0);
        assertEq(r.availableBorrowUsd18, 0, "I-09");
    }

    function test_revertingAggregatorIsCaughtAndDegradesToNoPrice() public {
        (bytes32 id, HostileAggregator feed) = _admitAsset(address(new PlainToken(18)), 18, 1e8);
        _fund(_tokenOf(id), alice, 1_000e18);
        vm.prank(alice);
        clearing.addCollateral(id, 1_000e18);

        // A revert with a reason string, and a revert with no data at all. Both must be caught:
        // the second is what a feed proxy pointed at a self-destructed aggregator produces.
        for (uint8 mode = 1; mode <= 2; ++mode) {
            feed.setRevertMode(mode);

            (uint256 price, uint64 updatedAt) = oracle.getPrice(id);
            assertEq(price, 0, "reverting feed degrades to no price");
            assertEq(updatedAt, 0);

            (Types.RiskResult memory r,) = clearing.accountHealth(alice);
            assertTrue(r.gates & Types.GATE_ORACLE_INVALID != 0, "ORACLE_INVALID");
            assertEq(r.availableBorrowUsd18, 0, "I-09");

            vm.prank(alice);
            vm.expectRevert(abi.encodeWithSelector(ClearingHouse.AccountNotHealthy.selector, r.status));
            clearing.borrow(1e18, 0);
        }
    }

    /// @dev **Recorded finding.** `ClearingHouse._settlementPrice` reverts when the settlement
    ///      asset has no price, and both `repay` and `availableBorrow` go through it. Disabling
    ///      the USDC feed is a guardian-reachable action on `ChainlinkFeedAdapter`, so a guardian
    ///      key can close the repayment path — the one action the protocol promises stays open
    ///      under every degradation (spec/threat-model.md §2, and the `staleOracleBlocksNewRisk`
    ///      case in `Lifecycle.t.sol`). Every other oracle failure degrades; this one reverts.
    ///
    ///      Asserted as it currently behaves so the fix flips this test deliberately rather than
    ///      quietly. A degraded settlement price should fall back to a governance-set par rate or
    ///      accept repayment at 1:1, not brick the exit.
    function test_guardianCannotCloseTheExitViaTheSettlementFeed() public {
        depositCollateral(alice, 1_000e18);
        vm.prank(alice);
        clearing.borrow(300e18, 0);

        // Disabling the settlement feed used to make `_settlementPrice()` revert, which took
        // `repay()` and `availableBorrow()` with it. That is a guardian action that INCREASES
        // user risk by removing the exit, which spec/threat-model.md §6 forbids. The settlement
        // feed is now marked protected at deploy time. See RegressionTest R-02.
        vm.prank(guardian);
        vm.expectRevert(abi.encodeWithSelector(ChainlinkFeedAdapter.FeedIsProtected.selector, USDC_ID));
        oracle.disableFeed(USDC_ID);

        usdc.mint(alice, 1_000e6);
        vm.startPrank(alice);
        usdc.approve(address(clearing), type(uint256).max);
        clearing.repay(0, true);
        vm.stopPrank();

        assertEq(clearing.debtOf(alice), 0, "the exit stays open");
    }

    /// @dev **Recorded finding.** `borrow` converts USD to settlement tokens with a rounding-down
    ///      division, so any amount below one token unit (1e12 usd18 against 6dp USDC at $1)
    ///      creates debt and transfers nothing. That is invariant I-03 — every debt increment
    ///      matched by an outflow or a reservation — failing at the dust boundary. Harmless in
    ///      magnitude, wrong in kind: the fix is to reject a borrow whose token amount rounds to
    ///      zero, not to tolerate unbacked debt.
    function test_subUnitBorrowIsRefusedRatherThanCreatingFreeDebt() public {
        depositCollateral(alice, 1_000e18);

        uint256 aliceBefore = usdc.balanceOf(alice);
        uint256 vaultBefore = usdc.balanceOf(address(liquidityVault));

        // Previously this recorded scaled principal while moving zero tokens: debt nobody was
        // paid. Invariant I-03 says every debt increment has a matching outflow, so a draw that
        // rounds to zero settlement units is now refused outright. See RegressionTest R-03.
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(ClearingHouse.BorrowTooSmall.selector, uint256(1e11)));
        clearing.borrow(1e11, 0); // 0.0000001 USD, below one unit of 6-decimal USDC

        assertEq(usdc.balanceOf(alice), aliceBefore, "no settlement tokens moved");
        assertEq(usdc.balanceOf(address(liquidityVault)), vaultBefore);
        assertEq(liquidityVault.totalPrincipal(), 0, "the vault recorded no principal");
        assertEq(clearing.debtOf(alice), 0, "and the account owes nothing");
    }

    // ---------------------------------------------------------------------------------
    // EmergencyController — I-25 and the emergency-authority invariants
    // ---------------------------------------------------------------------------------

    function test_everyEmergencyActionRequiresAReasonCode() public {
        vm.startPrank(guardian);

        vm.expectRevert(EmergencyController.ReasonRequired.selector);
        emergency.freezeNewBorrowing(bytes32(0));
        vm.expectRevert(EmergencyController.ReasonRequired.selector);
        emergency.disableAsset(USTB_ID, bytes32(0));
        vm.expectRevert(EmergencyController.ReasonRequired.selector);
        emergency.setAssetReduceOnly(USTB_ID, bytes32(0));
        vm.expectRevert(EmergencyController.ReasonRequired.selector);
        emergency.setAccountReduceOnly(alice, bytes32(0));
        vm.expectRevert(EmergencyController.ReasonRequired.selector);
        emergency.disableAdapter(address(oracle), bytes32(0));
        vm.expectRevert(EmergencyController.ReasonRequired.selector);
        emergency.pauseMarketCreation(bytes32(0));

        vm.stopPrank();
    }

    function test_disablingAnAssetGatesHoldersAndLeavesExitOpen() public {
        depositCollateral(alice, 1_000e18);
        vm.prank(alice);
        clearing.borrow(300e18, 0);

        vm.prank(guardian);
        emergency.disableAsset(USTB_ID, REASON);

        (Types.RiskResult memory r,) = clearing.accountHealth(alice);
        assertTrue(r.gates & Types.GATE_ASSET_SUSPENDED != 0);
        assertEq(r.availableBorrowUsd18, 0);

        usdc.mint(alice, 1_000e6);
        vm.startPrank(alice);
        usdc.approve(address(clearing), type(uint256).max);
        clearing.repay(0, true);
        clearing.withdrawCollateral(USTB_ID, 1_000e18);
        vm.stopPrank();

        assertEq(ustb.balanceOf(alice), 10_000e18, "collateral came back in full");
    }

    function test_assetReduceOnlyStopsNewCollateralWithoutGatingHolders() public {
        depositCollateral(alice, 1_000e18);
        (Types.RiskResult memory before,) = clearing.accountHealth(alice);

        vm.prank(guardian);
        emergency.setAssetReduceOnly(USTB_ID, REASON);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(ClearingHouse.AssetNotCollateral.selector, USTB_ID));
        clearing.addCollateral(USTB_ID, 1e18);

        // Deliberately no gate: "we want no more of this" is a different claim from "we no longer
        // trust this", and conflating them would restrict accounts that did nothing wrong.
        (Types.RiskResult memory afterR,) = clearing.accountHealth(alice);
        assertEq(afterR.availableBorrowUsd18, before.availableBorrowUsd18);
        assertEq(uint8(afterR.status), uint8(before.status));

        vm.prank(alice);
        clearing.withdrawCollateral(USTB_ID, 1_000e18);

        // Escalation upward is available; the reverse is not, and never becomes available.
        vm.prank(guardian);
        emergency.disableAsset(USTB_ID, REASON);
        vm.prank(guardian);
        vm.expectRevert("guardian may only restrict");
        emergency.setAssetReduceOnly(USTB_ID, REASON);
    }

    function test_accountReduceOnlyIsAFloorAndCannotBeWalkedBack() public {
        depositCollateral(alice, 1_000e18);

        vm.prank(guardian);
        emergency.setAccountReduceOnly(alice, REASON);

        (Types.RiskResult memory r,) = clearing.accountHealth(alice);
        assertEq(uint8(r.status), uint8(Types.AccountStatus.REDUCE_ONLY));
        assertEq(r.availableBorrowUsd18, 0);

        vm.prank(guardian);
        vm.expectRevert("override may only restrict");
        emergency.setAccountReduceOnly(alice, REASON);

        // Governance lifts it on the contract that owns it. The controller has no path to this.
        vm.prank(governance);
        clearing.clearAccountRiskState(alice);
        (Types.RiskResult memory healed,) = clearing.accountHealth(alice);
        assertEq(uint8(healed.status), uint8(Types.AccountStatus.NORMAL));
    }

    function test_borrowFreezeVoidsOutstandingQuotesAndRaisesTheGate() public {
        depositCollateral(alice, 1_000e18);
        uint64 quotedEpoch = policyReg.riskEpoch();

        vm.prank(guardian);
        emergency.freezeNewBorrowing(REASON);

        assertTrue(emergency.borrowingFrozen());
        assertGt(policyReg.riskEpoch(), quotedEpoch, "the freeze advances the risk epoch");

        vm.expectRevert(EmergencyController.BorrowingIsFrozen.selector);
        emergency.requireBorrowingAllowed();

        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(ClearingHouse.StaleRiskEpoch.selector, policyReg.riskEpoch(), quotedEpoch)
        );
        clearing.borrow(100e18, quotedEpoch);

        vm.prank(guardian);
        vm.expectRevert(abi.encodeWithSelector(Authorized.Unauthorized.selector, GOVERNANCE_ROLE));
        emergency.liftBorrowingFreeze(REASON);

        vm.prank(governance);
        emergency.liftBorrowingFreeze(REASON);
        assertFalse(emergency.borrowingFrozen());
    }

    /// @dev **Known gap, asserted so it cannot be forgotten.** `ClearingHouse.borrow` does not
    ///      consult `requireBorrowingAllowed()` yet, so a caller that passes `expectedEpoch == 0`
    ///      still borrows through a live freeze. Wiring the gate is a one-line change in
    ///      `ClearingHouse.borrow`, owned by that file; when it lands, this test must be inverted
    ///      to assert the revert. It is written as a passing assertion of the wrong behaviour
    ///      rather than left out, because a missing test is indistinguishable from a covered case.
    function test_borrowFreezeIsNotYetEnforcedForUnstampedQuotes() public {
        depositCollateral(alice, 1_000e18);

        vm.prank(guardian);
        emergency.freezeNewBorrowing(REASON);

        vm.prank(alice);
        clearing.borrow(100e18, 0);
        assertEq(clearing.debtOf(alice), 100e18, "the freeze is not yet wired into borrow");
    }

    function test_adapterAndMarketCreationFlagsLiftOnlyByGovernance() public {
        vm.startPrank(guardian);
        emergency.disableAdapter(address(oracle), REASON);
        emergency.pauseMarketCreation(REASON);
        vm.stopPrank();

        assertTrue(emergency.adapterDisabled(address(oracle)));
        assertTrue(emergency.marketCreationPaused());

        vm.expectRevert(
            abi.encodeWithSelector(EmergencyController.AdapterIsDisabled.selector, address(oracle))
        );
        emergency.requireAdapterEnabled(address(oracle));
        vm.expectRevert(EmergencyController.MarketCreationIsPaused.selector);
        emergency.requireMarketCreationAllowed();

        vm.startPrank(guardian);
        vm.expectRevert(abi.encodeWithSelector(Authorized.Unauthorized.selector, GOVERNANCE_ROLE));
        emergency.enableAdapter(address(oracle), REASON);
        vm.expectRevert(abi.encodeWithSelector(Authorized.Unauthorized.selector, GOVERNANCE_ROLE));
        emergency.resumeMarketCreation(REASON);
        vm.stopPrank();

        vm.startPrank(governance);
        emergency.enableAdapter(address(oracle), REASON);
        emergency.resumeMarketCreation(REASON);
        vm.stopPrank();

        assertFalse(emergency.adapterDisabled(address(oracle)));
        assertFalse(emergency.marketCreationPaused());
    }

    /// @dev The powers a guardian does not have are proven by absence, not by a role check that
    ///      could be mis-written. Every selector below is one a compromised guardian key would
    ///      reach for; none of them exist on the controller, and it has no fallback to swallow
    ///      them. This test fails the moment somebody adds one.
    /// @notice The controller must not expose any risk-increasing entry point.
    ///
    /// @dev Two earlier versions of this test were wrong in opposite directions, and both are
    ///      worth recording because the failure modes are easy to repeat.
    ///
    ///      The first encoded each forbidden signature with no arguments, producing four bytes of
    ///      calldata. Every signature here takes at least one argument, so the ABI decoder
    ///      reverted on short calldata whether or not the function existed. It passed against a
    ///      controller implementing all nine, and would not have caught somebody adding `setLtv`.
    ///
    ///      The second scanned the runtime bytecode for each selector. That over-triggers: the
    ///      controller legitimately *calls* `ClearingHouse.setAccountRiskState`, so the selector
    ///      is in its code as an outbound call rather than as a dispatch entry.
    ///
    ///      What is asserted here is reachability. Each signature is called with well-formed,
    ///      over-long calldata from the most privileged account in the system. If the function is
    ///      absent the call reaches a non-existent fallback and fails. The positive control at the
    ///      end proves the harness can observe a success at all, which is what stops this from
    ///      quietly degrading into a test that passes because everything reverts.
    function test_controllerExposesNoRiskIncreasingFunction() public {
        string[9] memory forbidden = [
            "setAccountRiskState(address,uint8,bytes32)",
            "clearAccountRiskState(address)",
            "setStatus(bytes32,uint8)",
            "updatePolicy(bytes32,(uint16,uint16,uint16,uint16,uint16,uint16,uint16,uint16,uint16,uint64,uint64))",
            "withdraw(bytes32,address,address,uint256)",
            "transfer(address,uint256)",
            "grantRole(bytes32,address)",
            "setLtv(bytes32,uint16)",
            "liftAssetRestriction(bytes32,bytes32)"
        ];

        // Sixteen zero words is more than the widest signature above needs. Surplus calldata is
        // ignored by the decoder; insufficient calldata was the original bug.
        bytes memory padding = new bytes(32 * 16);

        for (uint256 i; i < forbidden.length; ++i) {
            bytes4 sel = bytes4(keccak256(bytes(forbidden[i])));
            vm.prank(governance);
            (bool ok,) = address(emergency).call(bytes.concat(sel, padding));
            assertFalse(ok, forbidden[i]);
        }

        // Positive control: a function that does exist, called correctly, must succeed. Without
        // this the loop above would still pass if every call failed for an unrelated reason.
        vm.prank(guardian);
        (bool controlOk,) = address(emergency)
            .call(abi.encodeWithSignature("disableAsset(bytes32,bytes32)", USTB_ID, bytes32("PROBE")));
        assertTrue(controlOk, "harness must be able to observe a successful call");
    }

    /// @dev The controller holds GUARDIAN and nothing else. Every call below is one it would need
    ///      GOVERNANCE for, made *as the controller*, and every one must fail — otherwise the
    ///      "guardians can only restrict" argument rests on this file's restraint rather than on
    ///      the registries' checks.
    function test_controllerHoldsNoGovernancePowerAnywhere() public {
        depositCollateral(alice, 1_000e18);

        vm.prank(address(emergency));
        vm.expectRevert("guardian may only restrict");
        assetsReg.setStatus(USTB_ID, Types.AssetStatus.ACTIVE);

        vm.prank(address(emergency));
        vm.expectRevert(abi.encodeWithSelector(Authorized.Unauthorized.selector, GOVERNANCE_ROLE));
        clearing.clearAccountRiskState(alice);

        vm.prank(address(emergency));
        vm.expectRevert(abi.encodeWithSelector(Authorized.Unauthorized.selector, GOVERNANCE_ROLE));
        assetsReg.bindRiskPolicy(USTB_ID, POLICY_STABLE);

        vm.prank(address(emergency));
        vm.expectRevert(CollateralVault.OnlyClearingHouse.selector);
        collateralVault.withdraw(USTB_ID, alice, address(emergency), 1e18);

        // The controller cannot promote itself, which is what makes every check above permanent.
        vm.prank(address(emergency));
        vm.expectRevert(
            abi.encodeWithSelector(Authority.NotAuthorized.selector, GOVERNANCE_ROLE, address(emergency))
        );
        authority.grantRole(GOVERNANCE_ROLE, address(emergency));
    }

    // ---------------------------------------------------------------------------------
    // I-25 as a property
    // ---------------------------------------------------------------------------------

    /// @notice Invariant I-25 over the controller's whole reachable parameter space.
    /// @dev The fuzzer walks every guardian action against every reachable combination of
    ///      collateral size, debt size, pre-existing restriction and target asset, and the
    ///      assertions cover the four things a guardian must never be able to do: raise capacity,
    ///      raise a limit, make an account look healthier, or move money.
    ///
    ///      Actions that revert are counted as passes rather than skipped. A reverting emergency
    ///      call leaves the state it found, which is exactly the property being asserted, and
    ///      filtering those cases out with `vm.assume` would quietly shrink the space the fuzzer
    ///      actually covers.
    function testFuzz_guardianCannotIncreaseRisk(
        uint256 collateralSeed,
        uint256 borrowSeed,
        uint256 actionSeed,
        bool targetHeldAsset,
        bool preRestrict,
        bytes32 reason
    ) public {
        uint256 amount = bound(collateralSeed, 1e15, 10_000e18);
        depositCollateral(alice, amount);

        (Types.RiskResult memory fresh,) = clearing.accountHealth(alice);
        uint256 want = bound(borrowSeed, 0, fresh.availableBorrowUsd18);
        // A draw below one unit of the 6-decimal settlement asset is refused by design
        // (invariant I-03), so skip that band rather than rediscovering it every run.
        if (want < 1e12) want = 0;
        if (want > 0) {
            vm.prank(alice);
            clearing.borrow(want, 0);
        }

        if (preRestrict) {
            vm.prank(guardian);
            clearing.setAccountRiskState(alice, Types.AccountStatus.NO_NEW_RISK, keccak256("PRE_EXISTING"));
        }

        if (reason == bytes32(0)) reason = keccak256("FUZZ");
        bytes32 target = targetHeldAsset ? USTB_ID : USDC_ID;

        (Types.RiskResult memory before,) = clearing.accountHealth(alice);
        uint256 collateralBefore = collateralVault.balanceOf(USTB_ID, alice);
        uint256 walletBefore = ustb.balanceOf(alice);

        _invokeGuardianAction(bound(actionSeed, 0, 5), target, reason);

        (Types.RiskResult memory afterR,) = clearing.accountHealth(alice);

        assertLe(afterR.availableBorrowUsd18, before.availableBorrowUsd18, "capacity increased");
        assertGe(uint8(afterR.status), uint8(before.status), "status ordinal fell");
        assertLe(afterR.borrowLimitUsd18, before.borrowLimitUsd18, "borrow limit rose");
        assertLe(afterR.maintenanceLimitUsd18, before.maintenanceLimitUsd18, "maintenance limit rose");
        assertLe(afterR.liquidationLimitUsd18, before.liquidationLimitUsd18, "liquidation limit rose");
        assertEq(afterR.debtUsd18, before.debtUsd18, "debt changed");
        assertEq(collateralVault.balanceOf(USTB_ID, alice), collateralBefore, "collateral moved");
        assertEq(ustb.balanceOf(alice), walletBefore, "a withdrawal was redirected");
    }

    /// @dev `ok` is captured rather than discarded so the catch block is not empty: a reverting
    ///      action is a legitimate outcome here (the same restriction applied twice), and the
    ///      caller's assertions are what decide whether that outcome was acceptable.
    function _invokeGuardianAction(uint256 action, bytes32 assetId, bytes32 reason)
        internal
        returns (bool ok)
    {
        vm.startPrank(guardian);
        if (action == 0) {
            try emergency.freezeNewBorrowing(reason) {
                ok = true;
            } catch {}
        } else if (action == 1) {
            try emergency.disableAsset(assetId, reason) {
                ok = true;
            } catch {}
        } else if (action == 2) {
            try emergency.setAssetReduceOnly(assetId, reason) {
                ok = true;
            } catch {}
        } else if (action == 3) {
            try emergency.setAccountReduceOnly(alice, reason) {
                ok = true;
            } catch {}
        } else if (action == 4) {
            try emergency.disableAdapter(address(oracle), reason) {
                ok = true;
            } catch {}
        } else {
            try emergency.pauseMarketCreation(reason) {
                ok = true;
            } catch {}
        }
        vm.stopPrank();
    }

    function _tokenOf(bytes32 assetId) internal view returns (address) {
        return assetsReg.getAsset(assetId).token;
    }
}

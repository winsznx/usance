// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

import {Authority, Authorized} from "./Authority.sol";
import {LiquidityVault} from "./LiquidityVault.sol";
import {RiskMath} from "../libraries/RiskMath.sol";
import {Types} from "../libraries/Types.sol";

/// @title FinancingEngine
/// @notice Debt, interest and the rate model for one settlement market.
///
/// @dev Debt is denominated in **USD**, not in settlement-token units. Borrowing $1,000 creates
///      $1,000 of debt regardless of what the stablecoin does afterwards; the token amount moved
///      is derived from the oracle at the moment of transfer. If the settlement asset depegs, the
///      borrower owes the same dollars and a different number of tokens, which is the
///      economically correct answer and the one that keeps the collateral maths coherent.
///
///      Principal is carried scaled against a monotone index (spec/accounting.md §3.1). The index
///      steps on every interaction, so there is no keeper whose absence quietly stops interest.
contract FinancingEngine is Authorized {
    struct RateParams {
        uint16 baseBps;
        uint16 slope1Bps;
        uint16 slope2Bps;
        uint16 kinkBps;
        uint16 reserveFactorBps;
    }

    LiquidityVault public immutable vault;

    uint256 public borrowIndex = Types.WAD;
    uint64 public lastAccrualAt;
    uint256 public totalScaledPrincipal;

    RateParams public rate;
    address public clearingHouse;

    mapping(address account => uint256) public scaledPrincipalOf;

    event Accrued(uint256 index, uint256 rateBps, uint256 interestDelta);
    event Borrowed(address indexed account, uint256 amountUsd18, uint256 scaledDelta);
    event Repaid(address indexed account, uint256 amountUsd18, uint256 scaledDelta);
    event RateParamsSet(RateParams params);
    event ClearingHouseSet(address clearingHouse);

    error OnlyClearingHouse();
    error ClearingHouseAlreadySet();
    error BadRateParams();

    modifier onlyClearingHouse() {
        if (msg.sender != clearingHouse) revert OnlyClearingHouse();
        _;
    }

    constructor(Authority authority_, LiquidityVault vault_, RateParams memory rate_) Authorized(authority_) {
        vault = vault_;
        _setRate(rate_);
        lastAccrualAt = uint64(block.timestamp);
    }

    function setClearingHouse(address ch) external onlyRole(authority.GOVERNANCE()) {
        if (clearingHouse != address(0)) revert ClearingHouseAlreadySet();
        clearingHouse = ch;
        emit ClearingHouseSet(ch);
    }

    function setRateParams(RateParams calldata r) external onlyRole(authority.GOVERNANCE()) {
        accrue();
        _setRate(r);
    }

    /// @notice Accrue and hand the interest delta back to the caller for unit conversion.
    /// @dev Only ClearingHouse may call this, because only ClearingHouse can price the delta.
    function accrueFor() external onlyClearingHouse returns (uint256 interestDeltaUsd18) {
        (, interestDeltaUsd18) = accrue();
    }

    function _setRate(RateParams memory r) internal {
        if (r.kinkBps == 0 || r.kinkBps >= Types.BPS || r.reserveFactorBps > Types.BPS) {
            revert BadRateParams();
        }
        rate = r;
        emit RateParamsSet(r);
    }

    // ---------------------------------------------------------------------------------
    // Interest
    // ---------------------------------------------------------------------------------

    /// @notice Borrows as of the last accrual, using the stored index.
    /// @dev Utilisation is measured from settled state. Deriving the rate from the *projected*
    ///      index would make `currentIndex` and `currentRateBps` mutually recursive, and the
    ///      economics agree with the mechanics: a rate applies over the interval that starts
    ///      where the last one stopped.
    function totalBorrowsStored() public view returns (uint256) {
        return RiskMath.mulDivUp(totalScaledPrincipal, borrowIndex, Types.WAD);
    }

    function currentRateBps() public view returns (uint256) {
        return RiskMath.borrowRateBps(
            vault.availableCash(),
            totalBorrowsStored(),
            rate.baseBps,
            rate.slope1Bps,
            rate.slope2Bps,
            rate.kinkBps
        );
    }

    /// @notice The index as it would be right now, without writing.
    /// @dev Every view that reports debt uses this rather than the stored index, so a quote is
    ///      never cheaper than the transaction that follows it.
    function currentIndex() public view returns (uint256) {
        uint256 dt = block.timestamp - lastAccrualAt;
        if (dt == 0) return borrowIndex;
        return RiskMath.accrueIndex(borrowIndex, currentRateBps(), dt);
    }

    /// @notice Advance the index and report the interest recognised, in USD.
    /// @return index the new borrow index
    /// @return interestDeltaUsd18 interest recognised since the last accrual
    ///
    /// @dev This engine deliberately does NOT write to the liquidity vault. Debt here is
    ///      denominated in USD; the vault's books are denominated in settlement-token units. The
    ///      engine has no oracle and therefore cannot convert between them, and the version of
    ///      this function that pushed a usd18 delta straight into `LiquidityVault.accrue`
    ///      inflated vault NAV by roughly 271,000,000x and locked every lender out of their own
    ///      deposit. Conversion belongs at the one boundary that holds a price: ClearingHouse.
    function accrue() public returns (uint256 index, uint256 interestDeltaUsd18) {
        uint256 dt = block.timestamp - lastAccrualAt;
        if (dt == 0) return (borrowIndex, 0);

        uint256 rBps = currentRateBps();
        uint256 before = totalBorrowsStored();
        borrowIndex = RiskMath.accrueIndex(borrowIndex, rBps, dt);
        lastAccrualAt = uint64(block.timestamp);

        interestDeltaUsd18 = totalBorrowsStored() - before;

        emit Accrued(borrowIndex, rBps, interestDeltaUsd18);
        return (borrowIndex, interestDeltaUsd18);
    }

    function totalBorrowsUsd18() public view returns (uint256) {
        return RiskMath.mulDivUp(totalScaledPrincipal, currentIndex(), Types.WAD);
    }

    /// @notice Debt owed by `account`, in USD, rounded up.
    function debtOf(address account) public view returns (uint256) {
        return RiskMath.mulDivUp(scaledPrincipalOf[account], currentIndex(), Types.WAD);
    }

    // ---------------------------------------------------------------------------------
    // ClearingHouse-driven mutation
    // ---------------------------------------------------------------------------------

    function onBorrow(address account, uint256 amountUsd18) external onlyClearingHouse {
        accrue();
        uint256 scaledDelta = RiskMath.mulDivUp(amountUsd18, Types.WAD, borrowIndex);
        scaledPrincipalOf[account] += scaledDelta;
        totalScaledPrincipal += scaledDelta;
        emit Borrowed(account, amountUsd18, scaledDelta);
    }

    /// @notice Apply a repayment.
    /// @return appliedUsd18 the portion of `amountUsd18` that actually reduced debt
    /// @dev Overpayment is capped at the outstanding debt and reported back, so the caller
    ///      refunds the difference rather than the protocol quietly keeping it. Invariant I-04:
    ///      the reduction is computed from the caller's amount exactly once, and a replay finds
    ///      nothing left to reduce.
    function onRepay(address account, uint256 amountUsd18, bool repayAll)
        external
        onlyClearingHouse
        returns (uint256 appliedUsd18)
    {
        accrue();

        uint256 scaled = scaledPrincipalOf[account];
        if (scaled == 0) return 0;

        uint256 outstanding = RiskMath.mulDivUp(scaled, borrowIndex, Types.WAD);

        if (repayAll || amountUsd18 >= outstanding) {
            // Explicit full-clear path. Relying on rounding to land exactly on zero is how dust
            // debt survives a "repay all" and an account can never be closed.
            scaledPrincipalOf[account] = 0;
            totalScaledPrincipal -= scaled;
            emit Repaid(account, outstanding, scaled);
            return outstanding;
        }

        uint256 scaledDelta = RiskMath.mulDiv(amountUsd18, Types.WAD, borrowIndex);
        if (scaledDelta > scaled) scaledDelta = scaled;
        scaledPrincipalOf[account] = scaled - scaledDelta;
        totalScaledPrincipal -= scaledDelta;

        appliedUsd18 = amountUsd18;
        emit Repaid(account, appliedUsd18, scaledDelta);
    }

    /// @notice Retire an unrecoverable position and report the loss in USD.
    /// @dev Reports rather than writes, for the same unit-boundary reason as `accrue`. The caller
    ///      converts to token units before touching the vault's books.
    function writeOff(address account) external onlyClearingHouse returns (uint256 lossUsd18) {
        accrue();
        uint256 scaled = scaledPrincipalOf[account];
        if (scaled == 0) return 0;
        lossUsd18 = RiskMath.mulDivUp(scaled, borrowIndex, Types.WAD);
        scaledPrincipalOf[account] = 0;
        totalScaledPrincipal -= scaled;
    }
}

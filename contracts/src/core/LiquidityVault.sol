// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {Authority, Authorized} from "./Authority.sol";
import {RiskMath} from "../libraries/RiskMath.sol";
import {Types} from "../libraries/Types.sol";

/// @title LiquidityVault
/// @notice Where settlement liquidity lives, and where lenders' claims on it are tracked.
///
/// @dev The distinction this contract exists to enforce is between **NAV** and **withdrawable
///      cash**. A vault with $10m of assets and $200k of idle cash cannot honour a $1m
///      withdrawal, and pretending otherwise is how lending products lie to their depositors.
///      `totalAssets()` and `availableCash()` are separate functions, the UI shows both, and the
///      withdrawal path is bounded by cash rather than by NAV.
contract LiquidityVault is ERC20, Authorized, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable asset;
    uint8 internal immutable _assetDecimals;

    /// @notice Principal currently lent out. Grows on borrow, shrinks on repay.
    uint256 public totalPrincipal;
    /// @notice Interest recognised but not yet received in cash.
    uint256 public accruedReceivables;
    /// @notice Cash promised to in-flight executions. Held back from both lending and withdrawal.
    uint256 public reservedCash;
    /// @notice Principal written off. Reduces NAV permanently.
    uint256 public badDebt;
    /// @notice Protocol reserve, funded from the spread. Not lender-owned.
    uint256 public reserves;

    event Supplied(address indexed lender, uint256 assets, uint256 shares);
    event Withdrawn(address indexed lender, uint256 assets, uint256 shares);
    event CashLent(address indexed to, uint256 amount);
    event CashReturned(uint256 principal, uint256 interest);
    event BadDebtRecorded(uint256 amount);
    event ReservesAccrued(uint256 amount);

    error ZeroAmount();
    error InsufficientCash(uint256 available, uint256 requested);
    error InsufficientShares();

    /// @dev Both ClearingHouse and FinancingEngine drive this vault: the first moves cash, the
    ///      second recognises interest. Rather than hardcode one address and discover the other
    ///      is locked out the first time interest accrues, both hold the CLEARING role and the
    ///      vault checks the role.
    modifier onlyClearing() {
        if (!authority.hasRole(authority.CLEARING(), msg.sender)) revert Unauthorized(authority.CLEARING());
        _;
    }

    constructor(Authority authority_, IERC20 asset_, string memory name_, string memory symbol_)
        ERC20(name_, symbol_)
        Authorized(authority_)
    {
        asset = asset_;
        _assetDecimals = IERC20Metadata(address(asset_)).decimals();
    }

    function decimals() public view override returns (uint8) {
        return _assetDecimals;
    }

    // ---------------------------------------------------------------------------------
    // Accounting views
    // ---------------------------------------------------------------------------------

    /// @notice Cash sitting in the contract, minus what is already spoken for.
    /// @dev This is the number that bounds a withdrawal and bounds a new borrow. It is not NAV.
    function availableCash() public view returns (uint256) {
        uint256 held = asset.balanceOf(address(this));
        uint256 spokenFor = reservedCash + reserves;
        return held > spokenFor ? held - spokenFor : 0;
    }

    /// @notice Lender-owned value: idle cash plus outstanding principal plus accrued interest,
    ///         less write-offs and the protocol reserve.
    function totalAssets() public view returns (uint256) {
        uint256 gross = asset.balanceOf(address(this)) + totalPrincipal + accruedReceivables;
        uint256 deductions = badDebt + reserves;
        return gross > deductions ? gross - deductions : 0;
    }

    function utilizationBps() external view returns (uint256) {
        uint256 cash = availableCash();
        if (totalPrincipal == 0) return 0;
        return RiskMath.mulDiv(totalPrincipal, Types.BPS, cash + totalPrincipal);
    }

    function convertToShares(uint256 assets_) public view returns (uint256) {
        uint256 shareSupply = totalSupply();
        uint256 ta = totalAssets();
        if (shareSupply == 0 || ta == 0) return assets_;
        return RiskMath.mulDiv(assets_, shareSupply, ta);
    }

    function convertToAssets(uint256 shares) public view returns (uint256) {
        uint256 shareSupply = totalSupply();
        if (shareSupply == 0) return shares;
        return RiskMath.mulDiv(shares, totalAssets(), shareSupply);
    }

    // ---------------------------------------------------------------------------------
    // Lender flows
    // ---------------------------------------------------------------------------------

    function supply(uint256 amount, address receiver) external nonReentrant returns (uint256 shares) {
        if (amount == 0) revert ZeroAmount();
        // Shares are priced before the transfer so the depositor cannot buy into their own deposit.
        shares = convertToShares(amount);
        asset.safeTransferFrom(msg.sender, address(this), amount);
        _mint(receiver, shares);
        emit Supplied(receiver, amount, shares);
    }

    /// @notice Redeem shares for cash, bounded by cash actually on hand.
    /// @dev Deliberately does not queue. A partial fill with an honest number beats a queue that
    ///      nobody understands; the UI shows `Withdraw now: X` from `maxWithdraw`.
    function withdraw(uint256 shares, address receiver) external nonReentrant returns (uint256 amount) {
        if (shares == 0) revert ZeroAmount();
        if (balanceOf(msg.sender) < shares) revert InsufficientShares();

        amount = convertToAssets(shares);
        uint256 cash = availableCash();
        if (amount > cash) revert InsufficientCash(cash, amount);

        _burn(msg.sender, shares);
        asset.safeTransfer(receiver, amount);
        emit Withdrawn(receiver, amount, shares);
    }

    /// @notice Largest redemption this vault can honour right now, in asset units.
    function maxWithdraw(address lender) external view returns (uint256) {
        uint256 owed = convertToAssets(balanceOf(lender));
        uint256 cash = availableCash();
        return owed < cash ? owed : cash;
    }

    // ---------------------------------------------------------------------------------
    // ClearingHouse flows
    // ---------------------------------------------------------------------------------

    function lend(address to, uint256 amount) external onlyClearing nonReentrant {
        uint256 cash = availableCash();
        if (amount > cash) revert InsufficientCash(cash, amount);
        totalPrincipal += amount;
        asset.safeTransfer(to, amount);
        emit CashLent(to, amount);
    }

    /// @notice Book a repayment. `tokensIn` is in SETTLEMENT-TOKEN units and has already arrived.
    ///
    /// @dev Every quantity on this contract's books is token-denominated. Passing a USD amount
    ///      corrupts NAV silently, which is exactly what happened before: `totalAssets()` sums
    ///      these against `asset.balanceOf(this)`, so a single mixed unit poisons every share
    ///      price and every withdrawal quote, and lenders lose access to their own deposit.
    ///
    ///      Interest is retired before principal. That ordering keeps `accruedReceivables`
    ///      draining rather than growing without bound, which was the second half of the same
    ///      defect: the previous caller passed a hardcoded zero interest, so the branch that
    ///      reduces receivables and funds reserves was unreachable.
    function onRepaid(uint256 tokensIn, uint16 reserveFactorBps) external onlyClearing {
        uint256 interestPart = accruedReceivables < tokensIn ? accruedReceivables : tokensIn;
        uint256 principalPart = tokensIn - interestPart;

        if (interestPart > 0) {
            accruedReceivables -= interestPart;
            uint256 toReserves = RiskMath.mulDiv(interestPart, reserveFactorBps, Types.BPS);
            reserves += toReserves;
            emit ReservesAccrued(toReserves);
        }

        totalPrincipal = totalPrincipal > principalPart ? totalPrincipal - principalPart : 0;
        emit CashReturned(principalPart, interestPart);
    }

    /// @notice Recognise accrued interest, in settlement-token units.
    function accrue(uint256 interestDeltaTokens) external onlyClearing {
        accruedReceivables += interestDeltaTokens;
    }

    /// @notice Write off unrecoverable principal, in settlement-token units.
    function recordBadDebt(uint256 amountTokens) external onlyClearing {
        totalPrincipal = totalPrincipal > amountTokens ? totalPrincipal - amountTokens : 0;
        badDebt += amountTokens;
        emit BadDebtRecorded(amountTokens);
    }

    function reserveCash(uint256 amount) external onlyClearing {
        uint256 cash = availableCash();
        if (amount > cash) revert InsufficientCash(cash, amount);
        reservedCash += amount;
    }

    function releaseCash(uint256 amount) external onlyClearing {
        reservedCash = reservedCash > amount ? reservedCash - amount : 0;
    }
}

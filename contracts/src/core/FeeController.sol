// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

import {Authority, Authorized} from "./Authority.sol";
import {RiskPolicyRegistry} from "./RiskPolicyRegistry.sol";
import {Types} from "../libraries/Types.sol";

/// @title FeeController
/// @notice Every protocol economic parameter, in one place, with bounds.
/// @dev Fee constants scattered through contracts are fee constants nobody can audit as a set. The
///      question an auditor actually asks is "what is the most this protocol can take from me", and
///      answering it should not require reading five contracts.
///
///      Three rules run through the file.
///
///      **Every parameter has a hard ceiling written in the bytecode.** Not a governance-settable
///      ceiling — a constant. Governance that can raise its own limit has no limit, and the whole
///      point of bounding a liquidation fee is that the party who benefits from raising it is the
///      party who would be setting it.
///
///      **Increases and decreases are not the same action.** Lowering what the protocol charges
///      cannot harm a user, so it applies immediately. Raising it changes the economics an
///      outstanding quote was produced under, so it advances the risk epoch and that quote is
///      refused rather than executed under terms nobody showed the user.
///
///      **Parameters exist for products that exist.** The interfaces for trading and repo fees are
///      declared so their shape is fixed, and they are inert: setting either to anything but zero
///      reverts until there is a venue to charge for. A fee schedule for a product nobody can use is
///      a revenue claim, not an interface.
contract FeeController is Authorized {
    RiskPolicyRegistry public immutable policies;

    // ---------------------------------------------------------------------------------
    // Ceilings. Constant, not settable.
    // ---------------------------------------------------------------------------------

    /// @dev Above roughly this, liquidating becomes more attractive than lending and keepers start
    ///      preferring accounts near the boundary. It also bounds how much of a breached position a
    ///      keeper can extract in a single round.
    uint16 public constant MAX_LIQUIDATOR_INCENTIVE_BPS = 1_000; // 10%

    /// @dev The protocol's cut of a liquidation. Deliberately an order of magnitude below the
    ///      keeper's: the protocol is not the party taking execution risk, and a protocol earning
    ///      more from a liquidation than the keeper who performed it has an incentive nobody should
    ///      want it to have.
    uint16 public constant MAX_PROTOCOL_LIQUIDATION_FEE_BPS = 100; // 1%

    /// @dev Charged once on a draw. Bounded low because it is the one fee a borrower cannot avoid
    ///      by behaving well.
    uint16 public constant MAX_ORIGINATION_FEE_BPS = 50; // 0.5%

    /// @dev The protocol's share of borrower interest. The rest is lender yield.
    uint16 public constant MAX_FINANCING_RESERVE_FACTOR_BPS = 3_000; // 30%

    /// @dev A liquidation must never consume more than the position. Incentive plus fee is checked
    ///      jointly, because two individually-bounded parameters can still be ruinous together.
    uint16 public constant MAX_COMBINED_LIQUIDATION_TAKE_BPS = 1_050; // 10.5%

    // ---------------------------------------------------------------------------------
    // Parameters
    // ---------------------------------------------------------------------------------

    /// @notice Paid to whoever performs a liquidation, out of the proceeds.
    uint16 public liquidatorIncentiveBps;
    /// @notice The protocol's cut of a liquidation, out of the same proceeds.
    uint16 public protocolLiquidationFeeBps;
    /// @notice Charged on a new draw.
    uint16 public originationFeeBps;
    /// @notice The protocol's share of borrower interest; the remainder accrues to lenders.
    uint16 public financingReserveFactorBps;

    /// @notice Declared so the shape is fixed. Inert until there is a venue to charge for.
    uint16 public tradingFeeBps;
    /// @notice Declared so the shape is fixed. Inert until securities lending exists.
    uint16 public repoFeeBps;

    /// @notice Where protocol fees accrue.
    address public treasury;

    event FeeSet(bytes32 indexed parameter, uint256 previous, uint256 current, bool increased);
    event TreasurySet(address previous, address current);

    error AboveCeiling(bytes32 parameter, uint256 requested, uint256 ceiling);
    error CombinedLiquidationTakeTooHigh(uint256 requested, uint256 ceiling);
    error ProductNotLive(bytes32 parameter);
    error ZeroTreasury();

    constructor(Authority authority_, RiskPolicyRegistry policies_, address treasury_)
        Authorized(authority_)
    {
        if (treasury_ == address(0)) revert ZeroTreasury();
        policies = policies_;
        treasury = treasury_;

        // Defaults chosen so a fresh deployment has a working liquidation market rather than a
        // dormant one. A protocol whose keeper incentive starts at zero has no keepers on the day
        // it first needs them.
        liquidatorIncentiveBps = 500; // 5%
        protocolLiquidationFeeBps = 50; // 0.5%
        originationFeeBps = 0;
        financingReserveFactorBps = 1_000; // 10%
    }

    // ---------------------------------------------------------------------------------
    // Setters
    // ---------------------------------------------------------------------------------

    /// @dev Shared tail for every setter. Raising a fee changes the economics an outstanding quote
    ///      was produced under, so it moves the epoch and those quotes are refused. Lowering one
    ///      cannot harm anybody holding a quote, so it does not.
    function _record(bytes32 parameter, uint256 previous, uint256 current, bytes32 cause) private {
        bool increased = current > previous;
        emit FeeSet(parameter, previous, current, increased);
        if (increased) policies.bumpEpoch(cause);
    }

    function setLiquidatorIncentive(uint16 bps) external onlyRole(authority.GOVERNANCE()) {
        if (bps > MAX_LIQUIDATOR_INCENTIVE_BPS) {
            revert AboveCeiling("liquidatorIncentive", bps, MAX_LIQUIDATOR_INCENTIVE_BPS);
        }
        _requireCombinedTakeInBounds(bps, protocolLiquidationFeeBps);

        uint16 previous = liquidatorIncentiveBps;
        liquidatorIncentiveBps = bps;
        // Risk-relevant in principle in both directions, because it changes how much collateral a
        // liquidation consumes and therefore how much a round repairs. Only an increase can make an
        // outstanding quote worse than the user was shown.
        _record("liquidatorIncentive", previous, bps, keccak256("LIQUIDATOR_INCENTIVE_RAISED"));
    }

    function setProtocolLiquidationFee(uint16 bps) external onlyRole(authority.GOVERNANCE()) {
        if (bps > MAX_PROTOCOL_LIQUIDATION_FEE_BPS) {
            revert AboveCeiling("protocolLiquidationFee", bps, MAX_PROTOCOL_LIQUIDATION_FEE_BPS);
        }
        _requireCombinedTakeInBounds(liquidatorIncentiveBps, bps);

        uint16 previous = protocolLiquidationFeeBps;
        protocolLiquidationFeeBps = bps;
        _record("protocolLiquidationFee", previous, bps, keccak256("PROTOCOL_LIQUIDATION_FEE_RAISED"));
    }

    function setOriginationFee(uint16 bps) external onlyRole(authority.GOVERNANCE()) {
        if (bps > MAX_ORIGINATION_FEE_BPS) {
            revert AboveCeiling("originationFee", bps, MAX_ORIGINATION_FEE_BPS);
        }
        uint16 previous = originationFeeBps;
        originationFeeBps = bps;
        _record("originationFee", previous, bps, keccak256("ORIGINATION_FEE_RAISED"));
    }

    function setFinancingReserveFactor(uint16 bps) external onlyRole(authority.GOVERNANCE()) {
        if (bps > MAX_FINANCING_RESERVE_FACTOR_BPS) {
            revert AboveCeiling("financingReserveFactor", bps, MAX_FINANCING_RESERVE_FACTOR_BPS);
        }
        uint16 previous = financingReserveFactorBps;
        financingReserveFactorBps = bps;
        // Taking a larger share of interest reduces lender yield. It does not change a borrower's
        // risk, so it does not disturb the epoch.
        emit FeeSet("financingReserveFactor", previous, bps, bps > previous);
    }

    /// @dev Both accept zero and nothing else. The parameter exists so its shape is fixed and
    ///      callers can already read it; charging for a product that cannot be used would be a
    ///      revenue claim rather than an interface.
    function setTradingFee(uint16 bps) external onlyRole(authority.GOVERNANCE()) {
        if (bps != 0) revert ProductNotLive("tradingFee");
        tradingFeeBps = 0;
    }

    function setRepoFee(uint16 bps) external onlyRole(authority.GOVERNANCE()) {
        if (bps != 0) revert ProductNotLive("repoFee");
        repoFeeBps = 0;
    }

    function setTreasury(address treasury_) external onlyRole(authority.GOVERNANCE()) {
        if (treasury_ == address(0)) revert ZeroTreasury();
        address previous = treasury;
        treasury = treasury_;
        emit TreasurySet(previous, treasury_);
    }

    /// @dev Checked jointly. Two individually-bounded parameters can still be ruinous together, and
    ///      the number that matters to a borrower is what leaves their position in total.
    function _requireCombinedTakeInBounds(uint16 incentive, uint16 fee) private pure {
        uint256 combined = uint256(incentive) + fee;
        if (combined > MAX_COMBINED_LIQUIDATION_TAKE_BPS) {
            revert CombinedLiquidationTakeTooHigh(combined, MAX_COMBINED_LIQUIDATION_TAKE_BPS);
        }
    }

    // ---------------------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------------------

    /// @notice Total basis points of liquidation proceeds that do not retire debt.
    /// @dev The single number the planner needs. Collateral must be grossed up by this to retire a
    ///      given amount of debt, and every extra basis point here is a basis point of the
    ///      borrower's position that repairs nothing.
    function liquidationTakeBps() external view returns (uint16) {
        return liquidatorIncentiveBps + protocolLiquidationFeeBps;
    }

    /// @notice How proceeds split, in settlement-token units.
    /// @dev Returned as one call so a caller cannot compute two of the three and let rounding invent
    ///      the difference. `toDebt` is the residual by construction, which is what makes the split
    ///      exact rather than approximately exact — and it means any rounding dust lands on the
    ///      borrower's debt rather than in a fee.
    function splitLiquidationProceeds(uint256 proceeds)
        external
        view
        returns (uint256 toKeeper, uint256 toProtocol, uint256 toDebt)
    {
        toKeeper = (proceeds * liquidatorIncentiveBps) / Types.BPS;
        toProtocol = (proceeds * protocolLiquidationFeeBps) / Types.BPS;
        toDebt = proceeds - toKeeper - toProtocol;
    }
}

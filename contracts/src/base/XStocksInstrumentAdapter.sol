// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

import {IInstrumentAdapter, CorporateActionSnapshot} from "./interfaces/IBaseFacility.sol";

/// @notice The minimal current xStocks EVM surface used by Usance custody.
/// @dev `balanceOf` is deliberately absent: it is multiplier-adjusted and must not be represented
/// as stable custody ownership. `sharesOf` is the canonical stable quantity.
interface IXStocksShareToken {
    function decimals() external view returns (uint8);
    function sharesOf(address account) external view returns (uint256);
    function getCurrentMultiplier() external view returns (uint256);
}

/// @notice Read-only corporate-action reporter boundary. Current xStocks token contracts expose
/// the active multiplier, while pending activation data is published through issuer infrastructure.
/// A production implementation must bind this to verified issuer/API evidence; an unavailable or
/// stale reporter is intentionally fail-closed.
interface IXStocksCorporateActionReporter {
    function state(bytes32 instrumentId)
        external
        view
        returns (
            uint256 reportedCurrentMultiplierWad,
            uint256 pendingMultiplierWad,
            uint64 pendingActivationAt,
            uint64 observedBlock,
            uint64 observedAt,
            bool fresh,
            bool transfersAllowed
        );
}

/// @title XStocksInstrumentAdapter
/// @notice Conservative adapter for an exact xStocks token identity. It exposes stable token
/// shares to custody and marks the risk snapshot paused whenever pending corporate-action
/// evidence is fresh or the reporter cannot establish current state.
contract XStocksInstrumentAdapter is IInstrumentAdapter {
    uint8 internal constant MODE_REBASING_BALANCE = 2;
    uint8 internal constant PRICE_FACTOR_IN_QUANTITY = 2;
    uint8 internal constant FEED_LIVE = 0;
    uint8 internal constant FEED_PAUSED_FOR_ACTION = 1;
    uint8 internal constant FEED_UNKNOWN = 3;
    uint8 internal constant SUPPORT_TESTED = 1;

    IXStocksShareToken public immutable token;
    IXStocksCorporateActionReporter public immutable reporter;
    bytes32 internal immutable _instrumentId;
    uint8 internal immutable _decimals;
    uint8 public immutable declaredSupport;

    error MultiplierZero();

    constructor(address token_, address reporter_, bytes32 instrumentId_, uint8 support_) {
        token = IXStocksShareToken(token_);
        reporter = IXStocksCorporateActionReporter(reporter_);
        _instrumentId = instrumentId_;
        _decimals = IXStocksShareToken(token_).decimals();
        declaredSupport = support_;
    }

    function instrumentId() external view returns (bytes32) {
        return _instrumentId;
    }

    function decimals() external view returns (uint8) {
        return _decimals;
    }

    /// @notice Stable internal ownership, never the adjusted ERC-20 presentation amount.
    function rawBalanceOf(address custodian) external view returns (uint256) {
        return token.sharesOf(custodian);
    }

    function factorWad() public view returns (uint256 multiplier) {
        multiplier = token.getCurrentMultiplier();
        if (multiplier == 0) revert MultiplierZero();
    }

    function snapshot() external view returns (CorporateActionSnapshot memory s) {
        uint256 current = factorWad();
        (
            uint256 reportedCurrent,
            uint256 pending,
            uint64 activationAt,
            uint64 observedBlock,
            uint64 observedAt,
            bool fresh,
            bool transfersAllowed
        ) = reporter.state(_instrumentId);

        s.instrumentId = _instrumentId;
        s.accountingMode = MODE_REBASING_BALANCE;
        s.factorWad = current;
        s.pendingFactorWad = pending;
        s.pendingActivationAt = activationAt;
        s.sourceBlock = observedBlock;
        s.observedAt = observedAt;
        s.priceConvention = PRICE_FACTOR_IN_QUANTITY;
        s.support = declaredSupport <= SUPPORT_TESTED ? declaredSupport : SUPPORT_TESTED;

        // A pending state is a deliberate pause, not a prediction. A reporter mismatch, stale
        // evidence, or transfer uncertainty is UNKNOWN and therefore cannot increase risk.
        if (!fresh || !transfersAllowed || reportedCurrent != current) {
            s.feedStatus = FEED_UNKNOWN;
        } else if (pending != 0) {
            s.feedStatus = FEED_PAUSED_FOR_ACTION;
        } else {
            s.feedStatus = FEED_LIVE;
        }
    }

    function transferable(address, address) external view returns (bool ok, bytes32 reason) {
        (uint256 reportedCurrent,,,,, bool fresh, bool transfersAllowed) = reporter.state(_instrumentId);
        if (!fresh || !transfersAllowed || reportedCurrent != factorWad()) {
            return (false, bytes32("XSTOCK_UNKNOWN"));
        }
        return (true, bytes32(0));
    }
}

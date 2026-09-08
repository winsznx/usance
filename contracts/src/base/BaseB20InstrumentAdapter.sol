// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

import {IInstrumentAdapter, CorporateActionSnapshot} from "./interfaces/IBaseFacility.sol";
import {IB20AssetMin} from "./adapters/IB20AssetMin.sol";

/// @title BaseB20InstrumentAdapter
/// @notice `IInstrumentAdapter` over one Base B20 ASSET-variant token. Zero custody — a read facade.
///         `spec/base-portfolio-facility-model.md §4`, `spec/corporate-action-model.md §2` (B20 =
///         `EXTERNALLY_SCALED`, `priceConvention = FACTOR_IN_PRICE`).
///
/// @dev The corporate-action factor is the token's `multiplier()` (Beryl: applied instantly on
///      `updateMultiplier`, no on-chain pending disclosure). The adapter probes the Cobalt
///      ERC-8056 selectors `newUIMultiplier()` / `effectiveAt()` by low-level staticcall: absent
///      (Beryl) → `pendingFactorWad = 0`, `feedStatus` is derived from the token pause + an
///      external feed-freshness flag the facility passes in; present (Cobalt) → read them.
///
///      `rawBalanceOf` returns the RAW balance — the quantity side of a `FACTOR_IN_PRICE`
///      valuation must never use `scaledBalanceOf` (applying the multiplier twice is the I-84
///      defect).
contract BaseB20InstrumentAdapter is IInstrumentAdapter {
    uint8 internal constant MODE_EXTERNALLY_SCALED = 1;
    uint8 internal constant PRICE_FACTOR_IN_PRICE = 1;

    uint8 internal constant FEED_LIVE = 0;
    uint8 internal constant FEED_PAUSED_FOR_ACTION = 1;
    uint8 internal constant FEED_STALE = 2;

    uint8 internal constant SUPPORT_VERIFIED = 0;
    uint8 internal constant SUPPORT_TESTED = 1;

    IB20AssetMin public immutable token;
    bytes32 internal immutable _instrumentId;
    uint8 internal immutable _decimals;
    uint8 public immutable declaredSupport; // VERIFIED for a characterized mainnet instrument, TESTED for SYNTHETIC_TEST_B20

    // low-level selectors for the Cobalt ERC-8056 pending-multiplier read path
    bytes4 private constant SEL_NEW_UI_MULTIPLIER = 0xdc767007;
    bytes4 private constant SEL_EFFECTIVE_AT = 0x97a4064f;

    error MultiplierZero();
    error DecimalsMismatch(uint8 fromToken, uint8 declared);

    constructor(address token_, bytes32 instrumentId_, uint8 support_) {
        token = IB20AssetMin(token_);
        _instrumentId = instrumentId_;
        _decimals = IB20AssetMin(token_).decimals();
        declaredSupport = support_;
    }

    function instrumentId() external view returns (bytes32) {
        return _instrumentId;
    }

    function decimals() external view returns (uint8) {
        return _decimals;
    }

    function rawBalanceOf(address custodian) external view returns (uint256) {
        return token.balanceOf(custodian);
    }

    function factorWad() public view returns (uint256 f) {
        f = token.multiplier();
        if (f == 0) revert MultiplierZero();
    }

    /// @notice A snapshot with `feedStatus` decided only from on-chain B20 state (token pause +
    ///         Cobalt pending window). The oracle-derived freshness component is folded in by the
    ///         facility (which holds the Chainlink `updatedAt`).
    function snapshot() public view returns (CorporateActionSnapshot memory s) {
        s.instrumentId = _instrumentId;
        s.accountingMode = MODE_EXTERNALLY_SCALED;
        s.factorWad = factorWad();
        s.priceConvention = PRICE_FACTOR_IN_PRICE;
        s.support = declaredSupport <= SUPPORT_TESTED ? declaredSupport : SUPPORT_TESTED;
        s.sourceBlock = uint64(block.number);
        s.observedAt = uint64(block.timestamp);

        (uint256 pending, uint64 activationAt) = _probePending();
        s.pendingFactorWad = pending;
        s.pendingActivationAt = activationAt;

        bool tokenPaused = token.isPaused(0); // TRANSFER
        if (tokenPaused) {
            s.feedStatus = FEED_PAUSED_FOR_ACTION;
        } else if (pending != 0 && activationAt > block.timestamp) {
            s.feedStatus = FEED_PAUSED_FOR_ACTION; // activation window — fail closed (I-83)
        } else {
            s.feedStatus = FEED_LIVE;
        }
    }

    function transferable(address, address) external view returns (bool ok, bytes32 reason) {
        if (token.isPaused(0)) return (false, bytes32("B20_TRANSFER_PAUSED"));
        return (true, bytes32(0));
    }

    /// @return supported true when the Cobalt ERC-8056 pending-multiplier surface is live on this chain
    function b20HasScheduledMultiplier() external view returns (bool supported) {
        (bool ok,) = address(token).staticcall(abi.encodeWithSelector(SEL_EFFECTIVE_AT));
        return ok;
    }

    function _probePending() internal view returns (uint256 pending, uint64 activationAt) {
        (bool okE, bytes memory dataE) = address(token).staticcall(abi.encodeWithSelector(SEL_EFFECTIVE_AT));
        (bool okN, bytes memory dataN) =
            address(token).staticcall(abi.encodeWithSelector(SEL_NEW_UI_MULTIPLIER));
        if (okE && okN && dataE.length == 32 && dataN.length == 32) {
            activationAt = uint64(abi.decode(dataE, (uint256)));
            pending = abi.decode(dataN, (uint256));
            if (activationAt == 0) pending = 0; // no live pending update
        }
        // Beryl: both revert → (0, 0). The activation window then relies on the oracle pause +
        // Announcement events indexed off-chain.
    }
}

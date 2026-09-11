// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

/// @title Base portfolio-revolving-credit facility interfaces
/// @notice Provider-neutral. `spec/base-portfolio-facility-model.md`. Additive to the live X Layer
///         deployment; no deployed-core contract implements or imports any of these.

/// @dev The corporate-action state an instrument adapter pins on every quote / epoch.
///      `spec/corporate-action-model.md §3`. B20 is `EXTERNALLY_SCALED` with `FACTOR_IN_PRICE`.
struct CorporateActionSnapshot {
    bytes32 instrumentId;
    uint8 accountingMode; // 0 FIXED_UNIT, 1 EXTERNALLY_SCALED, 2 REBASING_BALANCE, ...
    uint256 factorWad; // current effective multiplier, WAD (1e18 = neutral)
    uint256 pendingFactorWad; // 0 when none / not disclosed on-chain (Beryl)
    uint64 pendingActivationAt; // 0 when none
    uint64 sourceBlock;
    uint8 priceConvention; // 0 FACTOR_ABSENT, 1 FACTOR_IN_PRICE, 2 FACTOR_IN_QUANTITY
    uint8 feedStatus; // 0 LIVE, 1 PAUSED_FOR_ACTION, 2 STALE, 3 UNKNOWN
    uint8 support; // 0 VERIFIED, 1 TESTED, 2 RESTRICTED, 3 UNKNOWN, 4 UNSUPPORTED
    uint64 observedAt;
}

/// @notice Zero-custody read facade over one tokenized instrument. `spec/base-portfolio-facility-model.md §4`.
interface IInstrumentAdapter {
    /// @return instrumentId the stable identity this adapter reads (never a ticker, never mutable state)
    function instrumentId() external view returns (bytes32);

    /// @return decimals the token's ERC-20 decimals
    function decimals() external view returns (uint8);

    /// @notice The raw (corporate-action-stable) balance the custody address holds.
    function rawBalanceOf(address custodian) external view returns (uint256);

    /// @notice The current corporate-action factor, WAD. For B20 this is `multiplier()`.
    function factorWad() external view returns (uint256);

    /// @notice A fully-pinned snapshot for a quote / epoch.
    function snapshot() external view returns (CorporateActionSnapshot memory);

    /// @notice Whether the instrument can currently be moved into or out of custody.
    ///         B20: `!isPaused(TRANSFER)` and any policy gate. Load-bearing for `commit` (I-101 analogue).
    function transferable(address from, address to) external view returns (bool ok, bytes32 reason);
}

/// @notice Provider-neutral custody boundary for a portfolio facility.
///
/// `claim` is deliberately opaque to the facility. For a FIXED_UNIT/B20 vault it is a nominal raw
/// amount; for a rebasing xStocks vault it is a stable pro-rata share claim. `valuationQuantity`
/// is the only quantity the facility may multiply by the admitted oracle price, and the custody
/// implementation must select it so the corporate-action factor appears exactly once.
interface IPortfolioCollateralVault {
    function deposit(bytes32 instrumentId, address from, address account, uint256 requested)
        external
        returns (uint256 claimMinted);

    function claimOf(bytes32 instrumentId, address account) external view returns (uint256);

    function valuationQuantityOf(bytes32 instrumentId, address account) external view returns (uint256);

    function valuationQuantityAfterWithdrawal(bytes32 instrumentId, address account, uint256 claim)
        external
        view
        returns (uint256);

    function valuationQuantityForClaim(bytes32 instrumentId, address account, uint256 claim)
        external
        view
        returns (uint256);

    function withdrawClaim(bytes32 instrumentId, address account, uint256 claim)
        external
        returns (uint256 amountOut);

    function liquidationTransfer(bytes32 instrumentId, address account, address to, uint256 claim)
        external
        returns (uint256 amountOut);
}

/// @notice USD18 price of a tokenized instrument. `spec/base-portfolio-facility-model.md §8`.
interface IBaseOracleAdapter {
    /// @return priceUsd18 the price the risk pipeline multiplies the RAW quantity by
    ///         (`FACTOR_IN_PRICE`: already includes the multiplier).
    /// @return updatedAt the source `updatedAt`
    /// @return live true only when fresh for the current market session AND not paused-for-action
    function priceUsd18(bytes32 instrumentId)
        external
        view
        returns (uint256 priceUsd18, uint64 updatedAt, bool live);

    /// @return isTestOnly true for a `TEST_ONLY` price source (Sepolia synthetic instruments)
    function isTestOnly() external view returns (bool);
}

/// @notice The underlying market's session, not the on-chain pool's. `spec/base-portfolio-facility-model.md §13`.
///         0 OPEN, 1 PRE_MARKET, 2 POST_MARKET, 3 CLOSED, 4 UNKNOWN. Degradation never raises capacity (I-113).
interface IMarketSession {
    function sessionOf(bytes32 instrumentId, uint64 atTime) external view returns (uint8 session);
}

/// @notice A measured, size-aware exit estimate on a real Base venue. Not a trading simulator.
///         `spec/base-portfolio-facility-model.md §8`, `portfolio-risk-model.md §3` LIQUIDITY.
interface ILiquidityObserver {
    struct Observation {
        bytes32 liquidityGroupId; // declared route; bytes32(0) => position is NOT liquidity-capped
        uint256 depthUsd18; // total usable depth on the route
        uint256 sizeAwareExitUsd18; // proceeds estimate for `notionalUsd18` (<= notionalUsd18)
        uint64 observedBlock;
        uint64 observedAt;
    }

    function observe(bytes32 instrumentId, uint256 notionalUsd18) external view returns (Observation memory);
}

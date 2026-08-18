// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Authority, Authorized} from "../core/Authority.sol";
import {AssetRegistry} from "../core/AssetRegistry.sol";
import {IOracleAdapter} from "../interfaces/IOracleAdapter.sol";
import {ILiquidationRoute} from "../interfaces/ILiquidationRoute.sol";
import {RiskMath} from "../libraries/RiskMath.sol";
import {Types} from "../libraries/Types.sol";

/// @title DirectSettlementRoute
/// @notice A deterministic liquidation route backed by a pre-funded settlement buffer.
/// @dev This is not a market. It exists so the liquidation lifecycle can be exercised end to end on
///      a chain where none of the real venues are reachable, and it is named for what it is.
///
///      The real routes named in the canonical PRD §33 — Exchange OS, OKX DEX, issuer redemption,
///      RFQ market maker — are not implemented, because Usance has access to none of them. An
///      adapter for a venue that cannot be called would quote numbers nobody can honour, and the
///      router would happily select it.
///
///      What this route does model faithfully is the *shape* of the quote: gross proceeds, fees,
///      a latency haircut and a failure haircut, priced separately. A route that returned one net
///      figure would let the router rank on a number that hides which deduction moved.
contract DirectSettlementRoute is ILiquidationRoute, Authorized {
    using SafeERC20 for IERC20;

    AssetRegistry public immutable assets;
    IOracleAdapter public immutable oracle;
    IERC20 public immutable settlement;
    uint8 public immutable settlementDecimals;

    /// @notice Deductions, in basis points, applied to gross proceeds.
    uint16 public feeBps;
    uint16 public latencyHaircutBps;
    uint16 public failureHaircutBps;

    /// @notice How old the collateral price may be before this route refuses to quote.
    /// @dev Slither flagged `quote` as an oracle read with no freshness check, and it was right in a
    ///      way that matters more here than elsewhere. The risk pipeline already gates an account on
    ///      collateral price age, but a *route* pricing a seizure off a day-old figure decides how
    ///      much collateral leaves the account. Being wrong there is not a blocked transaction, it
    ///      is the wrong amount of somebody's money.
    ///
    ///      Two heartbeats, the same bound the settlement policy uses and for the same measured
    ///      reason: see artifacts/oracles/xlayer-mainnet-feeds.json.
    uint64 public maxPriceAge = 172_800;

    event ParametersSet(uint16 feeBps, uint16 latencyHaircutBps, uint16 failureHaircutBps);
    event Filled(bytes32 indexed assetId, uint256 amount, uint256 proceeds);

    error InsufficientBuffer(uint256 needed, uint256 available);
    error ProceedsBelowMinimum(uint256 proceeds, uint256 minProceeds);
    error AssetUnpriced(bytes32 assetId);
    error PriceTooStaleToSeize(uint64 age, uint64 maxAge);
    error BadParameters();

    constructor(
        Authority authority_,
        AssetRegistry assets_,
        IOracleAdapter oracle_,
        IERC20 settlement_,
        uint8 settlementDecimals_
    ) Authorized(authority_) {
        assets = assets_;
        oracle = oracle_;
        settlement = settlement_;
        settlementDecimals = settlementDecimals_;
        feeBps = 30;
        latencyHaircutBps = 50;
        failureHaircutBps = 20;
    }

    function routeId() external pure returns (bytes32) {
        return keccak256("USANCE_DIRECT_SETTLEMENT_TESTNET");
    }

    function description() external pure returns (string memory) {
        return "direct settlement buffer (TESTNET ROUTE - NOT A MARKET VENUE)";
    }

    function setParameters(uint16 fee, uint16 latency, uint16 failure)
        external
        onlyRole(authority.GOVERNANCE())
    {
        if (uint256(fee) + latency + failure >= Types.BPS) revert BadParameters();
        feeBps = fee;
        latencyHaircutBps = latency;
        failureHaircutBps = failure;
        emit ParametersSet(fee, latency, failure);
    }

    /// @notice Available only while the buffer can pay and the price is fresh enough to seize on.
    /// @dev Returning false rather than reverting, so the router simply does not select this route.
    ///      A route that reverts during selection takes every other route down with it.
    function isAvailable(bytes32 assetId) external view returns (bool) {
        (uint256 price, uint64 updatedAt) = oracle.getPrice(assetId);
        if (price == 0) return false;
        if (_age(updatedAt) > maxPriceAge) return false;
        return settlement.balanceOf(address(this)) > 0;
    }

    function setMaxPriceAge(uint64 maxAge) external onlyRole(authority.GOVERNANCE()) {
        if (maxAge == 0) revert BadParameters();
        maxPriceAge = maxAge;
    }

    /// @dev Saturating. Ordinary L2 clock skew puts a feed a second into the future routinely and
    ///      unsigned subtraction panics on it — the same reason RiskMath._age exists.
    function _age(uint64 then) private view returns (uint64) {
        uint64 nowTs = uint64(block.timestamp);
        return nowTs > then ? nowTs - then : 0;
    }

    function quote(bytes32 assetId, uint256 amount)
        public
        view
        returns (
            uint256 proceeds,
            uint256 fees,
            uint256 latencyHaircut,
            uint256 failureHaircut,
            uint256 expectedRecovery
        )
    {
        (uint256 priceUsd18,) = oracle.getPrice(assetId);
        if (priceUsd18 == 0) revert AssetUnpriced(assetId);

        AssetRegistry.AssetConfig memory a = assets.getAsset(assetId);
        // amount is in the asset's own decimals; price is usd18 per whole unit.
        uint256 grossUsd18 = RiskMath.mulDiv(amount, priceUsd18, 10 ** a.decimals);

        proceeds = RiskMath.mulDiv(grossUsd18, 10 ** settlementDecimals, 1e18);
        fees = RiskMath.mulDiv(proceeds, feeBps, Types.BPS);
        latencyHaircut = RiskMath.mulDiv(proceeds, latencyHaircutBps, Types.BPS);
        failureHaircut = RiskMath.mulDiv(proceeds, failureHaircutBps, Types.BPS);

        uint256 deductions = fees + latencyHaircut + failureHaircut;
        expectedRecovery = proceeds > deductions ? proceeds - deductions : 0;
    }

    function execute(bytes32 assetId, uint256 amount, uint256 minProceeds, address recipient)
        external
        onlyRole(authority.CLEARING())
        returns (uint256 proceeds)
    {
        (,,,, proceeds) = quote(assetId, amount);
        if (proceeds < minProceeds) revert ProceedsBelowMinimum(proceeds, minProceeds);

        uint256 available = settlement.balanceOf(address(this));
        if (proceeds > available) revert InsufficientBuffer(proceeds, available);

        // The collateral has already arrived here. Nothing is done with it beyond holding it: this
        // is a settlement buffer standing in for a venue, and pretending otherwise would be the
        // fake-execution failure the whole project refuses.
        settlement.safeTransfer(recipient, proceeds);
        emit Filled(assetId, amount, proceeds);
    }
}

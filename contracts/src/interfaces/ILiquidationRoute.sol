// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

/// @title ILiquidationRoute
/// @notice One way out of a position.
/// @dev Liquidation is a router, not a market sell. The canonical PRD §33 lists seven exits —
///      Exchange OS, OKX DEX, issuer redemption, RFQ market maker, securities return, offsetting
///      hedge, approved secondary venue — and they differ in the ways that decide which one is
///      right: how much they pay, how long they take, and how likely they are to fail halfway.
///
///      Only routes that exist are registered. An adapter for a venue Usance has no access to would
///      quote numbers nobody can honour, and a router that selected it would look like it was
///      working. `LiquidationManager` reports the routes it has and does not pretend about the rest.
interface ILiquidationRoute {
    /// @notice Identity, for receipts and for refusing to register the same route twice.
    function routeId() external view returns (bytes32);

    /// @notice Human-readable, e.g. "direct settlement (testnet)".
    function description() external view returns (string memory);

    /// @notice Whether this route can act right now. A route with no counterparty is not a route.
    function isAvailable(bytes32 assetId) external view returns (bool);

    /**
     * @notice What this route expects to recover for `amount` of `assetId`, in settlement tokens.
     *
     * @dev Every deduction is separate because they behave differently under stress and a single
     *      net number hides which one moved.
     *
     *      - `proceeds` is gross, at the route's own view of price.
     *      - `fees` is what the venue takes.
     *      - `latencyHaircut` prices the time between committing and settling. A route that pays
     *        more but settles in two days is not obviously better than one that pays less now.
     *      - `failureHaircut` prices the chance the route does not complete at all, which is the
     *        deduction a quoted mark price never contains and the reason route choice cannot be
     *        made on price alone.
     *
     *      `expectedRecovery = proceeds - fees - latencyHaircut - failureHaircut`, and it is the
     *      only number the router ranks on.
     */
    function quote(bytes32 assetId, uint256 amount)
        external
        view
        returns (
            uint256 proceeds,
            uint256 fees,
            uint256 latencyHaircut,
            uint256 failureHaircut,
            uint256 expectedRecovery
        );

    /**
     * @notice Sell `amount` of `assetId`, returning settlement tokens to `recipient`.
     * @dev The route is handed the collateral before this is called. It must return at least
     *      `minProceeds` or revert: a route that silently under-delivers turns a liquidation that
     *      should have been abandoned into a realised loss.
     */
    function execute(bytes32 assetId, uint256 amount, uint256 minProceeds, address recipient)
        external
        returns (uint256 proceeds);
}

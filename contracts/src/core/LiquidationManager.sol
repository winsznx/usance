// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

import {Authority, Authorized} from "./Authority.sol";
import {ClearingHouse} from "./ClearingHouse.sol";
import {ILiquidationRoute} from "../interfaces/ILiquidationRoute.sol";
import {RiskMath} from "../libraries/RiskMath.sol";
import {Types} from "../libraries/Types.sol";

/// @title LiquidationManager
/// @notice Progressive deleveraging, routed.
/// @dev Two things this deliberately is not.
///
///      It is not `sellAll()`. Liquidating a whole position to cure a small breach converts a
///      recoverable account into a realised loss and hands the difference to whoever bought the
///      collateral. The manager computes how much debt has to go to restore the account to a safe
///      buffer and takes only the collateral that covers it.
///
///      It is not the first response to deterioration. The account status ladder gives three
///      earlier stages — `NO_NEW_RISK` blocks new borrowing, `REDUCE_ONLY` blocks withdrawal,
///      `MARGIN_CALL` asks for a cure — and liquidation begins only after those have failed. A
///      protocol that liquidates at the first restriction is a protocol whose users leave.
contract LiquidationManager is Authorized {
    ClearingHouse public immutable clearing;

    /// @dev Registered routes, in the order they were added. Selection reads all of them.
    bytes32[] public routeIds;
    mapping(bytes32 routeId => ILiquidationRoute) public routes;

    /**
     * @notice Fills already applied.
     * @dev A liquidation fill is identified by (account, asset, route, nonce). Replaying one would
     *      seize collateral twice for a debt that was already reduced once, which is the single
     *      most valuable bug in any liquidation engine. Recording it here makes the second attempt
     *      a revert rather than a discovery.
     */
    mapping(bytes32 fillId => bool) public filled;

    /// @notice Extra collateral, in bps, taken to pay whoever does the work.
    uint16 public liquidationBonusBps;

    /// @notice How far above the maintenance limit an account is restored to.
    /// @dev Restoring exactly to maintenance leaves the account one wei of price movement from
    ///      being liquidatable again, which produces a sequence of small liquidations that each
    ///      charge a bonus. The buffer is what makes one liquidation enough.
    uint16 public targetBufferBps;

    event RouteRegistered(bytes32 indexed routeId, address route, string description);
    event RouteRemoved(bytes32 indexed routeId);
    event LiquidationParametersSet(uint16 bonusBps, uint16 targetBufferBps);
    event Liquidated(
        address indexed account,
        bytes32 indexed assetId,
        bytes32 indexed routeId,
        uint256 collateralSeized,
        uint256 proceedsUsd18,
        uint256 debtRepaidUsd18,
        uint256 debtRemainingUsd18,
        uint8 statusAfter
    );
    event BadDebtRecorded(address indexed account, uint256 amountUsd18);
    event LiquidationAbandoned(address indexed account, bytes32 indexed assetId, string reason);

    error NotLiquidatable(Types.AccountStatus status);
    error NoRouteAvailable(bytes32 assetId);
    error RouteAlreadyRegistered(bytes32 routeId);
    error UnknownRoute(bytes32 routeId);
    error FillAlreadyApplied(bytes32 fillId);
    error NothingToLiquidate();
    error SeizureExceedsAuthorized(uint256 requested, uint256 authorized);
    error RecoveryBelowFloor(uint256 expected, uint256 floor);
    error BadParameters();

    constructor(Authority authority_, ClearingHouse clearing_) Authorized(authority_) {
        clearing = clearing_;
        liquidationBonusBps = 500; // 5%
        targetBufferBps = 200; // restore to 2% above maintenance
    }

    // ---------------------------------------------------------------------------------
    // Configuration
    // ---------------------------------------------------------------------------------

    function registerRoute(ILiquidationRoute route) external onlyRole(authority.GOVERNANCE()) {
        bytes32 id = route.routeId();
        if (address(routes[id]) != address(0)) revert RouteAlreadyRegistered(id);
        routes[id] = route;
        routeIds.push(id);
        emit RouteRegistered(id, address(route), route.description());
    }

    function removeRoute(bytes32 routeId) external onlyRole(authority.GOVERNANCE()) {
        if (address(routes[routeId]) == address(0)) revert UnknownRoute(routeId);
        delete routes[routeId];
        for (uint256 i = 0; i < routeIds.length; i++) {
            if (routeIds[i] == routeId) {
                routeIds[i] = routeIds[routeIds.length - 1];
                routeIds.pop();
                break;
            }
        }
        emit RouteRemoved(routeId);
    }

    function setParameters(uint16 bonusBps, uint16 bufferBps) external onlyRole(authority.GOVERNANCE()) {
        // A bonus that can exceed the position is a bonus that can create the bad debt it is paid
        // to prevent. Ten percent is already generous for an asset the exit curve says is liquid.
        if (bonusBps > 1_000 || bufferBps > Types.BPS) revert BadParameters();
        liquidationBonusBps = bonusBps;
        targetBufferBps = bufferBps;
        emit LiquidationParametersSet(bonusBps, bufferBps);
    }

    function routeCount() external view returns (uint256) {
        return routeIds.length;
    }

    // ---------------------------------------------------------------------------------
    // Selection
    // ---------------------------------------------------------------------------------

    /**
     * @notice The route with the highest expected recovery for this size, or zero if none.
     * @dev Ranked on `expectedRecovery`, never on `proceeds`. A route that quotes the best gross
     *      price and settles in two days with a real chance of failing is not the best route, and
     *      ranking on the headline number is how a liquidation engine ends up preferring exactly
     *      those.
     */
    function bestRoute(bytes32 assetId, uint256 amount)
        public
        view
        returns (bytes32 routeId, uint256 expectedRecovery)
    {
        for (uint256 i = 0; i < routeIds.length; i++) {
            ILiquidationRoute route = routes[routeIds[i]];
            if (address(route) == address(0)) continue;
            if (!route.isAvailable(assetId)) continue;

            (,,,, uint256 recovery) = route.quote(assetId, amount);
            if (recovery > expectedRecovery) {
                expectedRecovery = recovery;
                routeId = routeIds[i];
            }
        }
    }

    // ---------------------------------------------------------------------------------
    // Planning
    // ---------------------------------------------------------------------------------

    struct Plan {
        bool eligible;
        Types.AccountStatus status;
        uint256 debtUsd18;
        uint256 maintenanceLimitUsd18;
        /// How much debt must go for the account to sit at maintenance plus the buffer.
        uint256 repayTargetUsd18;
        /// Recognised collateral value that has to be sold to raise it, including the bonus.
        uint256 seizeValueUsd18;
        bytes32 routeId;
        uint256 expectedRecovery;
        bool wouldExhaustCollateral;
    }

    /**
     * @notice What a liquidation of this account would do, without doing it.
     * @dev Public because it is what the UI shows an account in `MARGIN_CALL`: the amount that
     *      cures it, and what happens if they do nothing. A margin call that does not say how much
     *      is a red banner.
     */
    function planFor(address account, bytes32 assetId) public view returns (Plan memory plan) {
        (Types.RiskResult memory r,) = clearing.accountHealth(account);

        plan.status = r.status;
        plan.debtUsd18 = r.debtUsd18;
        plan.maintenanceLimitUsd18 = r.maintenanceLimitUsd18;

        // Eligibility is MARGIN_CALL or worse. NO_NEW_RISK and REDUCE_ONLY are restrictions, not
        // liquidation triggers: an account that is merely blocked from borrowing is still solvent
        // against its own maintenance limit and liquidating it would be theft with extra steps.
        plan.eligible = uint8(r.status) >= uint8(Types.AccountStatus.MARGIN_CALL)
            && uint8(r.status) < uint8(Types.AccountStatus.SETTLED);
        if (!plan.eligible || r.debtUsd18 == 0) return plan;

        // Restore to maintenance plus a buffer. Anything less leaves the account one wei of price
        // movement from being liquidatable again, and each of those charges another bonus.
        uint256 target = RiskMath.mulDiv(r.maintenanceLimitUsd18, Types.BPS - targetBufferBps, Types.BPS);
        plan.repayTargetUsd18 = r.debtUsd18 > target ? r.debtUsd18 - target : 0;
        if (plan.repayTargetUsd18 > r.debtUsd18) plan.repayTargetUsd18 = r.debtUsd18;

        plan.seizeValueUsd18 =
            RiskMath.mulDivUp(plan.repayTargetUsd18, Types.BPS + liquidationBonusBps, Types.BPS);

        if (plan.seizeValueUsd18 >= r.totalRecognizedUsd18) {
            // Not enough collateral to cure. The position closes and whatever debt is left is bad
            // debt — named, not absorbed silently into an accounting residue.
            plan.seizeValueUsd18 = r.totalRecognizedUsd18;
            plan.wouldExhaustCollateral = true;
        }

        (plan.routeId, plan.expectedRecovery) = bestRoute(assetId, plan.seizeValueUsd18);
    }
}

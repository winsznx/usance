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
    ///      charge a bonus. The buffer is what makes one liquidation enough — when one can be.
    uint16 public targetBufferBps;

    /// @notice The most of an account's debt a single liquidation may retire.
    /// @dev The standard close factor, and here it is load-bearing rather than conventional.
    ///      Seizing collateral removes borrowing capacity as well as debt, so when the maintenance
    ///      LTV is high the repair per dollar seized is small and the arithmetic asks for more debt
    ///      than the account has. Without a bound the plan would demand the impossible; with one it
    ///      takes a bounded bite and reports that the account is still breached.
    uint16 public closeFactorBps;

    event RouteRegistered(bytes32 indexed routeId, address route, string description);
    event RouteRemoved(bytes32 indexed routeId);
    event LiquidationParametersSet(uint16 bonusBps, uint16 targetBufferBps, uint16 closeFactorBps);
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
        closeFactorBps = 5_000; // at most half the debt in one liquidation
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

    function setParameters(uint16 bonusBps, uint16 bufferBps, uint16 closeFactor)
        external
        onlyRole(authority.GOVERNANCE())
    {
        // A bonus that can exceed the position is a bonus that can create the bad debt it is paid
        // to prevent. Ten percent is already generous for an asset the exit curve says is liquid.
        if (bonusBps > 1_000 || bufferBps > Types.BPS) revert BadParameters();
        if (closeFactor == 0 || closeFactor > Types.BPS) revert BadParameters();
        liquidationBonusBps = bonusBps;
        targetBufferBps = bufferBps;
        closeFactorBps = closeFactor;
        emit LiquidationParametersSet(bonusBps, bufferBps, closeFactor);
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
        /// How much debt this liquidation will retire.
        uint256 repayTargetUsd18;
        /// Recognised collateral value that has to be sold to raise it, including the bonus.
        uint256 seizeValueUsd18;
        bytes32 routeId;
        uint256 expectedRecovery;
        bool wouldExhaustCollateral;
        /**
         * Whether this single liquidation restores the account.
         *
         * False is a real and common answer, not an error. Seizing collateral removes borrowing
         * capacity along with debt, so when the maintenance LTV is high each dollar taken repairs
         * only cents. The account is deleveraged, stays breached, and is liquidated again — which
         * is the honest behaviour, and the plan says so rather than implying one call is enough.
         */
        bool curesTheBreach;
        /// Debt that would have to be retired to cure it, even when that exceeds what is possible.
        uint256 curingRepayUsd18;
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

        plan.curingRepayUsd18 = _repayToCure(r);

        // Bounded by the close factor and by the debt itself. When the curing amount exceeds that
        // bound the liquidation still happens — it deleverages — but the account stays breached and
        // `curesTheBreach` says so.
        uint256 maxThisRound = RiskMath.mulDiv(r.debtUsd18, closeFactorBps, Types.BPS);
        if (maxThisRound > r.debtUsd18) maxThisRound = r.debtUsd18;

        plan.curesTheBreach = plan.curingRepayUsd18 != 0 && plan.curingRepayUsd18 <= maxThisRound;
        plan.repayTargetUsd18 = plan.curesTheBreach ? plan.curingRepayUsd18 : maxThisRound;

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

    /**
     * @dev How much debt must be retired for the account to sit above its maintenance limit, given
     *      that retiring it also shrinks that limit.
     *
     *      The first version of this function ignored the second half of that sentence, and a live
     *      liquidation on X Layer testnet is what caught it. It seized exactly what it planned,
     *      reduced the debt, and left the account still in `MARGIN_CALL`:
     *
     *          before   debt $791.46   maintenance $705.69   breach $85.76
     *          after    debt $687.64   maintenance $613.19   breach $74.45
     *
     *      Twenty unit tests missed it because they compared the post-liquidation debt against the
     *      *pre*-liquidation maintenance limit, which is the one number that is guaranteed not to
     *      apply any more.
     *
     *      Seizing recognised value `S` retires `R = S / (1 + b)` of debt and removes `S × m` of
     *      maintenance limit, where `m` is the effective maintenance LTV. A cure needs:
     *
     *          D - R <= M_target - R(1 + b)m
     *          R     >= (D - M_target) / (1 - (1 + b)m)
     *
     *      The denominator is the repair per dollar retired. At `m = 0.90` and `b = 0.05` it is
     *      0.055: every dollar of collateral taken removes 94.5 cents of capacity while retiring a
     *      dollar of debt. Curing an $85.76 breach would take $1,559 of repayment against $791 of
     *      debt — which is why the answer has to be "not curable this round" rather than a number.
     *
     *      Returns 0 when no amount of liquidation cures the account.
     */
    function _repayToCure(Types.RiskResult memory r) private view returns (uint256) {
        if (r.totalRecognizedUsd18 == 0) return 0;

        uint256 target = RiskMath.mulDiv(r.maintenanceLimitUsd18, Types.BPS - targetBufferBps, Types.BPS);
        if (r.debtUsd18 <= target) return 0;
        uint256 breach = r.debtUsd18 - target;

        // The effective maintenance LTV, read from the account rather than from a policy: with
        // several collateral assets there is no single configured number, and the ratio the risk
        // engine actually produced is the one the arithmetic needs.
        uint256 mBps = RiskMath.mulDiv(r.maintenanceLimitUsd18, Types.BPS, r.totalRecognizedUsd18);
        uint256 lossPerUnit = RiskMath.mulDiv(Types.BPS + liquidationBonusBps, mBps, Types.BPS);

        // At or above 1, seizing collateral removes at least as much capacity as it retires debt,
        // so liquidation cannot close the gap at any size. Deleveraging still reduces absolute
        // exposure, which is why the caller proceeds with a bounded bite.
        if (lossPerUnit >= Types.BPS) return 0;

        return RiskMath.mulDivUp(breach, Types.BPS, Types.BPS - lossPerUnit);
    }
}

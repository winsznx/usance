// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

import {Authority, Authorized} from "./Authority.sol";
import {Types} from "../libraries/Types.sol";

/// @title RiskPolicyRegistry
/// @notice Deterministic risk parameters, and the epoch counter that stamps every decision.
/// @dev Two things live here and they are deliberately coupled:
///
///      1. The parameters. Validated on write (invariants I-13, I-14), so there is no reachable
///         configuration in which the borrow limit exceeds the liquidation limit or the exit
///         curve recovers better at larger size.
///
///      2. The risk epoch. A monotone counter that advances whenever a policy input changes.
///         Quotes cite an epoch and are refused under a different one, which is how a user can
///         never sign a transaction priced under rules that have since changed.
contract RiskPolicyRegistry is Authorized {
    /// @dev Risk-increasing changes wait. Risk-reducing changes do not — the asymmetry is the
    ///      whole safety argument, and it is enforced by comparing the proposed parameters
    ///      against the live ones rather than by trusting the caller to self-classify.
    uint64 public constant TIMELOCK = 2 days;

    struct PendingChange {
        Types.RiskParameters params;
        uint64 eta;
        bool exists;
    }

    mapping(bytes32 policyId => Types.RiskParameters) internal _params;
    mapping(bytes32 policyId => Types.ExitTier[]) internal _curves;
    mapping(bytes32 policyId => bool) public exists;
    mapping(bytes32 policyId => PendingChange) internal _pending;

    uint64 public riskEpoch;

    event RiskEpochActivated(uint64 indexed epoch, bytes32 indexed cause);
    event PolicyCreated(bytes32 indexed policyId);
    event PolicyUpdated(bytes32 indexed policyId, uint64 epoch);
    event PolicyChangeQueued(bytes32 indexed policyId, uint64 eta);
    event ExitCurveSet(bytes32 indexed policyId, uint256 tiers);

    error UnknownPolicy(bytes32 policyId);
    error PolicyExists(bytes32 policyId);
    error LtvOrdering();
    error LtvTooHigh();
    error HaircutTooHigh();
    error CurveNotAscending();
    error CurveRecoveryNotMonotone();
    error CurveEmpty();
    error RecoveryTooHigh();
    error NothingQueued();
    error TimelockNotElapsed(uint64 eta);

    constructor(Authority authority_) Authorized(authority_) {
        // Epoch 1 is genesis. Zero means "never evaluated", which must stay distinguishable.
        riskEpoch = 1;
        emit RiskEpochActivated(1, keccak256("GENESIS"));
    }

    // ---------------------------------------------------------------------------------
    // Validation — invariants I-13 and I-14
    // ---------------------------------------------------------------------------------

    function _validateParams(Types.RiskParameters memory p) internal pure {
        if (!(p.initialLtvBps <= p.maintenanceLtvBps && p.maintenanceLtvBps <= p.liquidationLtvBps)) {
            revert LtvOrdering();
        }
        if (p.liquidationLtvBps >= Types.BPS) revert LtvTooHigh();
        if (p.maxConcentrationBps > Types.BPS) revert LtvTooHigh();

        // Each haircut is a fraction removed, so any single one at or above 100% would zero the
        // asset. That is expressible through asset status, not through a pricing parameter.
        if (
            p.haircutMarketBps >= Types.BPS || p.haircutLiquidityBps >= Types.BPS
                || p.haircutIssuerBps >= Types.BPS || p.haircutSettlementBps >= Types.BPS
                || p.haircutCrosschainBps >= Types.BPS
        ) revert HaircutTooHigh();
    }

    function _validateCurve(Types.ExitTier[] memory curve) internal pure {
        uint256 n = curve.length;
        if (n == 0) revert CurveEmpty();
        for (uint256 i; i < n; ++i) {
            if (curve[i].recoveryBps > Types.BPS) revert RecoveryTooHigh();
            if (i == 0) continue;
            if (curve[i].thresholdUsd18 <= curve[i - 1].thresholdUsd18) revert CurveNotAscending();
            // Selling more cannot recover proportionally more. A curve that says otherwise is a
            // typo, and RiskMath's "past the end, use the last tier" rule depends on this.
            if (curve[i].recoveryBps > curve[i - 1].recoveryBps) revert CurveRecoveryNotMonotone();
        }
    }

    // ---------------------------------------------------------------------------------
    // Mutation
    // ---------------------------------------------------------------------------------

    function createPolicy(bytes32 policyId, Types.RiskParameters calldata p, Types.ExitTier[] calldata curve)
        external
        onlyRole(authority.GOVERNANCE())
    {
        if (exists[policyId]) revert PolicyExists(policyId);
        _validateParams(p);
        _validateCurve(curve);

        _params[policyId] = p;
        _setCurve(policyId, curve);
        exists[policyId] = true;

        emit PolicyCreated(policyId);
        _advanceEpoch(policyId);
    }

    /// @notice Classify a proposed change and route it accordingly.
    /// @dev "Risk-increasing" means any of: a higher LTV at any tier, a smaller haircut, a larger
    ///      concentration allowance, or a longer tolerated staleness. Anything that would let an
    ///      account borrow more than it can today waits out the timelock.
    function _increasesRisk(Types.RiskParameters memory old, Types.RiskParameters memory neu)
        internal
        pure
        returns (bool)
    {
        return neu.initialLtvBps > old.initialLtvBps || neu.maintenanceLtvBps > old.maintenanceLtvBps
            || neu.liquidationLtvBps > old.liquidationLtvBps
            || neu.maxConcentrationBps > old.maxConcentrationBps
            || neu.haircutMarketBps < old.haircutMarketBps
            || neu.haircutLiquidityBps < old.haircutLiquidityBps
            || neu.haircutIssuerBps < old.haircutIssuerBps
            || neu.haircutSettlementBps < old.haircutSettlementBps
            || neu.haircutCrosschainBps < old.haircutCrosschainBps || neu.maxOracleAge > old.maxOracleAge
            || neu.maxPassportAge > old.maxPassportAge;
    }

    function updatePolicy(bytes32 policyId, Types.RiskParameters calldata p)
        external
        onlyRole(authority.GOVERNANCE())
    {
        if (!exists[policyId]) revert UnknownPolicy(policyId);
        _validateParams(p);

        if (_increasesRisk(_params[policyId], p)) {
            _pending[policyId] =
                PendingChange({params: p, eta: uint64(block.timestamp) + TIMELOCK, exists: true});
            emit PolicyChangeQueued(policyId, uint64(block.timestamp) + TIMELOCK);
            return;
        }

        _params[policyId] = p;
        emit PolicyUpdated(policyId, riskEpoch + 1);
        _advanceEpoch(policyId);
    }

    function executeQueuedChange(bytes32 policyId) external {
        PendingChange memory pc = _pending[policyId];
        if (!pc.exists) revert NothingQueued();
        if (block.timestamp < pc.eta) revert TimelockNotElapsed(pc.eta);

        _params[policyId] = pc.params;
        delete _pending[policyId];

        emit PolicyUpdated(policyId, riskEpoch + 1);
        _advanceEpoch(policyId);
    }

    /// @notice Cancel a queued risk increase. Available to guardians because refusing to become
    ///         riskier is always safe.
    function cancelQueuedChange(bytes32 policyId) external {
        if (
            !authority.hasRole(authority.GOVERNANCE(), msg.sender)
                && !authority.hasRole(authority.GUARDIAN(), msg.sender)
        ) revert Unauthorized(authority.GUARDIAN());
        delete _pending[policyId];
    }

    function setExitCurve(bytes32 policyId, Types.ExitTier[] calldata curve)
        external
        onlyRole(authority.GOVERNANCE())
    {
        if (!exists[policyId]) revert UnknownPolicy(policyId);
        _validateCurve(curve);
        _setCurve(policyId, curve);
        _advanceEpoch(policyId);
    }

    /// @notice Advance the epoch because something outside this registry changed the inputs —
    ///         a new Passport, an asset status change, an oracle reconfiguration.
    /// @dev CLEARING is accepted alongside the three governance-shaped roles because ClearingHouse
    ///      changes risk inputs itself — swapping the oracle, widening the settlement freshness
    ///      window — and an epoch that does not move after those changes leaves outstanding quotes
    ///      valid under rules that no longer apply. Without this, `setOracle` and
    ///      `setSettlementMaxPriceAge` revert whenever they are actually called.
    ///
    ///      Widening here is safe in a way that widening most authority is not: the epoch is
    ///      monotone and advancing it only invalidates quotes. There is no argument, no target and
    ///      no amount. The worst an attacker with this power can do is force everyone to re-quote.
    function bumpEpoch(bytes32 cause) external {
        if (
            !authority.hasRole(authority.ADMISSION(), msg.sender)
                && !authority.hasRole(authority.GOVERNANCE(), msg.sender)
                && !authority.hasRole(authority.GUARDIAN(), msg.sender)
                && !authority.hasRole(authority.CLEARING(), msg.sender)
        ) revert Unauthorized(authority.ADMISSION());
        _advanceEpoch(cause);
    }

    function _advanceEpoch(bytes32 cause) internal {
        unchecked {
            riskEpoch += 1;
        }
        emit RiskEpochActivated(riskEpoch, cause);
    }

    function _setCurve(bytes32 policyId, Types.ExitTier[] calldata curve) internal {
        delete _curves[policyId];
        for (uint256 i; i < curve.length; ++i) {
            _curves[policyId].push(curve[i]);
        }
        emit ExitCurveSet(policyId, curve.length);
    }

    // ---------------------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------------------

    function getParams(bytes32 policyId) external view returns (Types.RiskParameters memory) {
        if (!exists[policyId]) revert UnknownPolicy(policyId);
        return _params[policyId];
    }

    function getCurve(bytes32 policyId) external view returns (Types.ExitTier[] memory) {
        if (!exists[policyId]) revert UnknownPolicy(policyId);
        return _curves[policyId];
    }

    function pendingChange(bytes32 policyId) external view returns (PendingChange memory) {
        return _pending[policyId];
    }
}

// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

import {PortfolioRiskEngine} from "./PortfolioRiskEngine.sol";

/// @title PortfolioRiskPolicyRegistry
/// @notice Versioned `PortfolioRiskPolicy` + per-instrument `RiskGroupRef` records for the Base
///         portfolio facility. `spec/portfolio-risk-model.md §6`, `spec/base-portfolio-facility-model.md §11`.
///
/// @dev I-114: any `capBps` / `sessionFactorBps` / stress / `RiskGroupRef` / taxonomy change is a
///      NEW policy version and a NEW portfolio RiskEpoch — never a silent recompute of a historical
///      result. `portfolioRiskEpoch` is monotone. Policy status is `CANARY_PROVISIONAL` /
///      `TESTNET_CALIBRATION`, never `PRODUCTION_VALIDATED` (§10).
contract PortfolioRiskPolicyRegistry {
    enum PolicyStatus {
        DRAFT,
        TESTNET_CALIBRATION,
        CANARY_PROVISIONAL,
        PRODUCTION_VALIDATED
    }

    struct PolicyMeta {
        uint32 version;
        uint32 taxonomyVersion;
        PolicyStatus status;
        uint64 effectiveAt;
        uint64 reviewBy;
        bool exists;
    }

    /// @dev A versioned classification a position carries for one dimension.
    struct RiskGroupRef {
        uint8 dimension; // 0..4
        bytes32 groupId; // bytes32(0) => UNKNOWN group for this dimension
        bytes32 taxonomy;
        uint32 taxonomyVersion;
        bytes32 source;
        uint64 effectiveAt;
        uint64 reviewBy;
    }

    address public immutable governance;

    mapping(bytes32 policyId => PolicyMeta) public meta;
    mapping(bytes32 policyId => PortfolioRiskEngine.Policy) internal _policy;
    /// @dev per (instrumentId) the 5 group refs (index = dimension). `set` bumps the epoch.
    mapping(bytes32 instrumentId => mapping(uint8 dimension => RiskGroupRef)) public groupRef;

    uint64 public portfolioRiskEpoch = 1;

    event PolicyPublished(bytes32 indexed policyId, uint32 version, PolicyStatus status, uint64 epoch);
    event RiskGroupRefSet(
        bytes32 indexed instrumentId, uint8 indexed dimension, bytes32 groupId, uint64 epoch
    );
    event EpochBumped(uint64 epoch, bytes32 reason);

    error NotGovernance();
    error PolicyExists(bytes32 policyId);
    error UnknownPolicy(bytes32 policyId);
    error BadCapOrder(uint8 dimension);
    error BadSessionFactor(uint8 session);
    error BadDimension(uint8 dimension);

    constructor(address governance_) {
        governance = governance_;
    }

    modifier onlyGov() {
        if (msg.sender != governance) revert NotGovernance();
        _;
    }

    /// @notice Publish a new immutable policy version. A policyId is written once; a changed policy
    ///         is a new policyId/version and a new epoch.
    function publishPolicy(
        bytes32 policyId,
        PortfolioRiskEngine.Policy calldata p,
        uint32 taxonomyVersion,
        PolicyStatus status,
        uint64 effectiveAt,
        uint64 reviewBy
    ) external onlyGov {
        if (meta[policyId].exists) revert PolicyExists(policyId);
        for (uint8 d = 0; d < 5; d++) {
            if (p.capBps[d][1] > p.capBps[d][0]) revert BadCapOrder(d);
            if (p.capBps[d][0] > 10_000) revert BadCapOrder(d);
        }
        for (uint8 s = 0; s < 5; s++) {
            if (p.sessionFactorBps[s] > 10_000) revert BadSessionFactor(s);
        }
        _policy[policyId] = p;
        uint32 v = meta[policyId].version + 1;
        meta[policyId] = PolicyMeta({
            version: v,
            taxonomyVersion: taxonomyVersion,
            status: status,
            effectiveAt: effectiveAt,
            reviewBy: reviewBy,
            exists: true
        });
        _bump(bytes32("POLICY_PUBLISHED"));
        emit PolicyPublished(policyId, v, status, portfolioRiskEpoch);
    }

    function policy(bytes32 policyId) external view returns (PortfolioRiskEngine.Policy memory) {
        if (!meta[policyId].exists) revert UnknownPolicy(policyId);
        return _policy[policyId];
    }

    /// @notice Set one dimension's risk-group classification for an instrument. Bumps the epoch.
    function setRiskGroupRef(bytes32 instrumentId, RiskGroupRef calldata ref) external onlyGov {
        if (ref.dimension > 4) revert BadDimension(ref.dimension);
        groupRef[instrumentId][ref.dimension] = ref;
        _bump(bytes32("RISK_GROUP_SET"));
        emit RiskGroupRefSet(instrumentId, ref.dimension, ref.groupId, portfolioRiskEpoch);
    }

    /// @notice The 5 group ids for an instrument, index = dimension. Missing => bytes32(0) (UNKNOWN).
    function groupsOf(bytes32 instrumentId) external view returns (bytes32[5] memory g) {
        for (uint8 d = 0; d < 5; d++) {
            g[d] = groupRef[instrumentId][d].groupId;
        }
    }

    /// @notice Governance can bump the epoch for an off-chain-observed change (taxonomy revision,
    ///         market-calendar update) that does not itself write here.
    function bumpEpoch(bytes32 reason) external onlyGov {
        _bump(reason);
    }

    function _bump(bytes32 reason) internal {
        portfolioRiskEpoch += 1;
        emit EpochBumped(portfolioRiskEpoch, reason);
    }
}

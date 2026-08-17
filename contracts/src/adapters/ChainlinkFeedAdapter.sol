// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

import {Authority, Authorized} from "../core/Authority.sol";
import {IOracleAdapter, IAggregatorV3} from "../interfaces/IOracleAdapter.sol";

/// @title ChainlinkFeedAdapter
/// @notice Prices assets from Chainlink Data Feeds on X Layer.
///
/// @dev Data Streams is not deployed on X Layer — see docs/INTEGRATIONS.md, where that
///      correction is recorded along with the evidence. X Layer publishes 26 push-based Data
///      Feeds plus an L2 Sequencer Uptime Status Feed, and that is what this adapter reads.
///
///      Everything here is defensive on purpose. An oracle adapter is the most attractive
///      surface in a lending protocol, and the failure mode that matters is not "returns a
///      wrong number" but "returns a stale number confidently".
contract ChainlinkFeedAdapter is IOracleAdapter, Authorized {
    struct Feed {
        address aggregator;
        uint8 decimals;
        bool enabled;
    }

    mapping(bytes32 assetId => Feed) public feeds;

    /// @notice Feeds a guardian may not disable.
    /// @dev The settlement asset's feed is load-bearing for the EXIT, not just for entry.
    ///      `ClearingHouse` prices repayments through it, so disabling it removed the user's
    ///      ability to reduce risk — a guardian action that increases user risk, which
    ///      spec/threat-model.md §6 says is not a power guardians have. Governance marks the
    ///      settlement feed protected at deploy time.
    mapping(bytes32 assetId => bool) public protectedFeed;

    /// @notice Chainlink's L2 sequencer uptime feed. `answer == 0` means up.
    address public sequencerUptimeFeed;
    uint64 public sequencerGracePeriod = 3600;

    event FeedSet(bytes32 indexed assetId, address aggregator, uint8 decimals);
    event FeedProtectionSet(bytes32 indexed assetId, bool protected);
    event FeedDisabled(bytes32 indexed assetId);
    event SequencerFeedSet(address feed, uint64 gracePeriod);

    error FeedNotConfigured(bytes32 assetId);
    error FeedIsProtected(bytes32 assetId);
    error BadDecimals(uint8 d);

    constructor(Authority authority_) Authorized(authority_) {}

    function setFeed(bytes32 assetId, address aggregator) external onlyRole(authority.GOVERNANCE()) {
        uint8 d = IAggregatorV3(aggregator).decimals();
        // Everything is normalised to 18. A feed with more than 18 decimals would need a
        // division and therefore a rounding decision, which belongs in the spec, not here.
        if (d > 18) revert BadDecimals(d);
        feeds[assetId] = Feed({aggregator: aggregator, decimals: d, enabled: true});
        emit FeedSet(assetId, aggregator, d);
    }

    /// @notice Mark a feed undisableable by guardians. Governance only.
    function setFeedProtected(bytes32 assetId, bool isProtected) external onlyRole(authority.GOVERNANCE()) {
        protectedFeed[assetId] = isProtected;
        emit FeedProtectionSet(assetId, isProtected);
    }

    /// @notice Disable a feed.
    /// @dev For a collateral asset this only restricts: the price degrades to invalid, new risk
    ///      is blocked, and every exit stays open. For the settlement asset it would do the
    ///      opposite and close the exit, so protected feeds are refused to guardians. Governance
    ///      can still disable one, because replacing a settlement oracle is a legitimate
    ///      migration and governance is timelocked for anything that raises risk.
    function disableFeed(bytes32 assetId) external {
        if (authority.hasRole(authority.GOVERNANCE(), msg.sender)) {
            // permitted
        } else if (authority.hasRole(authority.GUARDIAN(), msg.sender)) {
            if (protectedFeed[assetId]) revert FeedIsProtected(assetId);
        } else {
            revert Unauthorized(authority.GUARDIAN());
        }
        feeds[assetId].enabled = false;
        emit FeedDisabled(assetId);
    }

    function setSequencerFeed(address feed, uint64 gracePeriod) external onlyRole(authority.GOVERNANCE()) {
        sequencerUptimeFeed = feed;
        sequencerGracePeriod = gracePeriod;
        emit SequencerFeedSet(feed, gracePeriod);
    }

    /// @inheritdoc IOracleAdapter
    function getPrice(bytes32 assetId) external view returns (uint256 priceUsd18, uint64 updatedAt) {
        Feed memory f = feeds[assetId];
        if (f.aggregator == address(0)) revert FeedNotConfigured(assetId);
        if (!f.enabled) return (0, 0);

        // A reverting aggregator must degrade to "no price", not brick every account that
        // happens to hold the asset. Returning zero routes into ORACLE_INVALID, which blocks new
        // risk while leaving repayment and collateral top-ups available.
        try IAggregatorV3(f.aggregator).latestRoundData() returns (
            uint80, int256 answer, uint256, uint256 ts, uint80
        ) {
            if (answer <= 0 || ts == 0) return (0, 0);
            priceUsd18 = uint256(answer) * (10 ** (18 - f.decimals));
            updatedAt = uint64(ts);
        } catch {
            return (0, 0);
        }
    }

    /// @inheritdoc IOracleAdapter
    function sequencerStatus() external view returns (bool up, uint64 lastRestartAt, uint64 gracePeriod) {
        gracePeriod = sequencerGracePeriod;

        // No feed configured means we cannot prove the sequencer is healthy. On a chain without
        // an uptime feed that would be a permanent freeze, so the honest default is "up" with the
        // absence recorded in deployments rather than silently pretended away.
        if (sequencerUptimeFeed == address(0)) return (true, 0, gracePeriod);

        try IAggregatorV3(sequencerUptimeFeed).latestRoundData() returns (
            uint80, int256 answer, uint256 startedAt, uint256, uint80
        ) {
            up = (answer == 0);
            lastRestartAt = uint64(startedAt);
        } catch {
            // Cannot read the uptime feed: assume the worst.
            return (false, uint64(block.timestamp), gracePeriod);
        }
    }
}

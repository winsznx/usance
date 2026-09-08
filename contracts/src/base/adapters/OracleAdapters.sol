// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

import {IBaseOracleAdapter, IMarketSession} from "../interfaces/IBaseFacility.sol";

/// @dev Chainlink V3 aggregator proxy surface. Base Coinbase tokenized-equity feeds are push feeds:
///      8 decimals, USD, `us_equities_24/5`, 0.5% deviation / 24h heartbeat during market hours,
///      frozen off-hours and during corporate actions (`updatedAt` stops advancing).
interface IAggregatorV3 {
    function decimals() external view returns (uint8);
    function description() external view returns (string memory);
    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
}

/// @title ChainlinkTotalReturnOracleAdapter
/// @notice `IBaseOracleAdapter` over a Chainlink Total-Return Data Feed for a Coinbase B20 stock.
///         `spec/base-portfolio-facility-model.md §8`. The feed answer is `underlying × multiplier`
///         (`FACTOR_IN_PRICE`), so the risk pipeline multiplies the RAW quantity by this price only.
///
/// @dev Freshness is **session-aware**: during `OPEN` the bound is tight (2× heartbeat headroom);
///      when the underlying market is `CLOSED` the feed legitimately holds the last close, so
///      `live` is false (a held price cannot back NEW risk) but the facility still reads the value
///      for a repay-side / display computation. `spec/base-portfolio-facility-model.md §13`.
contract ChainlinkTotalReturnOracleAdapter is IBaseOracleAdapter {
    address public immutable governance;
    IMarketSession public immutable session;

    struct FeedCfg {
        IAggregatorV3 feed;
        uint8 feedDecimals;
        uint32 openBoundSeconds; // freshness bound while the underlying session is OPEN / PRE / POST
        bool registered;
    }

    mapping(bytes32 instrumentId => FeedCfg) public feedOf;

    event FeedRegistered(bytes32 indexed instrumentId, address feed, uint8 decimals, uint32 openBound);

    error NotGovernance();
    error FeedNotRegistered(bytes32 instrumentId);
    error FeedAlreadyRegistered(bytes32 instrumentId);
    error NonPositiveAnswer();

    constructor(address governance_, address session_) {
        governance = governance_;
        session = IMarketSession(session_);
    }

    function registerFeed(bytes32 instrumentId, address feed, uint32 openBoundSeconds) external {
        if (msg.sender != governance) revert NotGovernance();
        if (feedOf[instrumentId].registered) revert FeedAlreadyRegistered(instrumentId);
        uint8 d = IAggregatorV3(feed).decimals();
        feedOf[instrumentId] =
            FeedCfg({feed: IAggregatorV3(feed), feedDecimals: d, openBoundSeconds: openBoundSeconds, registered: true});
        emit FeedRegistered(instrumentId, feed, d, openBoundSeconds);
    }

    function priceUsd18(bytes32 instrumentId) external view returns (uint256 price, uint64 updatedAt, bool live) {
        FeedCfg memory c = feedOf[instrumentId];
        if (!c.registered) revert FeedNotRegistered(instrumentId);
        (, int256 answer,, uint256 rawUpdatedAt,) = c.feed.latestRoundData();
        if (answer <= 0) revert NonPositiveAnswer();

        price = c.feedDecimals <= 18
            ? uint256(answer) * (10 ** (18 - c.feedDecimals))
            : uint256(answer) / (10 ** (c.feedDecimals - 18));
        updatedAt = uint64(rawUpdatedAt);

        uint8 sess = session.sessionOf(instrumentId, uint64(block.timestamp));
        // OPEN(0) / PRE_MARKET(1) / POST_MARKET(2): the feed should be advancing — enforce the bound.
        // CLOSED(3) / UNKNOWN(4): a held-last-close value is expected and must not back new risk.
        if (sess <= 2) {
            live = block.timestamp <= rawUpdatedAt + c.openBoundSeconds;
        } else {
            live = false;
        }
    }

    function isTestOnly() external pure returns (bool) {
        return false;
    }
}

/// @title TestOnlyOracleAdapter
/// @notice `TEST_ONLY` price source for the Base Sepolia `SYNTHETIC_TEST_B20` instruments — there
///         are no Chainlink tokenized-equity feeds on Base Sepolia (`§16`). Governance sets a price
///         and `updatedAt`; the same session-aware staleness discipline applies. **Never a mainnet
///         canary route.**
contract TestOnlyOracleAdapter is IBaseOracleAdapter {
    address public immutable governance;
    IMarketSession public immutable session;
    uint32 public immutable openBoundSeconds;

    struct Px {
        uint256 priceUsd18;
        uint64 updatedAt;
        bool set;
    }

    mapping(bytes32 instrumentId => Px) public px;

    event PriceSet(bytes32 indexed instrumentId, uint256 priceUsd18, uint64 updatedAt);

    error NotGovernance();
    error PriceNotSet(bytes32 instrumentId);

    constructor(address governance_, address session_, uint32 openBoundSeconds_) {
        governance = governance_;
        session = IMarketSession(session_);
        openBoundSeconds = openBoundSeconds_;
    }

    function setPrice(bytes32 instrumentId, uint256 priceUsd18_, uint64 updatedAt_) external {
        if (msg.sender != governance) revert NotGovernance();
        px[instrumentId] = Px({priceUsd18: priceUsd18_, updatedAt: updatedAt_, set: true});
        emit PriceSet(instrumentId, priceUsd18_, updatedAt_);
    }

    function priceUsd18(bytes32 instrumentId) external view returns (uint256 price, uint64 updatedAt, bool live) {
        Px memory p = px[instrumentId];
        if (!p.set) revert PriceNotSet(instrumentId);
        price = p.priceUsd18;
        updatedAt = p.updatedAt;
        uint8 sess = session.sessionOf(instrumentId, uint64(block.timestamp));
        live = sess <= 2 && block.timestamp <= uint256(p.updatedAt) + openBoundSeconds;
    }

    function isTestOnly() external pure returns (bool) {
        return true;
    }
}

/// @title UsEquitySessionOracle
/// @notice `IMarketSession` from a governance-configured US-equity weekly calendar + holiday set.
///         `spec/base-portfolio-facility-model.md §13`. A 24/7 on-chain pool does not make a closed
///         underlying market open. Degradation never raises capacity (I-113) — enforced by the
///         engine's `sessionFactorBps` being `<= BPS` and monotone in the policy.
contract UsEquitySessionOracle is IMarketSession {
    address public immutable governance;

    // minutes-from-midnight UTC windows for a normal trading day (default: US regular 13:30–20:00 UTC)
    uint16 public preOpenUtcMin = 8 * 60; // 08:00 UTC
    uint16 public openUtcMin = 13 * 60 + 30; // 13:30 UTC
    uint16 public closeUtcMin = 20 * 60; // 20:00 UTC
    uint16 public postCloseUtcMin = 24 * 60; // 24:00 UTC (overnight session extends to next pre-open on 24/5 feeds)

    mapping(uint64 dayIndex => bool) public holiday; // dayIndex = block.timestamp / 1 days
    bool public forcedUnknown; // guardian kill: classify everything UNKNOWN (most restrictive with UNKNOWN cap)

    event WindowsSet(uint16 preOpen, uint16 open, uint16 close, uint16 postClose);
    event HolidaySet(uint64 dayIndex, bool isHoliday);
    event ForcedUnknownSet(bool on);

    error NotGovernance();

    constructor(address governance_) {
        governance = governance_;
    }

    modifier onlyGov() {
        if (msg.sender != governance) revert NotGovernance();
        _;
    }

    function setWindows(uint16 preOpen, uint16 open, uint16 close, uint16 postClose) external onlyGov {
        preOpenUtcMin = preOpen;
        openUtcMin = open;
        closeUtcMin = close;
        postCloseUtcMin = postClose;
        emit WindowsSet(preOpen, open, close, postClose);
    }

    function setHoliday(uint64 dayIndex, bool isHoliday) external onlyGov {
        holiday[dayIndex] = isHoliday;
        emit HolidaySet(dayIndex, isHoliday);
    }

    function setForcedUnknown(bool on) external onlyGov {
        forcedUnknown = on;
        emit ForcedUnknownSet(on);
    }

    /// @return session 0 OPEN, 1 PRE_MARKET, 2 POST_MARKET, 3 CLOSED, 4 UNKNOWN
    function sessionOf(bytes32, uint64 atTime) external view returns (uint8 session) {
        if (forcedUnknown) return 4;
        uint64 dayIndex = atTime / 1 days;
        // 1970-01-01 was a Thursday → dow: 0=Mon … 6=Sun
        uint256 dow = (uint256(dayIndex) + 3) % 7;
        if (dow >= 5) return 3; // weekend → CLOSED
        if (holiday[dayIndex]) return 3;
        uint256 minOfDay = (uint256(atTime) % 1 days) / 60;
        if (minOfDay >= openUtcMin && minOfDay < closeUtcMin) return 0; // OPEN
        if (minOfDay >= preOpenUtcMin && minOfDay < openUtcMin) return 1; // PRE_MARKET
        if (minOfDay >= closeUtcMin && minOfDay < postCloseUtcMin) return 2; // POST_MARKET
        return 3; // CLOSED (deep overnight)
    }
}

/// @title StaticLiquidityObserver
/// @notice A minimal `ILiquidityObserver` — governance records a measured observation per
///         instrument (venue, pool, depth, size-aware exit) taken off-chain against a real Base
///         venue. NOT a trading simulator (`§12`). An instrument with no positive `depthUsd18`
///         carries `liquidityGroupId == bytes32(0)` and is not liquidity-capped — and is not
///         admissible for the mainnet canary until a real observation exists (`portfolio-risk-model.md §3`).
contract StaticLiquidityObserver {
    address public immutable governance;

    struct Obs {
        bytes32 liquidityGroupId;
        uint256 depthUsd18;
        uint256 refNotionalUsd18;
        uint256 refExitUsd18; // proceeds estimate for refNotionalUsd18
        uint64 observedBlock;
        uint64 observedAt;
        bytes32 venue;
        bool set;
    }

    mapping(bytes32 instrumentId => Obs) public obs;

    event ObservationSet(
        bytes32 indexed instrumentId, bytes32 venue, bytes32 group, uint256 depthUsd18, uint256 refExitUsd18
    );

    error NotGovernance();

    constructor(address governance_) {
        governance = governance_;
    }

    function setObservation(bytes32 instrumentId, Obs calldata o) external {
        if (msg.sender != governance) revert NotGovernance();
        obs[instrumentId] = o;
        emit ObservationSet(instrumentId, o.venue, o.liquidityGroupId, o.depthUsd18, o.refExitUsd18);
    }

    /// @return group the declared route (bytes32(0) => not liquidity-capped)
    /// @return depthUsd18 usable depth; 0 => LIQUIDITY dimension is a no-op for this position
    /// @return sizeAwareExitUsd18 proceeds estimate for `notionalUsd18`, linearly scaled from the
    ///         recorded reference point, capped at `notionalUsd18`
    function observe(bytes32 instrumentId, uint256 notionalUsd18)
        external
        view
        returns (bytes32 group, uint256 depthUsd18, uint256 sizeAwareExitUsd18)
    {
        Obs memory o = obs[instrumentId];
        if (!o.set || o.depthUsd18 == 0) return (bytes32(0), 0, notionalUsd18);
        group = o.liquidityGroupId;
        depthUsd18 = o.depthUsd18;
        if (o.refNotionalUsd18 == 0) {
            sizeAwareExitUsd18 = notionalUsd18 > o.depthUsd18 ? o.refExitUsd18 : notionalUsd18;
        } else {
            uint256 est = (notionalUsd18 * o.refExitUsd18) / o.refNotionalUsd18;
            sizeAwareExitUsd18 = est > notionalUsd18 ? notionalUsd18 : est;
        }
    }
}

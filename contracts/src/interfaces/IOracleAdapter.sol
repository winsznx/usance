// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

/// @notice The only shape the risk pipeline knows about a price source.
/// @dev Adapters translate. They never decide. An adapter returns what it observed and how
///      fresh it is; whether that is good enough to lend against is a policy question answered
///      by RiskMath against the asset's `maxOracleAge`.
interface IOracleAdapter {
    /// @return priceUsd18 price scaled to 18 decimals, or 0 if the source produced no valid price
    /// @return updatedAt  timestamp of the observation
    function getPrice(bytes32 assetId) external view returns (uint256 priceUsd18, uint64 updatedAt);

    /// @notice Whether the settlement layer itself is currently trustworthy.
    /// @dev On an L2 this is the sequencer uptime feed. A price nobody can arbitrage against is
    ///      not a price you may lend against, however recent its timestamp.
    function sequencerStatus() external view returns (bool up, uint64 lastRestartAt, uint64 gracePeriod);
}

/// @notice Minimal Chainlink aggregator surface.
interface IAggregatorV3 {
    function decimals() external view returns (uint8);
    function description() external view returns (string memory);
    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
}

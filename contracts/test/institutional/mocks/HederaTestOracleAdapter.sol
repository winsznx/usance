// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

/// @notice TEST price oracle for the ETHOnline Hedera lifecycle. NOT PRODUCTION.
///
/// @dev Hedera testnet has no Chainlink feed for the demo ATS securities, and Phase 07 §24
///      forbids faking one. This is the "deliberately documented test valuation adapter" that
///      section permits: governance sets a fixed USD-18 price per assetId, and the sequencer is
///      always reported trustworthy (Hedera has no L2 sequencer). Every proof that depends on a
///      price from here is marked accordingly — the ATS custody, the authority path and the CRE
///      policy are all real; only the mark price is a test input.
contract HederaTestOracleAdapter {
    address public immutable governance;
    mapping(bytes32 assetId => uint256) public priceUsd18;
    mapping(bytes32 assetId => uint64) public updatedAt;

    event PriceSet(bytes32 indexed assetId, uint256 priceUsd18, uint64 updatedAt);

    error NotGovernance();

    constructor(address governance_) {
        governance = governance_;
    }

    function setPrice(bytes32 assetId, uint256 priceUsd18_) external {
        if (msg.sender != governance) revert NotGovernance();
        priceUsd18[assetId] = priceUsd18_;
        updatedAt[assetId] = uint64(block.timestamp);
        emit PriceSet(assetId, priceUsd18_, uint64(block.timestamp));
    }

    function getPrice(bytes32 assetId) external view returns (uint256, uint64) {
        return (priceUsd18[assetId], updatedAt[assetId]);
    }

    function sequencerStatus() external pure returns (bool up, uint64 lastRestartAt, uint64 gracePeriod) {
        return (true, 0, 0);
    }
}

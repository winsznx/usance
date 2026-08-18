// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IAggregatorV3} from "../interfaces/IOracleAdapter.sol";

/// @title Testnet fixtures
///
/// @notice Contracts that exist ONLY so X Layer testnet can exercise the real protocol.
///
/// @dev X Layer testnet has no Chainlink Data Feeds and no settlement stablecoin. Mainnet has 26
///      feeds (see docs/INTEGRATIONS.md); testnet has none, so a deployment there needs stand-ins
///      or it cannot price anything and no financial path can be demonstrated at all.
///
///      Every contract in this file names itself as a test asset in its own `name()` and `symbol()`
///      so the label travels with the token into any wallet, explorer or block scanner that reads
///      it. A test token that looks like USDC in a wallet is a test token somebody will eventually
///      mistake for USDC.
///
///      `Deploy.s.sol` refuses to deploy these on mainnet. There is no configuration in which they
///      reach chain 196.

/// @notice A settlement stand-in. Freely mintable, worth nothing.
contract TestnetUSD is ERC20 {
    uint8 internal immutable _dec;

    constructor(uint8 decimals_) ERC20("USANCE TESTNET USD - NO REAL VALUE", "tUSD") {
        _dec = decimals_;
    }

    function decimals() public view override returns (uint8) {
        return _dec;
    }

    /// @notice Open mint. This is a faucet, not a token — anyone testing needs some.
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/// @notice A collateral stand-in representing a tokenized T-bill.
contract TestnetTreasuryToken is ERC20 {
    constructor() ERC20("USANCE TESTNET TOKENIZED T-BILL - NO REAL VALUE", "tUSTB") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/// @notice A Chainlink-compatible aggregator whose answer is set rather than reported.
///
/// @dev Deliberately writable by anyone on testnet. Restricting it would mean shipping an owner
///      key nobody has, and a price feed nobody can move is a price feed that cannot demonstrate
///      staleness, deterioration or recovery — which are exactly the behaviours worth showing.
///
///      `latestRoundData` returns the same shape as a real aggregator, so `ChainlinkFeedAdapter`
///      runs unmodified against it. Nothing in the adapter knows this contract exists.
contract TestnetAggregator is IAggregatorV3 {
    uint8 internal immutable _decimals;
    string internal _description;

    int256 public answer;
    uint256 public updatedAt;
    uint256 public startedAt;
    uint80 public roundId;

    event AnswerSet(int256 answer, uint256 updatedAt);

    constructor(uint8 decimals_, string memory description_, int256 initialAnswer) {
        _decimals = decimals_;
        _description = description_;
        answer = initialAnswer;
        updatedAt = block.timestamp;
        startedAt = block.timestamp;
        roundId = 1;
    }

    function decimals() external view returns (uint8) {
        return _decimals;
    }

    function description() external view returns (string memory) {
        return _description;
    }

    /// @notice Set the answer and stamp it now.
    function setAnswer(int256 a) external {
        answer = a;
        updatedAt = block.timestamp;
        roundId += 1;
        emit AnswerSet(a, block.timestamp);
    }

    /// @notice Set the answer with an explicit timestamp, so staleness can be demonstrated.
    function setAnswerAt(int256 a, uint256 ts) external {
        answer = a;
        updatedAt = ts;
        roundId += 1;
        emit AnswerSet(a, ts);
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return (roundId, answer, startedAt, updatedAt, roundId);
    }
}

/// @notice An L2 sequencer uptime stand-in. `answer == 0` means up, matching Chainlink.
contract TestnetSequencerUptimeFeed is IAggregatorV3 {
    int256 public answer; // 0 = up, 1 = down
    uint256 public startedAt;

    event SequencerStatusSet(int256 answer, uint256 startedAt);

    constructor() {
        answer = 0;
        // Backdated well past any grace period so a fresh deployment is immediately usable rather
        // than spending its first hour reporting SEQUENCER_GRACE.
        startedAt = block.timestamp - 7 days;
    }

    function decimals() external pure returns (uint8) {
        return 0;
    }

    function description() external pure returns (string memory) {
        return "USANCE TESTNET Sequencer Uptime - NOT CHAINLINK";
    }

    function setStatus(int256 a) external {
        answer = a;
        startedAt = block.timestamp;
        emit SequencerStatusSet(a, block.timestamp);
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return (1, answer, startedAt, block.timestamp, 1);
    }
}

// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IAggregatorV3} from "../../src/interfaces/IOracleAdapter.sol";

contract MockERC20 is ERC20 {
    uint8 internal immutable _dec;

    constructor(string memory n, string memory s, uint8 d) ERC20(n, s) {
        _dec = d;
    }

    function decimals() public view override returns (uint8) {
        return _dec;
    }

    function mint(address to, uint256 amt) external {
        _mint(to, amt);
    }
}

/// @notice A token that takes a cut on transfer. Accounting must survive it (invariant I-33).
contract FeeOnTransferERC20 is ERC20 {
    uint16 public feeBps;

    constructor(uint16 feeBps_) ERC20("FeeToken", "FEE") {
        feeBps = feeBps_;
    }

    function mint(address to, uint256 amt) external {
        _mint(to, amt);
    }

    function _update(address from, address to, uint256 value) internal override {
        if (from == address(0) || to == address(0) || feeBps == 0) {
            super._update(from, to, value);
            return;
        }
        uint256 fee = (value * feeBps) / 10_000;
        super._update(from, address(0xdead), fee);
        super._update(from, to, value - fee);
    }
}

/// @notice Calls back into the vault mid-transfer. Must fail safely (invariant I-32).
contract ReentrantERC20 is ERC20 {
    address public target;
    bytes public payload;
    bool internal _armed;

    constructor() ERC20("Reentrant", "RE") {}

    function mint(address to, uint256 amt) external {
        _mint(to, amt);
    }

    function arm(address target_, bytes calldata payload_) external {
        target = target_;
        payload = payload_;
        _armed = true;
    }

    function _update(address from, address to, uint256 value) internal override {
        if (_armed && target != address(0)) {
            _armed = false; // one shot, so a failed reentry does not loop forever
            (bool ok,) = target.call(payload);
            ok; // outcome is asserted by the test, not here
        }
        super._update(from, to, value);
    }
}

/// @notice Chainlink aggregator stand-in with controllable answer and timestamp.
contract MockAggregator is IAggregatorV3 {
    uint8 public immutable _decimals;
    string internal _description;
    int256 public answer;
    uint256 public updatedAt;
    uint256 public startedAt;
    bool public shouldRevert;

    constructor(uint8 d, string memory desc, int256 initialAnswer, uint256 ts) {
        _decimals = d;
        _description = desc;
        answer = initialAnswer;
        updatedAt = ts;
        startedAt = ts;
    }

    function decimals() external view returns (uint8) {
        return _decimals;
    }

    function description() external view returns (string memory) {
        return _description;
    }

    function set(int256 a, uint256 ts) external {
        answer = a;
        updatedAt = ts;
    }

    function setStartedAt(uint256 ts) external {
        startedAt = ts;
    }

    function setShouldRevert(bool v) external {
        shouldRevert = v;
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        require(!shouldRevert, "aggregator down");
        return (1, answer, startedAt, updatedAt, 1);
    }
}

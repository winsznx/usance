// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

import {IXStocksCorporateActionReporter} from "../base/XStocksInstrumentAdapter.sol";

/// @notice Explicitly synthetic xStocks-shaped test token. Never an issuer asset.
contract SyntheticTestXStock {
    string public constant name = "USANCE SYNTHETIC TEST NVDAx";
    string public constant symbol = "SYNTHETIC_TEST_NVDAx";
    uint8 public constant decimals = 18;
    uint256 public multiplierWad = 1e18;
    mapping(address => uint256) public sharesOf;
    mapping(address => mapping(address => uint256)) public allowance;
    event Transfer(address indexed from, address indexed to, uint256 amount);

    function balanceOf(address a) public view returns (uint256) {
        return sharesOf[a] * multiplierWad / 1e18;
    }

    function getCurrentMultiplier() external view returns (uint256) {
        return multiplierWad;
    }

    function approve(address s, uint256 a) external returns (bool) {
        allowance[msg.sender][s] = a;
        return true;
    }

    function transfer(address to, uint256 a) external returns (bool) {
        _move(msg.sender, to, a);
        return true;
    }

    function transferFrom(address f, address t, uint256 a) external returns (bool) {
        uint256 x = allowance[f][msg.sender];
        require(x >= a, "allowance");
        allowance[f][msg.sender] = x - a;
        _move(f, t, a);
        return true;
    }

    function mintShares(address to, uint256 s) external {
        sharesOf[to] += s;
        emit Transfer(address(0), to, s * multiplierWad / 1e18);
    }

    function setMultiplier(uint256 m) external {
        require(m != 0, "zero multiplier");
        multiplierWad = m;
    }

    function _move(address f, address t, uint256 a) private {
        uint256 s = (a * 1e18 + multiplierWad - 1) / multiplierWad;
        require(sharesOf[f] >= s, "balance");
        sharesOf[f] -= s;
        sharesOf[t] += s;
        emit Transfer(f, t, a);
    }
}

/// @notice Testnet-only corporate-action state; production requires an issuer-bound reporter.
contract SyntheticXStocksReporter is IXStocksCorporateActionReporter {
    uint256 public current;
    uint256 public pending;
    uint64 public activation;
    bool public fresh = true;
    bool public transferable = true;

    function set(uint256 c, uint256 p, uint64 a, bool f, bool t) external {
        current = c;
        pending = p;
        activation = a;
        fresh = f;
        transferable = t;
    }

    function state(bytes32) external view returns (uint256, uint256, uint64, uint64, uint64, bool, bool) {
        return
            (current, pending, activation, uint64(block.number), uint64(block.timestamp), fresh, transferable);
    }
}

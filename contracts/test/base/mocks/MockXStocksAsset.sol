// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

/// @notice Test double for the xStocks EVM accounting surface. It intentionally keeps ownership
/// in stable shares while presenting an adjusted ERC-20 balance through the multiplier.
contract MockXStocksAsset {
    string public name;
    string public symbol;
    uint8 public immutable decimals;
    uint256 public multiplierWad = 1e18;

    mapping(address account => uint256) private _shares;
    mapping(address owner => mapping(address spender => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 amount);
    event Approval(address indexed owner, address indexed spender, uint256 amount);

    error InsufficientBalance();
    error InsufficientAllowance();
    error InvalidMultiplier();

    constructor(string memory name_, string memory symbol_, uint8 decimals_) {
        name = name_;
        symbol = symbol_;
        decimals = decimals_;
    }

    function balanceOf(address account) public view returns (uint256) {
        return (_shares[account] * multiplierWad) / 1e18;
    }

    function sharesOf(address account) external view returns (uint256) {
        return _shares[account];
    }

    function getCurrentMultiplier() external view returns (uint256) {
        return multiplierWad;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 permitted = allowance[from][msg.sender];
        if (permitted != type(uint256).max) {
            if (permitted < amount) revert InsufficientAllowance();
            allowance[from][msg.sender] = permitted - amount;
        }
        _transfer(from, to, amount);
        return true;
    }

    function mintShares(address to, uint256 shares) external {
        _shares[to] += shares;
        emit Transfer(address(0), to, (shares * multiplierWad) / 1e18);
    }

    function setMultiplier(uint256 multiplierWad_) external {
        if (multiplierWad_ == 0) revert InvalidMultiplier();
        multiplierWad = multiplierWad_;
    }

    function _transfer(address from, address to, uint256 amount) private {
        // xStocks' real conversion must be taken from the issuer contract. The test double rounds
        // upward so a requested displayed amount can never silently under-transfer stable shares.
        uint256 shares = (amount * 1e18 + multiplierWad - 1) / multiplierWad;
        if (_shares[from] < shares) revert InsufficientBalance();
        _shares[from] -= shares;
        _shares[to] += shares;
        emit Transfer(from, to, amount);
    }
}

// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title MockB20Asset
/// @notice A deterministic double for a Base B20 ASSET-variant token, modelled on base-std v1.0.0
///         `IB20Asset` / `IB20` (Beryl). **Clearly non-production.** Raw balances are corporate-
///         action-stable — a `multiplier()` change never rewrites `balanceOf`.
///
///         `cobaltScheduled` toggles the Cobalt ERC-8056 pending-multiplier surface so the adapter's
///         forward-compat probe can be exercised both ways.
contract MockB20Asset is ERC20 {
    uint8 private immutable _decimals;
    uint256 public multiplier = 1e18; // WAD
    mapping(uint8 => bool) private _paused; // 0 TRANSFER, 1 MINT, 2 BURN
    mapping(string => string) private _extra;

    // Cobalt ERC-8056 (off by default — Beryl: the selectors revert, like a real Beryl token)
    bool public cobaltScheduled;
    uint256 private _newUIMultiplier;
    uint256 private _effectiveAt;

    error NotCobalt();

    function newUIMultiplier() external view returns (uint256) {
        if (!cobaltScheduled) revert NotCobalt();
        return _newUIMultiplier;
    }

    function effectiveAt() external view returns (uint256) {
        if (!cobaltScheduled) revert NotCobalt();
        return _effectiveAt;
    }

    constructor(string memory n, string memory s, uint8 d) ERC20(n, s) {
        _decimals = d;
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    function WAD_PRECISION() external pure returns (uint256) {
        return 1e18;
    }

    function mint(address to, uint256 rawAmount) external {
        _mint(to, rawAmount);
    }

    // ---- IB20Asset multiplier surface (Beryl: instant only) ----
    function updateMultiplier(uint256 newMultiplier) external {
        require(newMultiplier != 0, "InvalidMultiplier");
        multiplier = newMultiplier;
        // instant path clears any pending schedule
        cobaltScheduled = false;
        _newUIMultiplier = 0;
        _effectiveAt = 0;
    }

    function scaledBalanceOf(address a) external view returns (uint256) {
        return (balanceOf(a) * multiplier) / 1e18;
    }

    function toScaledBalance(uint256 raw) external view returns (uint256) {
        return (raw * multiplier) / 1e18;
    }

    function toRawBalance(uint256 scaled) external view returns (uint256) {
        return (scaled * 1e18) / multiplier;
    }

    // ---- IB20 pause ----
    function setPaused(uint8 feature, bool on) external {
        _paused[feature] = on;
    }

    function isPaused(uint8 feature) external view returns (bool) {
        return _paused[feature];
    }

    // ---- extra metadata (ISIN / CUSIP live here) ----
    function setExtraMetadata(string calldata k, string calldata v) external {
        _extra[k] = v;
    }

    function extraMetadata(string calldata k) external view returns (string memory) {
        return _extra[k];
    }

    // ---- Cobalt ERC-8056 scheduled surface (toggle for the adapter probe) ----
    function enableCobalt(uint256 pending, uint256 activationAt) external {
        cobaltScheduled = true;
        _newUIMultiplier = pending;
        _effectiveAt = activationAt;
    }

    function _guardedTransfer() internal view {
        require(!_paused[0], "ContractPaused(TRANSFER)");
    }

    function transfer(address to, uint256 amount) public override returns (bool) {
        _guardedTransfer();
        return super.transfer(to, amount);
    }

    function transferFrom(address from, address to, uint256 amount) public override returns (bool) {
        _guardedTransfer();
        return super.transferFrom(from, to, amount);
    }
}

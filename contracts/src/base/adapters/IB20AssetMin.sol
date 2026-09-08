// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @dev The minimal read surface of a Base B20 ASSET-variant token, taken verbatim from
///      `github.com/base/base-std` v1.0.0 `IB20Asset` / `IB20` (Beryl). The scheduled-multiplier
///      (ERC-8056: `uiMultiplier`/`newUIMultiplier`/`effectiveAt`) methods are a **Cobalt** addition
///      and are probed by low-level staticcall, not declared here (see `BaseB20InstrumentAdapter`).
interface IB20AssetMin {
    // ERC-20 superset
    function name() external view returns (string memory);
    function symbol() external view returns (string memory);
    function decimals() external view returns (uint8);
    function balanceOf(address account) external view returns (uint256); // RAW units, corporate-action-stable

    // IB20Asset
    function multiplier() external view returns (uint256); // WAD (1e18 = neutral)
    function WAD_PRECISION() external view returns (uint256); // 1e18
    function scaledBalanceOf(address account) external view returns (uint256); // raw * multiplier / WAD
    function extraMetadata(string calldata key) external view returns (string memory);

    // IB20 pause — 0 TRANSFER, 1 MINT, 2 BURN (Beryl PausableFeature)
    function isPaused(uint8 feature) external view returns (bool);
}

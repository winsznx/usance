// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {Authority} from "../src/core/Authority.sol";
import {SentinelTemplateRegistry} from "../src/core/SentinelTemplateRegistry.sol";
import {SentinelInstanceRegistry} from "../src/core/SentinelInstanceRegistry.sol";

/// @notice Additive deployment of the two Sentinel registries against an already-deployed Authority.
///         Touches no core contract and requires no core redeploy (D-020): the registries hold no
///         role and only read the Authority for their own status/pause permission checks.
///
/// Usage:
///   SENTINEL_AUTHORITY=0x... forge script script/DeploySentinels.s.sol:DeploySentinels \
///     --rpc-url "$XLAYER_TESTNET_RPC_URL" --broadcast --private-key "$DEPLOYER_PRIVATE_KEY"
contract DeploySentinels is Script {
    function run() external {
        address authority = vm.envAddress("SENTINEL_AUTHORITY");

        vm.startBroadcast();
        SentinelTemplateRegistry templates = new SentinelTemplateRegistry(Authority(authority));
        SentinelInstanceRegistry instances = new SentinelInstanceRegistry(Authority(authority), templates);
        vm.stopBroadcast();

        console2.log("SENTINEL_TEMPLATE_REGISTRY", address(templates));
        console2.log("SENTINEL_INSTANCE_REGISTRY", address(instances));
    }
}

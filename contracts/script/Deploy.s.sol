// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";

import {Authority} from "../src/core/Authority.sol";
import {AssetRegistry} from "../src/core/AssetRegistry.sol";
import {EvidenceRegistry} from "../src/core/EvidenceRegistry.sol";
import {PassportRegistry} from "../src/core/PassportRegistry.sol";
import {RiskPolicyRegistry} from "../src/core/RiskPolicyRegistry.sol";
import {CollateralVault} from "../src/core/CollateralVault.sol";
import {LiquidityVault} from "../src/core/LiquidityVault.sol";
import {FinancingEngine} from "../src/core/FinancingEngine.sol";
import {ClearingHouse} from "../src/core/ClearingHouse.sol";
import {ChainlinkFeedAdapter} from "../src/adapters/ChainlinkFeedAdapter.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Types} from "../src/libraries/Types.sol";

/// @notice Deploy the Usance core to X Layer.
///
/// @dev Reads everything environment-specific from the environment. There is no developer path
///      hardcoded anywhere in this file, and no chain id is assumed — `block.chainid` decides,
///      and the script refuses to run anywhere that is not X Layer.
///
///        XLAYER_RPC_URL / XLAYER_TESTNET_RPC_URL   network
///        DEPLOYER_PRIVATE_KEY                      broadcasting key
///        USANCE_GOVERNANCE                         governance multisig (defaults to deployer)
///        USANCE_GUARDIAN                           risk guardian    (defaults to deployer)
///        USANCE_SETTLEMENT_TOKEN                   settlement ERC-20 (e.g. USDC)
///        USANCE_SETTLEMENT_FEED                    Chainlink aggregator for it
///        USANCE_SEQUENCER_FEED                     L2 uptime feed (optional)
contract Deploy is Script {
    uint256 internal constant X_LAYER_MAINNET = 196;
    uint256 internal constant X_LAYER_TESTNET = 1952;

    error WrongChain(uint256 chainId);
    error MissingConfig(string name);

    /// @dev Grouped so `run()` stays under the stack ceiling. A deploy script that only compiles
    ///      with via_ir is a deploy script that behaves differently from the tested build.
    struct Core {
        Authority authority;
        AssetRegistry assetRegistry;
        EvidenceRegistry evidenceRegistry;
        PassportRegistry passportRegistry;
        RiskPolicyRegistry policyRegistry;
        ChainlinkFeedAdapter oracle;
        CollateralVault collateralVault;
        LiquidityVault liquidityVault;
        FinancingEngine financing;
        ClearingHouse clearing;
    }

    function run() external {
        if (block.chainid != X_LAYER_MAINNET && block.chainid != X_LAYER_TESTNET) {
            revert WrongChain(block.chainid);
        }

        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address settlementToken = vm.envAddress("USANCE_SETTLEMENT_TOKEN");
        address settlementFeed = vm.envAddress("USANCE_SETTLEMENT_FEED");
        if (settlementToken == address(0)) revert MissingConfig("USANCE_SETTLEMENT_TOKEN");
        if (settlementFeed == address(0)) revert MissingConfig("USANCE_SETTLEMENT_FEED");

        vm.startBroadcast(pk);
        Core memory c = _deployCore(vm.addr(pk), settlementToken);
        _wire(c);
        _configureSettlement(c, settlementToken, settlementFeed);
        _handOverAuthority(c, vm.addr(pk));
        vm.stopBroadcast();

        _report(c);
    }

    function _deployCore(address deployer, address settlementToken) internal returns (Core memory c) {
        c.authority = new Authority(deployer);
        c.assetRegistry = new AssetRegistry(c.authority);
        c.evidenceRegistry = new EvidenceRegistry(c.authority);
        c.passportRegistry = new PassportRegistry(c.authority);
        c.policyRegistry = new RiskPolicyRegistry(c.authority);
        c.oracle = new ChainlinkFeedAdapter(c.authority);
        c.collateralVault = new CollateralVault(c.authority, c.assetRegistry);
        c.liquidityVault =
            new LiquidityVault(c.authority, IERC20(settlementToken), "Usance Settlement Vault", "uUSD");
        c.financing = new FinancingEngine(
            c.authority,
            c.liquidityVault,
            FinancingEngine.RateParams({
                baseBps: 200, // 2% floor
                slope1Bps: 400, // to 6% at the kink
                slope2Bps: 6000, // steep beyond it
                kinkBps: 8000, // 80% utilisation
                reserveFactorBps: 1000 // 10% of interest to reserves
            })
        );
        c.clearing = new ClearingHouse(
            c.authority,
            c.assetRegistry,
            c.passportRegistry,
            c.policyRegistry,
            c.collateralVault,
            c.liquidityVault,
            c.financing,
            c.oracle
        );
    }

    function _wire(Core memory c) internal {
        c.collateralVault.setClearingHouse(address(c.clearing));
        c.financing.setClearingHouse(address(c.clearing));
        // The liquidity vault takes instructions from both: ClearingHouse moves cash,
        // FinancingEngine recognises interest.
        // ClearingHouse is the only writer to the liquidity vault. FinancingEngine reports its
        // interest delta in USD and ClearingHouse converts, so granting it CLEARING would hand
        // cash authority to a contract that does not need it.
        c.authority.grantRole(c.authority.CLEARING(), address(c.clearing));
    }

    function _configureSettlement(Core memory c, address token, address feed) internal {
        c.authority.grantRole(c.authority.ADMISSION(), address(this));
        bytes32 settlementId = c.assetRegistry.registerAsset(block.chainid, token, keccak256("USD"), 6);
        c.oracle.setFeed(settlementId, feed);

        address sequencerFeed = vm.envOr("USANCE_SEQUENCER_FEED", address(0));
        if (sequencerFeed != address(0)) c.oracle.setSequencerFeed(sequencerFeed, 3600);

        // The settlement feed is load-bearing for the exit, not just for entry.
        c.oracle.setFeedProtected(settlementId, true);
        c.clearing.setSettlementAsset(settlementId);
        c.authority.revokeRole(c.authority.ADMISSION(), address(this));
    }

    /// @dev A deploy key that stays governance forever is a deploy key that eventually leaks.
    function _handOverAuthority(Core memory c, address deployer) internal {
        address governance = vm.envOr("USANCE_GOVERNANCE", deployer);
        address guardian = vm.envOr("USANCE_GUARDIAN", deployer);

        c.authority.grantRole(c.authority.GOVERNANCE(), governance);
        c.authority.grantRole(c.authority.GUARDIAN(), guardian);
        if (governance != deployer) {
            c.authority.revokeRole(c.authority.GOVERNANCE(), deployer);
        }
    }

    /// @dev Emitted as a flat log so `scripts/write-manifest.mjs` can turn a broadcast into the
    ///      generated `deployments/manifest.ts` without anyone copying an address by hand.
    function _report(Core memory c) internal view {
        console2.log("USANCE_DEPLOYMENT_BEGIN");
        console2.log("chainId", block.chainid);
        console2.log("authority", address(c.authority));
        console2.log("assetRegistry", address(c.assetRegistry));
        console2.log("evidenceRegistry", address(c.evidenceRegistry));
        console2.log("passportRegistry", address(c.passportRegistry));
        console2.log("riskPolicyRegistry", address(c.policyRegistry));
        console2.log("collateralVault", address(c.collateralVault));
        console2.log("liquidityVault", address(c.liquidityVault));
        console2.log("financingEngine", address(c.financing));
        console2.log("clearingHouse", address(c.clearing));
        console2.log("oracleAdapter", address(c.oracle));
        console2.log("USANCE_DEPLOYMENT_END");
    }
}

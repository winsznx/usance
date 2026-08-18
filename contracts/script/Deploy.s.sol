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
import {FeeController} from "../src/core/FeeController.sol";
import {MandateRegistry} from "../src/core/MandateRegistry.sol";
import {ClearingHouse} from "../src/core/ClearingHouse.sol";
import {ChainlinkFeedAdapter} from "../src/adapters/ChainlinkFeedAdapter.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {
    TestnetUSD,
    TestnetTreasuryToken,
    TestnetAggregator,
    TestnetSequencerUptimeFeed
} from "../src/testnet/TestnetFixtures.sol";
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

    /// @dev Two Chainlink heartbeats. Testnet only: the stand-in aggregator publishes whenever a
    ///      script tells it to, so this number describes nothing about production behaviour. The
    ///      mainnet value has no default and must be supplied from measured data.
    uint64 internal constant TESTNET_SETTLEMENT_MAX_PRICE_AGE = 172_800;

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
        FeeController fees;
        MandateRegistry mandates;
    }

    function run() external {
        if (block.chainid != X_LAYER_MAINNET && block.chainid != X_LAYER_TESTNET) {
            revert WrongChain(block.chainid);
        }

        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address settlementToken = vm.envOr("USANCE_SETTLEMENT_TOKEN", address(0));
        address settlementFeed = vm.envOr("USANCE_SETTLEMENT_FEED", address(0));

        vm.startBroadcast(pk);

        // X Layer testnet publishes no Chainlink feeds and hosts no settlement stablecoin, so a
        // deployment there cannot price anything without stand-ins. They are deployed here, named
        // as test assets in their own metadata, and refused outright on mainnet.
        if (settlementToken == address(0) || settlementFeed == address(0)) {
            if (block.chainid != X_LAYER_TESTNET) {
                revert MissingConfig("USANCE_SETTLEMENT_TOKEN/FEED required on mainnet");
            }
            (settlementToken, settlementFeed) = _deployTestnetSettlement();
        }

        Core memory c = _deployCore(vm.addr(pk), settlementToken);
        _wire(c, vm.addr(pk));
        _configureSettlement(c, vm.addr(pk), settlementToken, settlementFeed);
        _handOverAuthority(c, vm.addr(pk));
        vm.stopBroadcast();

        _report(c);
    }

    /// @dev Testnet only. `TestnetUSD` reports its own name as a test asset so the label follows
    ///      the token into any wallet or explorer that reads it.
    function _deployTestnetSettlement() internal returns (address token, address feed) {
        TestnetUSD usd = new TestnetUSD(6);
        TestnetAggregator agg = new TestnetAggregator(8, "tUSD / USD - USANCE TESTNET", 1e8);
        console2.log("testnetSettlementToken", address(usd));
        console2.log("testnetSettlementFeed", address(agg));
        return (address(usd), address(agg));
    }

    function _deployCore(address deployer, address settlementToken) internal returns (Core memory c) {
        c.authority = new Authority(deployer);
        c.assetRegistry = new AssetRegistry(c.authority);
        c.evidenceRegistry = new EvidenceRegistry(c.authority);
        c.passportRegistry = new PassportRegistry(c.authority, c.evidenceRegistry);
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

    function _wire(Core memory c, address deployer) internal {
        c.collateralVault.setClearingHouse(address(c.clearing));
        c.financing.setClearingHouse(address(c.clearing));
        // The liquidity vault takes instructions from both: ClearingHouse moves cash,
        // FinancingEngine recognises interest.
        // ClearingHouse is the only writer to the liquidity vault. FinancingEngine reports its
        // interest delta in USD and ClearingHouse converts, so granting it CLEARING would hand
        // cash authority to a contract that does not need it.
        c.authority.grantRole(c.authority.CLEARING(), address(c.clearing));

        // ClearingHouse changes risk inputs — the oracle, the settlement freshness window — so it
        // must be able to advance the epoch those changes invalidate. A named capability rather
        // than a role, so granting it conveys exactly one power and not cash authority.
        c.policyRegistry.setEpochBumper(address(c.clearing), true);

        // Protocol economics. Deployed as part of the core rather than attached afterwards, so a
        // fresh deployment has a working liquidation market instead of a dormant one — and so the
        // manifest can never describe a protocol whose keeper incentive is unset.
        // The treasury must not be the deploy key. On testnet the deploy key is also the account
        // that borrows in every scenario, so aliasing them makes a liquidation receipt unreadable:
        // one balance gets counted as both "protocol fee" and "returned to borrower", and the
        // reported proceeds come out overstated by exactly the fee. Found by a live run.
        address treasury = vm.envOr("USANCE_TREASURY", address(0));
        if (treasury == address(0)) {
            if (block.chainid != X_LAYER_TESTNET) {
                revert MissingConfig("USANCE_TREASURY required on mainnet");
            }
            treasury =
                address(uint160(uint256(keccak256(abi.encodePacked("usance-testnet-treasury", deployer)))));
        }
        if (treasury == deployer) revert MissingConfig("USANCE_TREASURY must differ from the deploy key");
        c.fees = new FeeController(c.authority, c.policyRegistry, treasury);
        console2.log("treasury", treasury);
        c.clearing.setFeeController(c.fees);
        // Raising a fee changes what an outstanding quote means, so it must be able to advance the
        // epoch those quotes are stamped with.
        c.policyRegistry.setEpochBumper(address(c.fees), true);

        // Delegated authority. Wired at deploy so the registry is never a sidecar: a registry that
        // answers correctly and is never consulted authorises everything.
        c.mandates = new MandateRegistry(c.authority);
        c.clearing.setMandateRegistry(c.mandates);
    }

    /// @dev The ADMISSION role goes to the broadcasting EOA, not to `address(this)`. Under
    ///      `vm.startBroadcast` every call originates from the deployer key, and a script contract
    ///      is ephemeral — granting a role to its address would authorise nothing and Foundry
    ///      rejects the pattern outright.
    function _configureSettlement(Core memory c, address deployer, address token, address feed) internal {
        c.authority.grantRole(c.authority.ADMISSION(), deployer);
        bytes32 settlementId = c.assetRegistry.registerAsset(block.chainid, token, keccak256("USD"), 6);
        c.oracle.setFeed(settlementId, feed);

        address sequencerFeed = vm.envOr("USANCE_SEQUENCER_FEED", address(0));
        if (sequencerFeed != address(0)) c.oracle.setSequencerFeed(sequencerFeed, 3600);

        // The settlement feed is load-bearing for the exit, not just for entry.
        c.oracle.setFeedProtected(settlementId, true);
        c.clearing.setSettlementAsset(settlementId);

        // Settlement-price freshness. Without this the deployment can price collateral and take
        // deposits but cannot lend, because an unconfigured policy refuses new risk.
        //
        // On mainnet the value must be supplied. There is no default worth guessing: the right
        // bound depends on the cadence of the specific feed, and a wrong one either rejects healthy
        // feeds or accepts dead ones. `make characterize-feeds` measures it.
        //
        // On testnet a labelled stand-in policy is used, because the stand-in aggregator's cadence
        // is whatever a script sets and says nothing about production. It is deliberately generous
        // so a demo does not fail on a feed nobody updated, and it can never reach mainnet: this
        // branch is unreachable there and the mainnet branch has no default.
        uint64 maxPriceAge = uint64(vm.envOr("USANCE_SETTLEMENT_MAX_PRICE_AGE", uint256(0)));
        if (maxPriceAge == 0) {
            if (block.chainid != X_LAYER_TESTNET) {
                revert MissingConfig("USANCE_SETTLEMENT_MAX_PRICE_AGE required on mainnet; run `make characterize-feeds`");
            }
            maxPriceAge = TESTNET_SETTLEMENT_MAX_PRICE_AGE;
            console2.log("settlementMaxPriceAge", maxPriceAge, "(TESTNET STAND-IN POLICY)");
        } else {
            console2.log("settlementMaxPriceAge", maxPriceAge);
        }
        c.clearing.setSettlementMaxPriceAge(maxPriceAge);

        // A deployment with no collateral asset can price nothing and demonstrate nothing, so on
        // testnet a labelled tokenized-T-bill stand-in is registered alongside the settlement
        // asset. Its Passport and risk policy are committed by the evidence workflow, not here —
        // this only creates the asset and its price route.
        if (block.chainid == X_LAYER_TESTNET) {
            TestnetTreasuryToken collateral = new TestnetTreasuryToken();
            TestnetAggregator collateralFeed = new TestnetAggregator(8, "tUSTB / USD - USANCE TESTNET", 1e8);
            bytes32 collateralId = c.assetRegistry
                .registerAsset(block.chainid, address(collateral), keccak256("USANCE-TESTNET-TBILL"), 18);
            c.oracle.setFeed(collateralId, address(collateralFeed));

            TestnetSequencerUptimeFeed seq = new TestnetSequencerUptimeFeed();
            c.oracle.setSequencerFeed(address(seq), 3600);

            console2.log("testnetCollateralToken", address(collateral));
            console2.log("testnetCollateralFeed", address(collateralFeed));
            console2.log("testnetSequencerFeed", address(seq));
            console2.log("testnetCollateralAssetId", vm.toString(collateralId));
        }

        c.authority.revokeRole(c.authority.ADMISSION(), deployer);
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
        console2.log("feeController", address(c.fees));
        console2.log("mandateRegistry", address(c.mandates));
        console2.log("USANCE_DEPLOYMENT_END");
    }
}

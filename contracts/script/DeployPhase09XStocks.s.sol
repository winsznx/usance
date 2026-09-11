// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {PortfolioRevolvingCredit} from "../src/base/PortfolioRevolvingCredit.sol";
import {PortfolioRiskEngine} from "../src/base/PortfolioRiskEngine.sol";
import {PortfolioRiskPolicyRegistry} from "../src/base/PortfolioRiskPolicyRegistry.sol";
import {RebasingCollateralVault} from "../src/base/RebasingCollateralVault.sol";
import {XStocksInstrumentAdapter} from "../src/base/XStocksInstrumentAdapter.sol";
import {
    TestOnlyOracleAdapter,
    UsEquitySessionOracle,
    StaticLiquidityObserver
} from "../src/base/adapters/OracleAdapters.sol";
import {TestnetUSD} from "../src/testnet/TestnetFixtures.sol";
import {SyntheticTestXStock, SyntheticXStocksReporter} from "../src/testnet/Phase09XStocksFixtures.sol";

/// @notice Separate X Layer 1952 deployment for Phase 09. It is intentionally synthetic and
/// cannot be mistaken for the historical ClearingHouse deployment or mainnet NVDAx admission.
contract DeployPhase09XStocks is Script {
    uint256 constant XLAYER_TESTNET = 1952;
    bytes32 constant INSTRUMENT = keccak256("USANCE:SYNTHETIC_TEST_XSTOCK:NVDAx:1952:V1");
    bytes32 constant POLICY = keccak256("USANCE:PHASE09:TESTNET:V1");
    error WrongChain(uint256 actual);

    function run() external {
        if (block.chainid != XLAYER_TESTNET) revert WrongChain(block.chainid);
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(pk);
        vm.startBroadcast(pk);

        TestnetUSD usdc = new TestnetUSD(6);
        SyntheticTestXStock token = new SyntheticTestXStock();
        SyntheticXStocksReporter reporter = new SyntheticXStocksReporter();
        PortfolioRiskPolicyRegistry policy = new PortfolioRiskPolicyRegistry(deployer);
        RebasingCollateralVault vault = new RebasingCollateralVault(deployer);
        UsEquitySessionOracle session = new UsEquitySessionOracle(deployer);
        TestOnlyOracleAdapter oracle = new TestOnlyOracleAdapter(deployer, address(session), 3600);
        StaticLiquidityObserver liquidity = new StaticLiquidityObserver(deployer);
        XStocksInstrumentAdapter adapter =
            new XStocksInstrumentAdapter(address(token), address(reporter), INSTRUMENT, 1);

        _configure(policy, vault, oracle, liquidity, reporter, token);
        PortfolioRevolvingCredit facility =
            new PortfolioRevolvingCredit(_terms(deployer, address(usdc), address(vault), address(policy)));
        vault.bindFacility(address(facility));
        facility.admitCollateral(
            INSTRUMENT, address(adapter), address(oracle), address(liquidity), address(session), 9000
        );
        vm.stopBroadcast();

        console2.log("PHASE09_SYNTHETIC_XSTOCKS_FACILITY", address(facility));
        console2.log("PHASE09_REBASING_VAULT", address(vault));
        console2.log("PHASE09_SYNTHETIC_SETTLEMENT", address(usdc));
        console2.log("PHASE09_SYNTHETIC_XSTOCK", address(token));
        console2.log("PHASE09_XSTOCKS_ADAPTER", address(adapter));
        console2.log("PHASE09_REPORTER", address(reporter));
    }

    function _configure(
        PortfolioRiskPolicyRegistry p,
        RebasingCollateralVault v,
        TestOnlyOracleAdapter o,
        StaticLiquidityObserver l,
        SyntheticXStocksReporter r,
        SyntheticTestXStock t
    ) private {
        PortfolioRiskEngine.Policy memory policy;
        policy.capBps = [
            [uint16(10_000), 10_000], [10_000, 10_000], [10_000, 10_000], [10_000, 10_000], [10_000, 10_000]
        ];
        policy.sessionFactorBps = [uint16(10_000), 7500, 7500, 5000, 3000];
        policy.maxCollateralInstruments = 8;
        p.publishPolicy(POLICY, policy, 1, PortfolioRiskPolicyRegistry.PolicyStatus.TESTNET_CALIBRATION, 0, 0);
        for (uint8 i; i < 4; i++) {
            p.setRiskGroupRef(
                INSTRUMENT,
                PortfolioRiskPolicyRegistry.RiskGroupRef(
                    i,
                    keccak256(abi.encodePacked("phase09", i)),
                    keccak256("phase09"),
                    1,
                    keccak256("synthetic"),
                    0,
                    0
                )
            );
        }
        v.registerInstrument(INSTRUMENT, address(t));
        r.set(1e18, 0, 0, true, true);
        o.setPrice(INSTRUMENT, 100e18, uint64(block.timestamp));
        l.setObservation(
            INSTRUMENT,
            StaticLiquidityObserver.Obs(
                keccak256("synthetic-testnet"),
                10_000_000e18,
                1_000_000e18,
                990_000e18,
                uint64(block.number),
                uint64(block.timestamp),
                keccak256("TEST_ONLY"),
                true
            )
        );
    }

    function _terms(address a, address cash, address vault, address policy)
        private
        pure
        returns (PortfolioRevolvingCredit.Terms memory t)
    {
        t = PortfolioRevolvingCredit.Terms(
            keccak256("eip155:1952"),
            keccak256("PHASE09_SYNTHETIC"),
            a,
            a,
            a,
            address(uint160(uint256(keccak256("phase09-treasury")))),
            cash,
            6,
            vault,
            policy,
            POLICY,
            50_000e18,
            5000,
            8500,
            9000,
            30
        );
    }
}

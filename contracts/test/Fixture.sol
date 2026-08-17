// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";

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
import {Types} from "../src/libraries/Types.sol";

import {MockERC20, MockAggregator} from "./mocks/Mocks.sol";

/// @notice Full protocol deployment for tests, wired the same way the deploy script wires it.
/// @dev A shared fixture rather than per-test setup, because a wiring mistake that only exists
///      in tests proves nothing about the system that ships.
abstract contract Fixture is Test {
    Authority internal authority;
    AssetRegistry internal assetsReg;
    EvidenceRegistry internal evidenceReg;
    PassportRegistry internal passportReg;
    RiskPolicyRegistry internal policyReg;
    CollateralVault internal collateralVault;
    LiquidityVault internal liquidityVault;
    FinancingEngine internal financing;
    ClearingHouse internal clearing;
    ChainlinkFeedAdapter internal oracle;

    MockERC20 internal ustb; // tokenized T-bill, 18dp, the collateral
    MockERC20 internal usdc; // settlement asset, 6dp
    MockAggregator internal ustbFeed;
    MockAggregator internal usdcFeed;
    MockAggregator internal sequencerFeed;

    bytes32 internal USTB_ID;
    bytes32 internal USDC_ID;
    bytes32 internal constant POLICY_TBILL = keccak256("POLICY_TBILL");
    bytes32 internal constant POLICY_STABLE = keccak256("POLICY_STABLE");

    address internal governance = address(0x60F);
    address internal guardian = address(0x6DA);
    address internal admission = address(0xAD11);
    address internal alice = address(0xA11CE);
    address internal lender = address(0x1E4DE7);

    uint256 internal constant WAD = 1e18;

    function deployProtocol() internal {
        vm.warp(1_750_000_000);

        authority = new Authority(governance);
        vm.startPrank(governance);
        authority.grantRole(authority.GUARDIAN(), guardian);
        authority.grantRole(authority.ADMISSION(), admission);
        vm.stopPrank();

        assetsReg = new AssetRegistry(authority);
        evidenceReg = new EvidenceRegistry(authority);
        passportReg = new PassportRegistry(authority);
        policyReg = new RiskPolicyRegistry(authority);
        oracle = new ChainlinkFeedAdapter(authority);

        ustb = new MockERC20("Usance T-Bill", "USTBx", 18);
        usdc = new MockERC20("USD Coin", "USDC", 6);

        collateralVault = new CollateralVault(authority, assetsReg);
        liquidityVault = new LiquidityVault(authority, usdc, "Usance USDC Vault", "uUSDC");
        financing = new FinancingEngine(
            authority,
            liquidityVault,
            FinancingEngine.RateParams({
                baseBps: 200, slope1Bps: 400, slope2Bps: 6000, kinkBps: 8000, reserveFactorBps: 1000
            })
        );
        clearing = new ClearingHouse(
            authority, assetsReg, passportReg, policyReg, collateralVault, liquidityVault, financing, oracle
        );

        vm.startPrank(governance);
        collateralVault.setClearingHouse(address(clearing));
        financing.setClearingHouse(address(clearing));
        // The liquidity vault takes instructions from both: ClearingHouse moves cash,
        // FinancingEngine recognises interest.
        // Only ClearingHouse writes to the liquidity vault. FinancingEngine reports its
        // interest delta in USD and lets ClearingHouse convert, so it needs no vault authority
        // at all — which also keeps the CLEARING role's blast radius to one contract.
        authority.grantRole(authority.CLEARING(), address(clearing));
        vm.stopPrank();

        _registerAssets();
        _configurePolicies();
        _configureOracles();
        _commitPassports();

        vm.prank(governance);
        clearing.setSettlementAsset(USDC_ID);
    }

    function _registerAssets() internal {
        vm.startPrank(admission);
        USTB_ID = assetsReg.registerAsset(block.chainid, address(ustb), keccak256("US-TBILL-3M"), 18);
        USDC_ID = assetsReg.registerAsset(block.chainid, address(usdc), keccak256("USD"), 6);
        vm.stopPrank();
    }

    function _configurePolicies() internal {
        vm.startPrank(governance);

        Types.ExitTier[] memory tbillCurve = new Types.ExitTier[](3);
        tbillCurve[0] = Types.ExitTier({thresholdUsd18: 100_000 * WAD, recoveryBps: 9990});
        tbillCurve[1] = Types.ExitTier({thresholdUsd18: 500_000 * WAD, recoveryBps: 9960});
        tbillCurve[2] = Types.ExitTier({thresholdUsd18: 2_000_000 * WAD, recoveryBps: 9900});

        policyReg.createPolicy(
            POLICY_TBILL,
            Types.RiskParameters({
                initialLtvBps: 8500,
                maintenanceLtvBps: 9000,
                liquidationLtvBps: 9300,
                maxConcentrationBps: 10_000,
                haircutMarketBps: 50,
                haircutLiquidityBps: 25,
                haircutIssuerBps: 100,
                haircutSettlementBps: 25,
                haircutCrosschainBps: 0,
                maxOracleAge: 86_400,
                maxPassportAge: 2_592_000
            }),
            tbillCurve
        );

        Types.ExitTier[] memory stableCurve = new Types.ExitTier[](1);
        stableCurve[0] = Types.ExitTier({thresholdUsd18: 100_000_000 * WAD, recoveryBps: 10_000});
        policyReg.createPolicy(
            POLICY_STABLE,
            Types.RiskParameters({
                initialLtvBps: 9000,
                maintenanceLtvBps: 9400,
                liquidationLtvBps: 9700,
                maxConcentrationBps: 10_000,
                haircutMarketBps: 0,
                haircutLiquidityBps: 0,
                haircutIssuerBps: 0,
                haircutSettlementBps: 0,
                haircutCrosschainBps: 0,
                maxOracleAge: 86_400,
                maxPassportAge: 2_592_000
            }),
            stableCurve
        );

        assetsReg.bindRiskPolicy(USTB_ID, POLICY_TBILL);
        assetsReg.bindRiskPolicy(USDC_ID, POLICY_STABLE);
        vm.stopPrank();
    }

    function _configureOracles() internal {
        ustbFeed = new MockAggregator(8, "USTB / USD", 1e8, block.timestamp);
        usdcFeed = new MockAggregator(8, "USDC / USD", 1e8, block.timestamp);
        // Chainlink L2 uptime convention: answer 0 means the sequencer is up.
        sequencerFeed = new MockAggregator(0, "Sequencer Uptime", 0, block.timestamp);
        sequencerFeed.setStartedAt(block.timestamp - 7 days);

        vm.startPrank(governance);
        oracle.setFeed(USTB_ID, address(ustbFeed));
        oracle.setFeed(USDC_ID, address(usdcFeed));
        oracle.setSequencerFeed(address(sequencerFeed), 3600);
        // The settlement feed prices repayments. A guardian must not be able to close the exit.
        oracle.setFeedProtected(USDC_ID, true);
        vm.stopPrank();
    }

    function _commitPassports() internal {
        vm.startPrank(admission);

        passportReg.commitPassport(
            USTB_ID, 1, keccak256("EVIDENCE_ROOT_V1"), keccak256("CLAIMS_ROOT_V1"), 0, true, 9900, false
        );
        passportReg.commitPassport(
            USDC_ID, 1, keccak256("USDC_EVIDENCE_V1"), keccak256("USDC_CLAIMS_V1"), 0, true, 10_000, false
        );

        assetsReg.setCapabilities(
            USTB_ID,
            uint16(1) << uint16(Types.Capability.HOLD) | uint16(1) << uint16(Types.Capability.COLLATERAL)
        );
        assetsReg.setCapabilities(
            USDC_ID,
            uint16(1) << uint16(Types.Capability.HOLD) | uint16(1) << uint16(Types.Capability.COLLATERAL)
        );
        vm.stopPrank();

        vm.startPrank(governance);
        assetsReg.setStatus(USTB_ID, Types.AssetStatus.ACTIVE);
        assetsReg.setStatus(USDC_ID, Types.AssetStatus.ACTIVE);
        vm.stopPrank();
    }

    // ---------------------------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------------------------

    function fundLenders(uint256 usdcAmount) internal {
        usdc.mint(lender, usdcAmount);
        vm.startPrank(lender);
        usdc.approve(address(liquidityVault), usdcAmount);
        liquidityVault.supply(usdcAmount, lender);
        vm.stopPrank();
    }

    function giveCollateral(address who, uint256 tokens) internal {
        ustb.mint(who, tokens);
        vm.prank(who);
        ustb.approve(address(collateralVault), type(uint256).max);
    }

    function depositCollateral(address who, uint256 tokens) internal {
        vm.prank(who);
        clearing.addCollateral(USTB_ID, tokens);
    }

    /// @dev Keep every feed's timestamp current when moving time forward, so tests that are not
    ///      about staleness do not accidentally become tests about staleness.
    function warpAndRefreshFeeds(uint256 dt) internal {
        vm.warp(block.timestamp + dt);
        ustbFeed.set(ustbFeed.answer(), block.timestamp);
        usdcFeed.set(usdcFeed.answer(), block.timestamp);
    }
}

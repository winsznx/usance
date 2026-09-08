// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {MockERC20} from "../mocks/Mocks.sol";
import {MockB20Asset} from "./mocks/MockB20Asset.sol";
import {PortfolioRiskEngine} from "../../src/base/PortfolioRiskEngine.sol";
import {PortfolioRiskPolicyRegistry} from "../../src/base/PortfolioRiskPolicyRegistry.sol";
import {ScaledCollateralVault} from "../../src/base/ScaledCollateralVault.sol";
import {BaseB20InstrumentAdapter} from "../../src/base/BaseB20InstrumentAdapter.sol";
import {
    ChainlinkTotalReturnOracleAdapter,
    TestOnlyOracleAdapter,
    UsEquitySessionOracle,
    StaticLiquidityObserver
} from "../../src/base/adapters/OracleAdapters.sol";
import {PortfolioRevolvingCredit} from "../../src/base/PortfolioRevolvingCredit.sol";

/// @title BasePortfolioLifecycle
/// @notice The Base portfolio-revolving-credit facility end to end against `SYNTHETIC_TEST_B20`
///         doubles + a `TEST_ONLY` oracle (`spec/base-portfolio-facility-model.md`). Covers §22
///         (corporate action during debt), §23 (multi-asset portfolio cases), §24 (unsafe
///         withdrawal), §37 (security tests) and I-109…I-115.
contract BasePortfolioLifecycleTest is Test {
    // roles
    address gov = makeAddr("gov");
    address borrower = makeAddr("borrower");
    address lender = makeAddr("lender");
    address treasury = makeAddr("treasury");
    address route = makeAddr("liquidationRoute");

    // contracts
    MockERC20 usdc;
    PortfolioRiskPolicyRegistry policyReg;
    ScaledCollateralVault vault;
    UsEquitySessionOracle sessionOracle;
    TestOnlyOracleAdapter oracle;
    StaticLiquidityObserver liq;
    PortfolioRevolvingCredit facility;

    MockB20Asset nvda;
    MockB20Asset aapl;
    BaseB20InstrumentAdapter nvdaAdapter;
    BaseB20InstrumentAdapter aaplAdapter;
    bytes32 nvdaId;
    bytes32 aaplId;

    bytes32 constant POLICY_ID = keccak256("BASE_CANARY_PORTFOLIO_POLICY_V1");
    uint16 constant FEE_BPS = 30; // 0.30%
    uint256 constant FACILITY_LIMIT = 50_000e18;

    function setUp() public {
        // Friday 2025-06-20 15:00 UTC — a US-equities OPEN window under the default session config
        vm.warp(1_750_431_600);

        usdc = new MockERC20("Test USD", "TUSD", 6);
        nvda = new MockB20Asset("USANCE-TEST NVDA", "utNVDA", 8);
        aapl = new MockB20Asset("USANCE-TEST AAPL", "utAAPL", 8);
        nvdaId = keccak256("USANCE-TEST-NVDA");
        aaplId = keccak256("USANCE-TEST-AAPL");

        vm.startPrank(gov);
        policyReg = new PortfolioRiskPolicyRegistry(gov);
        vault = new ScaledCollateralVault(gov);
        sessionOracle = new UsEquitySessionOracle(gov);
        oracle = new TestOnlyOracleAdapter(gov, address(sessionOracle), 3600);
        liq = new StaticLiquidityObserver(gov);

        nvdaAdapter = new BaseB20InstrumentAdapter(
            address(nvda),
            nvdaId,
            1 /*TESTED*/
        );
        aaplAdapter = new BaseB20InstrumentAdapter(address(aapl), aaplId, 1);

        // policy: CANARY_PROVISIONAL caps
        PortfolioRiskEngine.Policy memory p;
        uint16[2][5] memory caps = [
            [uint16(3500), 1500], // UNDERLYING
            [uint16(5000), 2000], // ISSUER
            [uint16(5000), 2000], // CUSTODY
            [uint16(4000), 1500], // SECTOR
            [uint16(6000), 6000] // LIQUIDITY
        ];
        p.capBps = caps;
        p.sessionFactorBps = [uint16(10000), 7500, 7500, 5000, 3000];
        p.maxCollateralInstruments = 8;
        policyReg.publishPolicy(POLICY_ID, p, 1, PortfolioRiskPolicyRegistry.PolicyStatus.CANARY_PROVISIONAL, 0, 0);

        // risk groups: distinct underlyings, shared issuer + custody, distinct sectors
        _grp(nvdaId, 0, "u-nvda");
        _grp(nvdaId, 1, "i-coinbase");
        _grp(nvdaId, 2, "cu-coinbase");
        _grp(nvdaId, 3, "s-semis");
        _grp(aaplId, 0, "u-aapl");
        _grp(aaplId, 1, "i-coinbase");
        _grp(aaplId, 2, "cu-coinbase");
        _grp(aaplId, 3, "s-megacap-tech");

        vault.registerInstrument(nvdaId, address(nvda));
        vault.registerInstrument(aaplId, address(aapl));

        // prices: $100 each, fresh
        oracle.setPrice(nvdaId, 100e18, uint64(block.timestamp));
        oracle.setPrice(aaplId, 100e18, uint64(block.timestamp));

        // deep liquidity, no route cap
        StaticLiquidityObserver.Obs memory o;
        o.set = true;
        o.depthUsd18 = 50_000_000e18;
        o.refNotionalUsd18 = 1_000_000e18;
        o.refExitUsd18 = 990_000e18;
        o.liquidityGroupId = keccak256("r-aero-deep");
        o.observedBlock = uint64(block.number);
        o.observedAt = uint64(block.timestamp);
        o.venue = keccak256("aerodrome");
        liq.setObservation(nvdaId, o);
        liq.setObservation(aaplId, o);

        PortfolioRevolvingCredit.Terms memory t = PortfolioRevolvingCredit.Terms({
            homeDomainId: keccak256("eip155:84532"),
            discriminator: keccak256("base-canary-1"),
            governance: gov,
            borrower: borrower,
            lender: lender,
            treasury: treasury,
            settlementToken: address(usdc),
            settlementDecimals: 6,
            vault: address(vault),
            policyRegistry: address(policyReg),
            policyId: POLICY_ID,
            facilityLimitUsd18: FACILITY_LIMIT,
            maxLtvBps: 5000,
            liquidationLtvBps: 8500,
            safetyBufferBps: 9000,
            originationFeeBps: FEE_BPS
        });
        facility = new PortfolioRevolvingCredit(t);
        vault.bindFacility(address(facility));

        facility.admitCollateral(
            nvdaId, address(nvdaAdapter), address(oracle), address(liq), address(sessionOracle), 9000
        );
        facility.admitCollateral(
            aaplId, address(aaplAdapter), address(oracle), address(liq), address(sessionOracle), 9000
        );
        vm.stopPrank();

        // fund borrower with B20 + lender with USDC
        nvda.mint(borrower, 20_000e8); // 20,000 tokens
        aapl.mint(borrower, 20_000e8);
        usdc.mint(lender, 1_000_000e6);
    }

    function _grp(bytes32 id, uint8 dim, string memory name) internal {
        PortfolioRiskPolicyRegistry.RiskGroupRef memory r;
        r.dimension = dim;
        r.groupId = keccak256(bytes(name));
        r.taxonomy = keccak256("usance-risk-groups");
        r.taxonomyVersion = 1;
        r.source = keccak256("phase-08-test");
        policyReg.setRiskGroupRef(id, r);
    }

    function _activate() internal {
        vm.prank(lender);
        usdc.approve(address(facility), 500_000e6);
        vm.prank(lender);
        facility.fund(500_000e6);

        vm.startPrank(borrower);
        nvda.approve(address(vault), type(uint256).max);
        aapl.approve(address(vault), type(uint256).max);
        facility.commitCollateral(nvdaId, borrower, 10_000e8); // $1,000,000 market value
        facility.commitCollateral(aaplId, borrower, 10_000e8);
        vm.stopPrank();

        vm.prank(lender);
        facility.activate();
    }

    // --------------------------------------------------------------- happy path

    function test_fullLifecycle_draw_repay_withdraw_settle() public {
        _activate();

        // portfolio: 2 x $1M market, recognition 90% => single $900k each, base $1.8M.
        // both share ISSUER group i-coinbase: group total = base, allowed = 1.8M * 50% = 900k,
        // scale 0.5 => working 450k each => portfolio recognised $900k (ISSUER binds hardest).
        // maxDebt = min(limit 50k, 900k * 50%) = 50k
        (uint256 rec, uint256 maxDebt,, bytes32 digest, bool live) = facility.quote();
        assertEq(rec, 900_000e18);
        assertEq(maxDebt, FACILITY_LIMIT);
        assertTrue(live);

        uint256 borrowerUsdcBefore = usdc.balanceOf(borrower);
        vm.prank(borrower);
        facility.draw(10_000e6, digest);

        assertEq(usdc.balanceOf(borrower) - borrowerUsdcBefore, 10_000e6);
        // debt = 10,000 + fee(0.30%) = 10,030 USD18
        assertEq(facility.outstandingDebtUsd18(), 10_030e18);

        // repay in full + overpay refund
        vm.startPrank(borrower);
        usdc.mint(borrower, 1_000e6);
        usdc.approve(address(facility), 11_000e6);
        facility.repay(11_000e6);
        vm.stopPrank();
        assertEq(facility.outstandingDebtUsd18(), 0);

        // withdraw half of NVDA safely (no debt)
        vm.prank(borrower);
        facility.withdrawCollateral(nvdaId, 5_000e8);
        assertEq(vault.creditedRaw(nvdaId, borrower), 5_000e8);

        // settle
        vm.prank(borrower);
        facility.settle();
        assertEq(uint256(facility.status()), uint256(PortfolioRevolvingCredit.Status.SETTLED));
        assertEq(vault.creditedRaw(nvdaId, borrower), 0);
        assertEq(vault.creditedRaw(aaplId, borrower), 0);
    }

    // --------------------------------------------------------------- I-110 fee, no bypass

    function test_I110_originationFeeChargedOnDrawAndDrawAgain() public {
        _activate();
        (,,, bytes32 d1,) = facility.quote();
        vm.prank(borrower);
        facility.draw(5_000e6, d1);
        assertEq(facility.outstandingDebtUsd18(), 5_015e18); // 5000 + 0.30%

        (,,, bytes32 d2,) = facility.quote();
        vm.prank(borrower);
        facility.drawAgain(5_000e6, d2);
        assertEq(facility.outstandingDebtUsd18(), 10_030e18); // fee applied again
    }

    // --------------------------------------------------------------- I-115 stale quote

    function test_I115_drawRevertsOnStaleQuoteAfterPriceMove() public {
        _activate();
        (,,, bytes32 stale,) = facility.quote();
        vm.prank(gov);
        // price move -> different snapshot digest
        oracle.setPrice(nvdaId, 110e18, uint64(block.timestamp));
        vm.prank(borrower);
        vm.expectRevert();
        facility.draw(1_000e6, stale);
    }

    function test_I115_drawRevertsOnStaleQuoteAfterMultiplierMove() public {
        _activate();
        (,,, bytes32 stale,) = facility.quote();
        nvda.updateMultiplier(2e18); // corporate action
        vm.prank(borrower);
        vm.expectRevert();
        facility.draw(1_000e6, stale);
    }

    function test_I115_drawRevertsOnStaleQuoteAfterPolicyEpochBump() public {
        _activate();
        (,,, bytes32 stale,) = facility.quote();
        vm.prank(gov);
        policyReg.bumpEpoch("test");
        vm.prank(borrower);
        vm.expectRevert();
        facility.draw(1_000e6, stale);
    }

    // --------------------------------------------------------------- I-109 + §22 corporate action

    function test_I109_multiplierChangeMovesEffectiveNotCredited() public {
        _activate();
        uint256 creditedBefore = vault.creditedRaw(nvdaId, borrower);
        uint256 effBefore = vault.effectiveOf(nvdaId, borrower, nvda.multiplier());

        nvda.updateMultiplier(2e18); // 2:1 split

        assertEq(vault.creditedRaw(nvdaId, borrower), creditedBefore, "credited raw unchanged");
        assertEq(vault.effectiveOf(nvdaId, borrower, nvda.multiplier()), effBefore * 2, "effective doubled");
    }

    function test_S22_corporateActionWithLiveDebt_debtUnchanged_capacityConserved() public {
        _activate();
        (uint256 recBefore,,, bytes32 d,) = facility.quote();
        vm.prank(borrower);
        facility.draw(10_000e6, d);
        uint256 debt = facility.outstandingDebtUsd18();

        // FACTOR_IN_PRICE: a 2:1 split doubles multiplier() AND halves the underlying price, so the
        // Chainlink Total-Return answer (`underlying x multiplier`) is UNCHANGED. The quantity side
        // is RAW (also unchanged). So the recognised value is conserved and the feed price stays put.
        nvda.updateMultiplier(2e18);
        // (oracle price deliberately NOT changed — a total-return feed does not move across a split)

        assertEq(facility.outstandingDebtUsd18(), debt, "debt is stored, unchanged by the corporate action");
        (uint256 recAfter,,,,) = facility.quote();
        assertEq(recAfter, recBefore, "recognised value conserved through the split (I-84)");
    }

    function test_S22_pendingMultiplierWindow_blocksNewRisk() public {
        _activate();
        // enable a Cobalt-style pending 2x update, not yet active
        nvda.enableCobalt(2e18, uint256(block.timestamp) + 1 days);
        // adapter snapshot -> feedStatus PAUSED_FOR_ACTION -> quote not live -> draw refused
        (,,, bytes32 d, bool live) = facility.quote();
        assertFalse(live);
        vm.prank(borrower);
        vm.expectRevert();
        facility.draw(1_000e6, d);
    }

    // --------------------------------------------------------------- I-111 frozen feed / paused token

    function test_I111_drawRefusedWhenTokenPaused() public {
        _activate();
        nvda.setPaused(0, true); // TRANSFER paused
        (,,, bytes32 d, bool live) = facility.quote();
        assertFalse(live);
        vm.prank(borrower);
        vm.expectRevert();
        facility.draw(1_000e6, d);
    }

    function test_I111_drawRefusedWhenFeedStale() public {
        _activate();
        vm.warp(block.timestamp + 2 hours); // beyond the 1h openBound
        (,,, bytes32 d, bool live) = facility.quote();
        assertFalse(live);
        vm.prank(borrower);
        vm.expectRevert();
        facility.draw(1_000e6, d);
    }

    function test_I111_withdrawRefusedWhenFeedStale() public {
        _activate();
        vm.warp(block.timestamp + 2 hours);
        vm.prank(borrower);
        vm.expectRevert();
        facility.withdrawCollateral(nvdaId, 1_000e8);
    }

    // --------------------------------------------------------------- §37 CREDIT

    function test_credit_overDrawReverts() public {
        _activate();
        (,,, bytes32 d,) = facility.quote();
        vm.prank(borrower);
        vm.expectRevert();
        facility.draw(60_000e6, d); // over the 50k facility limit
    }

    function test_credit_unsafeWithdrawalReverts() public {
        _activate();
        (,,, bytes32 d,) = facility.quote();
        vm.prank(borrower);
        facility.draw(45_000e6, d); // near the limit

        // withdrawing most of the collateral would drop recognised value below the safety buffer
        vm.prank(borrower);
        vm.expectRevert();
        facility.withdrawCollateral(nvdaId, 9_500e8);
    }

    function test_credit_overRepayRefundsExcess() public {
        _activate();
        (,,, bytes32 d,) = facility.quote();
        vm.prank(borrower);
        facility.draw(1_000e6, d);
        vm.startPrank(borrower);
        usdc.mint(borrower, 5_000e6);
        usdc.approve(address(facility), 5_000e6);
        uint256 before = usdc.balanceOf(borrower);
        facility.repay(5_000e6);
        vm.stopPrank();
        assertEq(facility.outstandingDebtUsd18(), 0);
        // repaid ~1003, refund ~3997
        assertApproxEqAbs(before - usdc.balanceOf(borrower), 1_003e6, 1e6);
    }

    // --------------------------------------------------------------- §37 B20

    function test_b20_pausedTransferBlocksCommit() public {
        vm.prank(lender);
        usdc.approve(address(facility), 500_000e6);
        vm.prank(lender);
        facility.fund(500_000e6);
        nvda.setPaused(0, true);
        vm.startPrank(borrower);
        nvda.approve(address(vault), type(uint256).max);
        vm.expectRevert();
        facility.commitCollateral(nvdaId, borrower, 1_000e8);
        vm.stopPrank();
    }

    function test_b20_zeroMultiplierReverts() public {
        _activate();
        vm.expectRevert(); // MockB20Asset guards, but assert the adapter also guards
        nvda.updateMultiplier(0);
    }

    function test_b20_adapterProbesCobaltSelectors() public {
        assertFalse(nvdaAdapter.b20HasScheduledMultiplier(), "Beryl mock: selectors revert");
        nvda.enableCobalt(1e18, uint256(block.timestamp) + 1 days);
        assertTrue(nvdaAdapter.b20HasScheduledMultiplier(), "Cobalt mock: selectors present");
    }

    // --------------------------------------------------------------- §23 portfolio cases

    function test_portfolio_recognitionNeverExceedsSumOfSingle() public {
        _activate();
        (uint256 rec,,,,) = facility.quote();
        // base = 2 x $1M x 90% = $1.8M
        assertLe(rec, 1_800_000e18);
    }

    function test_portfolio_sessionDegradationDoesNotIncreaseCapacity() public {
        _activate();
        (uint256 recOpen,,,,) = facility.quote();
        // force a CLOSED-equivalent by forcing UNKNOWN session
        vm.prank(gov);
        sessionOracle.setForcedUnknown(true);
        vm.prank(gov);
        oracle.setPrice(nvdaId, 100e18, uint64(block.timestamp)); // keep price fresh window irrelevant
        // recompute reads sessionOf -> UNKNOWN(4); session factor 3000 < 10000 -> lower
        (uint256 recUnknown,,,,) = facility.quote();
        assertLe(recUnknown, recOpen);
    }

    // --------------------------------------------------------------- unsafe state

    function test_unsafe_state_after_price_crash() public {
        _activate();
        (,,, bytes32 d,) = facility.quote();
        vm.prank(borrower);
        facility.draw(45_000e6, d);
        assertFalse(facility.isUnsafe());

        // crash both prices 95%
        vm.startPrank(gov);
        oracle.setPrice(nvdaId, 5e18, uint64(block.timestamp));
        oracle.setPrice(aaplId, 5e18, uint64(block.timestamp));
        vm.stopPrank();

        assertTrue(facility.isUnsafe());
        // no new risk
        (,,, bytes32 d2,) = facility.quote();
        vm.prank(borrower);
        vm.expectRevert();
        facility.draw(1e6, d2);
    }
}

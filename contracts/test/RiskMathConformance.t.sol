// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {RiskMath} from "../src/libraries/RiskMath.sol";
import {Types} from "../src/libraries/Types.sol";

/// @title Conformance of the Solidity risk pipeline against the canonical fixtures
/// @notice Invariant D-01. Every scenario in `fixtures/canonical/risk-scenarios.json` must
///         reproduce exactly — not approximately — in Solidity.
///
///         The same fixture file drives `crates/risk-core` and `packages/domain`. Three
///         implementations agreeing on 22 scenarios to the wei is the only reason anyone
///         should believe the browser preview matches what the contract will do.
contract RiskMathConformanceTest is Test {
    string internal json;
    uint256 internal scenarioCount;

    function setUp() public {
        json = vm.readFile("../fixtures/canonical/risk-scenarios.json");
        scenarioCount = vm.parseJsonUint(json, ".scenarioCount");
        assertGt(scenarioCount, 0, "fixture set is empty");
    }

    // ---------------------------------------------------------------------------------
    // Fixture decoding helpers
    // ---------------------------------------------------------------------------------

    /// @dev Large values are authored as decimal strings so no consumer has to worry about a
    ///      JSON parser silently degrading them to a double.
    function _u(string memory path) internal view returns (uint256) {
        return vm.parseUint(vm.parseJsonString(json, path));
    }

    function _n(string memory path) internal view returns (uint256) {
        return vm.parseJsonUint(json, path);
    }

    function _s(string memory path) internal view returns (string memory) {
        return vm.parseJsonString(json, path);
    }

    function _b(string memory path) internal view returns (bool) {
        return vm.parseJsonBool(json, path);
    }

    function _eq(string memory a, string memory b) internal pure returns (bool) {
        return keccak256(bytes(a)) == keccak256(bytes(b));
    }

    function _passportStatus(string memory s) internal pure returns (Types.PassportStatus) {
        if (_eq(s, "ACTIVE")) return Types.PassportStatus.ACTIVE;
        if (_eq(s, "STALE")) return Types.PassportStatus.STALE;
        if (_eq(s, "CONFLICTED")) return Types.PassportStatus.CONFLICTED;
        if (_eq(s, "SUSPENDED")) return Types.PassportStatus.SUSPENDED;
        if (_eq(s, "REVOKED")) return Types.PassportStatus.REVOKED;
        if (_eq(s, "NONE")) return Types.PassportStatus.NONE;
        revert(string.concat("unknown PassportStatus: ", s));
    }

    function _assetStatus(string memory s) internal pure returns (Types.AssetStatus) {
        if (_eq(s, "ACTIVE")) return Types.AssetStatus.ACTIVE;
        if (_eq(s, "PAUSED")) return Types.AssetStatus.PAUSED;
        if (_eq(s, "SUSPENDED")) return Types.AssetStatus.SUSPENDED;
        if (_eq(s, "RETIRED")) return Types.AssetStatus.RETIRED;
        if (_eq(s, "UNREGISTERED")) return Types.AssetStatus.UNREGISTERED;
        revert(string.concat("unknown AssetStatus: ", s));
    }

    function _accountStatus(string memory s) internal pure returns (Types.AccountStatus) {
        if (_eq(s, "NORMAL")) return Types.AccountStatus.NORMAL;
        if (_eq(s, "NO_NEW_RISK")) return Types.AccountStatus.NO_NEW_RISK;
        if (_eq(s, "REDUCE_ONLY")) return Types.AccountStatus.REDUCE_ONLY;
        if (_eq(s, "MARGIN_CALL")) return Types.AccountStatus.MARGIN_CALL;
        if (_eq(s, "LIQUIDATING")) return Types.AccountStatus.LIQUIDATING;
        if (_eq(s, "SETTLED")) return Types.AccountStatus.SETTLED;
        if (_eq(s, "BAD_DEBT")) return Types.AccountStatus.BAD_DEBT;
        revert(string.concat("unknown AccountStatus: ", s));
    }

    function _loadAsset(string memory base) internal view returns (Types.AssetRiskInput memory a) {
        a.assetId = vm.parseJsonBytes32(json, string.concat(base, ".assetId"));
        a.quantity = _u(string.concat(base, ".quantity"));
        a.decimals = uint8(_n(string.concat(base, ".decimals")));
        a.priceUsd18 = _u(string.concat(base, ".price.answerUsd18"));
        a.priceUpdatedAt = uint64(_n(string.concat(base, ".price.updatedAt")));
        a.passportCommittedAt = uint64(_n(string.concat(base, ".passport.committedAt")));
        a.passportStatus = _passportStatus(_s(string.concat(base, ".passport.status")));
        a.redemptionSupported = _b(string.concat(base, ".passport.redemptionSupported"));
        a.redemptionFloorBps = uint16(_n(string.concat(base, ".passport.redemptionFloorBps")));
        a.assetStatus = _assetStatus(_s(string.concat(base, ".assetStatus")));

        string memory p = string.concat(base, ".policy");
        a.params = Types.RiskParameters({
            initialLtvBps: uint16(_n(string.concat(p, ".initialLtvBps"))),
            maintenanceLtvBps: uint16(_n(string.concat(p, ".maintenanceLtvBps"))),
            liquidationLtvBps: uint16(_n(string.concat(p, ".liquidationLtvBps"))),
            maxConcentrationBps: uint16(_n(string.concat(p, ".maxConcentrationBps"))),
            haircutMarketBps: uint16(_n(string.concat(p, ".haircuts.marketBps"))),
            haircutLiquidityBps: uint16(_n(string.concat(p, ".haircuts.liquidityBps"))),
            haircutIssuerBps: uint16(_n(string.concat(p, ".haircuts.issuerBps"))),
            haircutSettlementBps: uint16(_n(string.concat(p, ".haircuts.settlementBps"))),
            haircutCrosschainBps: uint16(_n(string.concat(p, ".haircuts.crosschainBps"))),
            maxOracleAge: uint64(_n(string.concat(p, ".maxOracleAgeSeconds"))),
            maxPassportAge: uint64(_n(string.concat(p, ".maxPassportAgeSeconds")))
        });

        uint256 tiers = _n(string.concat(p, ".exitCurveLength"));
        a.exitCurve = new Types.ExitTier[](tiers);
        for (uint256 t; t < tiers; ++t) {
            string memory tp = string.concat(p, ".exitCurve[", vm.toString(t), "]");
            a.exitCurve[t] = Types.ExitTier({
                thresholdUsd18: _u(string.concat(tp, ".thresholdUsd18")),
                recoveryBps: uint16(_n(string.concat(tp, ".recoveryBps")))
            });
        }
    }

    // ---------------------------------------------------------------------------------
    // The conformance run
    // ---------------------------------------------------------------------------------

    function test_allScenariosMatchCanonicalFixtures() public view {
        for (uint256 i; i < scenarioCount; ++i) {
            _runScenario(i);
        }
    }

    function _runScenario(uint256 i) internal view {
        string memory S = string.concat(".scenarios[", vm.toString(i), "]");
        string memory id = _s(string.concat(S, ".id"));

        uint64 nowTs = uint64(_n(string.concat(S, ".now")));
        uint256 nAssets = _n(string.concat(S, ".assetCount"));

        Types.AssetRiskInput[] memory assets = new Types.AssetRiskInput[](nAssets);
        for (uint256 k; k < nAssets; ++k) {
            assets[k] = _loadAsset(string.concat(S, ".assets[", vm.toString(k), "]"));
        }

        Types.AccountInput memory acct = Types.AccountInput({
            scaledPrincipal: _u(string.concat(S, ".account.scaledPrincipal")),
            borrowIndex: _u(string.concat(S, ".account.borrowIndex")),
            reservedUsd18: _u(string.concat(S, ".account.reservedUsd18")),
            statusOverride: _accountStatus(_s(string.concat(S, ".account.statusOverride")))
        });

        Types.SequencerInput memory seq = Types.SequencerInput({
            up: _b(string.concat(S, ".sequencer.up")),
            lastRestartAt: uint64(_n(string.concat(S, ".sequencer.lastRestartAt"))),
            gracePeriod: uint64(_n(string.concat(S, ".sequencer.gracePeriodSeconds")))
        });

        (Types.RiskResult memory r, Types.AssetValuation[] memory vals) =
            RiskMath.evaluate(assets, acct, seq, nowTs);

        string memory E = string.concat(S, ".expected");

        // Per-asset intermediates are checked too. If only the totals were compared, a pair of
        // compensating errors inside the haircut stack would pass, and the UI's "why is this
        // lower?" breakdown would be quietly wrong even though the total was right.
        for (uint256 k; k < nAssets; ++k) {
            string memory P = string.concat(E, ".perAsset[", vm.toString(k), "]");
            assertEq(
                vals[k].marketValueUsd18,
                _u(string.concat(P, ".marketValueUsd18")),
                string.concat(id, ": marketValue[", vm.toString(k), "]")
            );
            assertEq(
                vals[k].haircutMarkUsd18,
                _u(string.concat(P, ".haircutMarkUsd18")),
                string.concat(id, ": haircutMark[", vm.toString(k), "]")
            );
            assertEq(
                vals[k].stressedExitUsd18,
                _u(string.concat(P, ".stressedExitUsd18")),
                string.concat(id, ": stressedExit[", vm.toString(k), "]")
            );
            assertEq(
                vals[k].recognizedUsd18,
                _u(string.concat(P, ".recognizedUsd18")),
                string.concat(id, ": recognized[", vm.toString(k), "]")
            );
            assertEq(
                vals[k].cappedUsd18,
                _u(string.concat(P, ".cappedUsd18")),
                string.concat(id, ": capped[", vm.toString(k), "]")
            );
        }

        assertEq(
            r.totalRecognizedUsd18,
            _u(string.concat(E, ".totalRecognizedUsd18")),
            string.concat(id, ": totalRecognized")
        );
        assertEq(
            r.borrowLimitUsd18, _u(string.concat(E, ".borrowLimitUsd18")), string.concat(id, ": borrowLimit")
        );
        assertEq(
            r.maintenanceLimitUsd18,
            _u(string.concat(E, ".maintenanceLimitUsd18")),
            string.concat(id, ": maintenanceLimit")
        );
        assertEq(
            r.liquidationLimitUsd18,
            _u(string.concat(E, ".liquidationLimitUsd18")),
            string.concat(id, ": liquidationLimit")
        );
        assertEq(r.debtUsd18, _u(string.concat(E, ".debtUsd18")), string.concat(id, ": debt"));
        assertEq(
            r.availableBorrowUsd18,
            _u(string.concat(E, ".availableBorrowUsd18")),
            string.concat(id, ": availableBorrow")
        );
        assertEq(
            r.healthFactorWad, _u(string.concat(E, ".healthFactorWad")), string.concat(id, ": healthFactor")
        );
        assertEq(
            uint8(r.status),
            uint8(_accountStatus(_s(string.concat(E, ".status")))),
            string.concat(id, ": status")
        );
    }
}

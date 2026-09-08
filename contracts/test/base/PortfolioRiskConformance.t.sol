// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {PortfolioRiskEngine} from "../../src/base/PortfolioRiskEngine.sol";

/// @title PortfolioRiskConformance
/// @notice I-116. Every scenario in `fixtures/portfolio/portfolio-scenarios.json` — generated from
///         the frozen TS reference `packages/portfolio-risk/src/evaluate.ts` by
///         `scripts/gen_portfolio_fixtures.mjs` — must reproduce **exactly** in the Solidity
///         `PortfolioRiskEngine`: `portfolioRecognizedValueUsd18`, `singleAssetRecognizedTotal`,
///         and every position's `workingUsd18` and `positionScaleWad`, wei-for-wei. No "close
///         enough" (§39).
contract PortfolioRiskConformanceTest is Test {
    string internal json;
    uint256 internal count;

    function setUp() public {
        json = vm.readFile("../fixtures/portfolio/portfolio-scenarios.json");
        count = vm.parseJsonUint(json, ".scenarioCount");
        assertGt(count, 0, "empty fixture set");
    }

    function _u(string memory p) internal view returns (uint256) {
        return vm.parseUint(vm.parseJsonString(json, p));
    }

    function test_everyScenarioMatchesTheReferenceWeiForWei() public view {
        for (uint256 s = 0; s < count; s++) {
            string memory sp = string.concat(".scenarios[", vm.toString(s), "]");
            _runScenario(sp);
        }
    }

    function _runScenario(string memory sp) internal view {
        uint256 nPos = vm.parseJsonUint(json, string.concat(sp, ".positionCount"));

        // ---- policy ----
        uint256[] memory capFlat = vm.parseJsonUintArray(json, string.concat(sp, ".policy.capBpsFlat"));
        uint256[] memory sf = vm.parseJsonUintArray(json, string.concat(sp, ".policy.sessionFactorBps"));
        PortfolioRiskEngine.Policy memory pol;
        for (uint256 d = 0; d < 5; d++) {
            pol.capBps[d][0] = uint16(capFlat[d * 2]);
            pol.capBps[d][1] = uint16(capFlat[d * 2 + 1]);
        }
        for (uint256 i = 0; i < 5; i++) {
            pol.sessionFactorBps[i] = uint16(sf[i]);
        }
        pol.maxCollateralInstruments =
            uint16(vm.parseJsonUint(json, string.concat(sp, ".policy.maxCollateralInstruments")));

        uint256 stressHaircut = vm.parseJsonUint(json, string.concat(sp, ".policy.stressHaircutBps"));
        if (stressHaircut > 0) {
            pol.stress = new PortfolioRiskEngine.StressScenario[](1);
            pol.stress[0].haircutBps = uint16(stressHaircut);
            pol.stress[0].appliesToGroupIds =
                vm.parseJsonBytes32Array(json, string.concat(sp, ".policy.stressGroupIds"));
            uint256[] memory ss = vm.parseJsonUintArray(json, string.concat(sp, ".policy.stressSessions"));
            pol.stress[0].appliesToSessions = new uint8[](ss.length);
            for (uint256 i = 0; i < ss.length; i++) {
                pol.stress[0].appliesToSessions[i] = uint8(ss[i]);
            }
        }

        // ---- positions ----
        PortfolioRiskEngine.Position[] memory pos = new PortfolioRiskEngine.Position[](nPos);
        for (uint256 i = 0; i < nPos; i++) {
            string memory pp = string.concat(sp, ".positions[", vm.toString(i), "]");
            pos[i].instrumentId = vm.parseJsonBytes32(json, string.concat(pp, ".instrumentId"));
            pos[i].singleRecognizedUsd18 = _u(string.concat(pp, ".singleRecognizedUsd18"));
            pos[i].marketValueUsd18 = _u(string.concat(pp, ".marketValueUsd18"));
            pos[i].marketSession = uint8(vm.parseJsonUint(json, string.concat(pp, ".marketSession")));
            bytes32[] memory g = vm.parseJsonBytes32Array(json, string.concat(pp, ".groups"));
            for (uint256 d = 0; d < 5; d++) {
                pos[i].groups[d] = g[d];
            }
            pos[i].liquidityDepthUsd18 = _u(string.concat(pp, ".liquidityDepthUsd18"));
        }

        // ---- evaluate + assert ----
        PortfolioRiskEngine.Result memory r = PortfolioRiskEngine.evaluate(pos, pol);

        assertEq(
            r.portfolioRecognizedValueUsd18,
            _u(string.concat(sp, ".expected.portfolioRecognizedValueUsd18")),
            string.concat(sp, " portfolioRecognized")
        );
        assertEq(
            r.singleAssetRecognizedTotalUsd18,
            _u(string.concat(sp, ".expected.singleAssetRecognizedTotalUsd18")),
            string.concat(sp, " base")
        );
        assertEq(
            r.portfolioMarketValueUsd18,
            _u(string.concat(sp, ".expected.portfolioMarketValueUsd18")),
            string.concat(sp, " marketValue")
        );
        for (uint256 i = 0; i < nPos; i++) {
            assertEq(
                r.workingUsd18[i],
                _u(string.concat(sp, ".expected.working[", vm.toString(i), "]")),
                string.concat(sp, " working[", vm.toString(i), "]")
            );
            assertEq(
                r.positionScaleWad[i],
                _u(string.concat(sp, ".expected.positionScaleWad[", vm.toString(i), "]")),
                string.concat(sp, " positionScaleWad[", vm.toString(i), "]")
            );
        }

        // I-112: never exceeds the ceiling, never negative
        assertLe(r.portfolioRecognizedValueUsd18, r.singleAssetRecognizedTotalUsd18, "I-112 ceiling");
    }
}

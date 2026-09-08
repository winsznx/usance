// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

/// @title PortfolioRiskEngine
/// @notice The Phase 04 portfolio-risk model on-chain. A pure, storageless, auth-less fixed-point
///         function. `spec/portfolio-risk-model.md §4`, `spec/base-portfolio-facility-model.md §6`.
///
/// @dev **I-116: this is byte-for-byte equal to `packages/portfolio-risk/src/evaluate.ts`.** The
///      differential gate (`test/base/PortfolioRiskConformance.t.sol`) proves every canonical
///      fixture agrees wei-for-wei with the TypeScript reference. Changing a composition rule, a
///      rounding direction or a dimension here is an RFC (`spec/rfcs/`), never a convenience edit.
///
///      It only reduces or caps: `portfolioRecognized <= Σ singleRecognized` and `>= 0` (I-112).
///      No diversification bonus (D-024). Unknown metadata never improves capacity (I-89 on-chain).
///      Duplicate `instrumentId` is rejected by the caller (the facility's admitted set), so the
///      engine `require`s uniqueness instead of the TS reference's dedupe pass (I-91 upstream).
library PortfolioRiskEngine {
    uint256 internal constant WAD = 1e18;
    uint256 internal constant BPS = 10_000;

    uint256 internal constant D_UNDERLYING = 0;
    uint256 internal constant D_ISSUER = 1;
    uint256 internal constant D_CUSTODY = 2;
    uint256 internal constant D_SECTOR = 3;
    uint256 internal constant D_LIQUIDITY = 4;
    uint256 internal constant DIMS = 5;

    // binding constraint kinds
    uint8 internal constant B_NONE = 255;
    uint8 internal constant B_SESSION = 100;
    uint8 internal constant B_STRESS = 101;

    /// @dev The `UNKNOWN_<dimension>` group key. Distinct per dimension, disjoint from any real
    ///      groupId. Mirrors the TS reference's `UNKNOWN_${d}` string key.
    bytes32 private constant UNKNOWN_BASE = keccak256("USANCE_PORTFOLIO_UNKNOWN_GROUP_V1");

    error DuplicateInstrument(bytes32 instrumentId);
    error TooManyInstruments(uint256 got, uint256 max);
    error PolicyCapOrder(uint256 dimension);

    struct Position {
        bytes32 instrumentId;
        uint256 singleRecognizedUsd18; // RiskResult.cappedUsd18 — already §4.6 concentration-capped
        uint256 marketValueUsd18;
        uint8 marketSession; // 0 OPEN, 1 PRE_MARKET, 2 POST_MARKET, 3 CLOSED, 4 UNKNOWN
        bytes32[5] groups; // groupId per dimension; bytes32(0) => UNKNOWN group (for LIQUIDITY => no declared route)
        uint256 liquidityDepthUsd18; // 0 => LIQUIDITY dimension is a no-op for this position
    }

    struct StressScenario {
        bytes32 id;
        uint16 haircutBps;
        bytes32[] appliesToGroupIds;
        uint8[] appliesToSessions;
    }

    struct Policy {
        uint16[2][5] capBps; // [dimension][0 = NAMED, 1 = UNKNOWN]; UNKNOWN <= NAMED required
        uint16[5] sessionFactorBps; // [session]; <= BPS
        StressScenario[] stress;
        uint16 maxCollateralInstruments;
    }

    struct Result {
        uint256 portfolioMarketValueUsd18;
        uint256 singleAssetRecognizedTotalUsd18; // the hard ceiling (base)
        uint256 portfolioRecognizedValueUsd18;
        uint256[] workingUsd18; // parallel to positions
        uint256[] positionScaleWad; // parallel to positions
        uint8[] bindingDimension; // parallel to positions (0..4, B_SESSION, or B_NONE)
        uint8 bindingConstraint; // argmax standalone reduction (0..4, B_SESSION, B_STRESS, or B_NONE)
    }

    /// @dev `a * b / d`, truncating — identical to the TS reference `mulDivDown`. Overflow bound:
    ///      the largest product here is `groupAllowed(<=1e28) * WAD` = 1e46 << 2^256. Callers keep
    ///      `singleRecognizedUsd18` well under 1e40.
    function _mulDivDown(uint256 a, uint256 b, uint256 d) private pure returns (uint256) {
        return (a * b) / d;
    }

    function _min(uint256 a, uint256 b) private pure returns (uint256) {
        return a < b ? a : b;
    }

    /// @notice `spec/portfolio-risk-model.md §4`. `positions` MUST be the facility's admitted set on
    ///         its home domain (I-87) and free of duplicate instrumentIds — this function does not
    ///         filter or dedupe.
    function evaluate(Position[] memory positions, Policy memory policy)
        internal
        pure
        returns (Result memory r)
    {
        uint256 n = positions.length;
        if (n > policy.maxCollateralInstruments) {
            revert TooManyInstruments(n, policy.maxCollateralInstruments);
        }
        for (uint256 d = 0; d < DIMS; d++) {
            if (policy.capBps[d][1] > policy.capBps[d][0]) revert PolicyCapOrder(d);
        }
        for (uint256 i = 0; i < n; i++) {
            for (uint256 j = i + 1; j < n; j++) {
                if (positions[i].instrumentId == positions[j].instrumentId) {
                    revert DuplicateInstrument(positions[i].instrumentId);
                }
            }
        }

        r.workingUsd18 = new uint256[](n);
        r.positionScaleWad = new uint256[](n);
        r.bindingDimension = new uint8[](n);

        uint256 base;
        for (uint256 i = 0; i < n; i++) {
            base += positions[i].singleRecognizedUsd18;
            r.portfolioMarketValueUsd18 += positions[i].marketValueUsd18;
        }
        r.singleAssetRecognizedTotalUsd18 = base;

        if (base == 0) {
            for (uint256 i = 0; i < n; i++) {
                r.positionScaleWad[i] = WAD;
                r.bindingDimension[i] = B_NONE;
            }
            r.bindingConstraint = B_NONE;
            return r;
        }

        // dimScale[dimension][position]
        uint256[] memory dimScale = new uint256[](DIMS * n);
        for (uint256 d = 0; d < DIMS; d++) {
            _fillDimensionScales(positions, base, d, policy, dimScale, d * n);
        }

        // positionScale = min(sessionScale, min over dimensions); track binding dimension
        for (uint256 i = 0; i < n; i++) {
            uint256 scale =
                _mulDivDown(_min(BPS, policy.sessionFactorBps[positions[i].marketSession]), WAD, BPS);
            uint8 binding = scale < WAD ? B_SESSION : B_NONE;
            for (uint256 d = 0; d < DIMS; d++) {
                uint256 s = dimScale[d * n + i];
                if (s < scale) {
                    scale = s;
                    binding = uint8(d);
                }
            }
            r.positionScaleWad[i] = scale;
            r.bindingDimension[i] = binding;
            r.workingUsd18[i] = _mulDivDown(positions[i].singleRecognizedUsd18, scale, WAD);
        }

        uint256 recognized;
        for (uint256 i = 0; i < n; i++) {
            recognized += r.workingUsd18[i];
        }

        // stress scenarios: recognized = min(recognized, min over s of stressed_s)
        uint256 worstStressed = recognized;
        for (uint256 s = 0; s < policy.stress.length; s++) {
            uint256 stressed;
            for (uint256 i = 0; i < n; i++) {
                uint256 w = r.workingUsd18[i];
                stressed += _stressHit(positions[i], policy.stress[s])
                    ? _mulDivDown(w, BPS - policy.stress[s].haircutBps, BPS)
                    : w;
            }
            if (stressed < worstStressed) worstStressed = stressed;
        }
        recognized = _min(recognized, worstStressed);
        r.portfolioRecognizedValueUsd18 = recognized;

        r.bindingConstraint = _bindingConstraint(positions, base, policy, dimScale, worstStressed);
    }

    /// @dev Group key for position `i` in dimension `d`. `active=false` only for a LIQUIDITY
    ///      position with no declared `(route, positive depth)` — the dimension is then a no-op.
    function _groupKey(Position[] memory p, uint256 i, uint256 d)
        private
        pure
        returns (bytes32 key, bool named, bool active)
    {
        bytes32 g = p[i].groups[d];
        if (d == D_LIQUIDITY) {
            if (g == bytes32(0) || p[i].liquidityDepthUsd18 == 0) return (bytes32(0), false, false);
            return (g, true, true);
        }
        if (g == bytes32(0)) return (UNKNOWN_BASE ^ bytes32(d), false, true);
        return (g, true, true);
    }

    function _fillDimensionScales(
        Position[] memory positions,
        uint256 base,
        uint256 d,
        Policy memory policy,
        uint256[] memory dimScale,
        uint256 off
    ) private pure {
        uint256 n = positions.length;
        for (uint256 i = 0; i < n; i++) {
            (bytes32 keyI, bool namedI, bool activeI) = _groupKey(positions, i, d);
            if (!activeI) {
                dimScale[off + i] = WAD;
                continue;
            }
            (uint256 groupTotal, uint256 minDepth) = _groupTotals(positions, d, keyI);
            if (groupTotal == 0) {
                dimScale[off + i] = WAD;
                continue;
            }
            uint256 allowed = _mulDivDown(base, policy.capBps[d][namedI ? 0 : 1], BPS);
            if (d == D_LIQUIDITY && minDepth < allowed) allowed = minDepth;
            dimScale[off + i] = _min(WAD, _mulDivDown(allowed, WAD, groupTotal));
        }
    }

    function _groupTotals(Position[] memory positions, uint256 d, bytes32 keyI)
        private
        pure
        returns (uint256 groupTotal, uint256 minDepth)
    {
        minDepth = type(uint256).max;
        for (uint256 j = 0; j < positions.length; j++) {
            (bytes32 keyJ,, bool activeJ) = _groupKey(positions, j, d);
            if (!activeJ || keyJ != keyI) continue;
            groupTotal += positions[j].singleRecognizedUsd18;
            if (d == D_LIQUIDITY && positions[j].liquidityDepthUsd18 < minDepth) {
                minDepth = positions[j].liquidityDepthUsd18;
            }
        }
    }

    function _stressHit(Position memory p, StressScenario memory s) private pure returns (bool) {
        for (uint256 k = 0; k < s.appliesToSessions.length; k++) {
            if (s.appliesToSessions[k] == p.marketSession) return true;
        }
        for (uint256 d = 0; d < DIMS; d++) {
            if (p.groups[d] == bytes32(0)) continue;
            for (uint256 k = 0; k < s.appliesToGroupIds.length; k++) {
                if (s.appliesToGroupIds[k] == p.groups[d]) return true;
            }
        }
        return false;
    }

    function _bindingConstraint(
        Position[] memory positions,
        uint256 base,
        Policy memory policy,
        uint256[] memory dimScale,
        uint256 worstStressed
    ) private pure returns (uint8) {
        uint256 n = positions.length;
        uint8 kind = B_NONE;
        uint256 worst;

        for (uint256 d = 0; d < DIMS; d++) {
            uint256 red = base - _dimOnly(positions, dimScale, d * n);
            if (red > worst) {
                worst = red;
                kind = uint8(d);
            }
        }
        {
            uint256 red = base - _sessionOnly(positions, policy);
            if (red > worst) {
                worst = red;
                kind = B_SESSION;
            }
        }
        if ((base > worstStressed ? base - worstStressed : 0) > worst) {
            kind = B_STRESS;
        }
        return kind;
    }

    function _dimOnly(Position[] memory positions, uint256[] memory dimScale, uint256 off)
        private
        pure
        returns (uint256 only)
    {
        for (uint256 i = 0; i < positions.length; i++) {
            only += _mulDivDown(positions[i].singleRecognizedUsd18, _min(WAD, dimScale[off + i]), WAD);
        }
    }

    function _sessionOnly(Position[] memory positions, Policy memory policy)
        private
        pure
        returns (uint256 only)
    {
        for (uint256 i = 0; i < positions.length; i++) {
            uint256 sScale =
                _mulDivDown(_min(BPS, policy.sessionFactorBps[positions[i].marketSession]), WAD, BPS);
            only += _mulDivDown(positions[i].singleRecognizedUsd18, sScale, WAD);
        }
    }
}

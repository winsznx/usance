// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

import {Types} from "./Types.sol";

/// @title RiskMath
/// @notice The deterministic valuation and capacity pipeline. This is the onchain authority
///         for every number Usance lends against.
/// @dev Pure. Reads no storage, no block state, no oracle. Everything it needs arrives in the
///      argument list, which is what lets `fixtures/canonical/risk-scenarios.json` drive it
///      directly and lets `crates/risk-core` be a genuine differential oracle rather than a
///      loose approximation.
///
///      Every line here maps to a numbered section of spec/accounting.md. If the two disagree,
///      the spec is right and this file is a bug.
library RiskMath {
    using Types for Types.AccountStatus;

    error ExitCurveEmpty();
    error AssetsNotOrdered();
    error ZeroDenominator();

    // ---------------------------------------------------------------------------------
    // §1.2 Rounding primitives
    // ---------------------------------------------------------------------------------

    /// @notice Round-down multiply-divide with a full 512-bit intermediate.
    /// @dev Solidity 0.8 reverts on overflow of `a * b`, which for realistic quantities times
    ///      1e18 prices is reachable. The 512-bit path is not an optimisation, it is the
    ///      difference between a correct valuation and a revert on a large position.
    function mulDiv(uint256 a, uint256 b, uint256 d) internal pure returns (uint256 result) {
        if (d == 0) revert ZeroDenominator();

        // Split a*b into 512 bits: prod1 * 2**256 + prod0
        uint256 prod0;
        uint256 prod1;
        unchecked {
            assembly {
                let mm := mulmod(a, b, not(0))
                prod0 := mul(a, b)
                prod1 := sub(sub(mm, prod0), lt(mm, prod0))
            }

            if (prod1 == 0) {
                return prod0 / d;
            }

            // Result must fit in 256 bits.
            require(d > prod1, "RiskMath: mulDiv overflow");

            // Remainder-subtraction, then exact division by the odd part of d.
            uint256 remainder;
            assembly {
                remainder := mulmod(a, b, d)
                prod1 := sub(prod1, gt(remainder, prod0))
                prod0 := sub(prod0, remainder)
            }

            uint256 twos = d & (0 - d);
            assembly {
                d := div(d, twos)
                prod0 := div(prod0, twos)
                twos := add(div(sub(0, twos), twos), 1)
            }
            prod0 |= prod1 * twos;

            uint256 inv = (3 * d) ^ 2;
            inv *= 2 - d * inv;
            inv *= 2 - d * inv;
            inv *= 2 - d * inv;
            inv *= 2 - d * inv;
            inv *= 2 - d * inv;
            inv *= 2 - d * inv;

            result = prod0 * inv;
        }
    }

    /// @notice Round-up multiply-divide. Used for every quantity the user owes.
    function mulDivUp(uint256 a, uint256 b, uint256 d) internal pure returns (uint256) {
        if (a == 0 || b == 0) return 0;
        uint256 down = mulDiv(a, b, d);
        // mulmod detects a non-zero remainder without recomputing the 512-bit product.
        return mulmod(a, b, d) == 0 ? down : down + 1;
    }

    function max(Types.AccountStatus x, Types.AccountStatus y) internal pure returns (Types.AccountStatus) {
        return uint8(x) >= uint8(y) ? x : y;
    }

    // ---------------------------------------------------------------------------------
    // §4 Valuation
    // ---------------------------------------------------------------------------------

    /// @notice §4.3 — the recovery band for a position of this size.
    /// @dev First tier whose threshold is at or above the position; past the last threshold the
    ///      last (worst) tier applies. `RiskPolicyRegistry` guarantees the curve is ascending in
    ///      threshold and non-increasing in recovery, so "last" really is "worst".
    function selectRecoveryBps(Types.ExitTier[] memory curve, uint256 marketValue)
        internal
        pure
        returns (uint16)
    {
        uint256 n = curve.length;
        if (n == 0) revert ExitCurveEmpty();
        for (uint256 i; i < n; ++i) {
            if (marketValue <= curve[i].thresholdUsd18) return curve[i].recoveryBps;
        }
        return curve[n - 1].recoveryBps;
    }

    /// @notice §4.1–§4.5 — value one asset position.
    function valueAsset(Types.AssetRiskInput memory a) internal pure returns (Types.AssetValuation memory v) {
        v.assetId = a.assetId;

        // §4.1 market value
        v.marketValueUsd18 = mulDiv(a.quantity, a.priceUsd18, 10 ** a.decimals);

        // §4.2 haircut mark — fixed order, sequential, each step floors
        uint256 m = v.marketValueUsd18;
        Types.RiskParameters memory p = a.params;
        m = mulDiv(m, Types.BPS - p.haircutMarketBps, Types.BPS);
        m = mulDiv(m, Types.BPS - p.haircutLiquidityBps, Types.BPS);
        m = mulDiv(m, Types.BPS - p.haircutIssuerBps, Types.BPS);
        m = mulDiv(m, Types.BPS - p.haircutSettlementBps, Types.BPS);
        m = mulDiv(m, Types.BPS - p.haircutCrosschainBps, Types.BPS);
        v.haircutMarkUsd18 = m;

        // §4.3 stressed exit
        v.stressedExitUsd18 =
            mulDiv(v.marketValueUsd18, selectRecoveryBps(a.exitCurve, v.marketValueUsd18), Types.BPS);

        // §4.5 recognised = min(candidates)
        uint256 recognised =
            v.haircutMarkUsd18 < v.stressedExitUsd18 ? v.haircutMarkUsd18 : v.stressedExitUsd18;

        // §4.4 redemption floor participates only when redemption actually exists
        if (a.redemptionSupported) {
            v.redemptionFloorUsd18 = mulDiv(v.marketValueUsd18, a.redemptionFloorBps, Types.BPS);
            if (v.redemptionFloorUsd18 < recognised) recognised = v.redemptionFloorUsd18;
        }

        v.recognizedUsd18 = recognised;
    }

    /// @notice §5.1 — the restrictions implied by this asset's inputs at time `nowTs`.
    /// @dev A zero-quantity position contributes no gates. Holding nothing of a suspended asset
    ///      must not restrict an account, or every retired asset would freeze the protocol.
    /// @dev Ages are computed with saturating subtraction. A timestamp ahead of `nowTs` is not
    ///      exotic — ordinary L2 clock skew puts an oracle a second into the future routinely —
    ///      and unsigned subtraction panics on it, which reverted `evaluate()` entirely and took
    ///      reads, borrows and repayments down with it. The TypeScript and Python implementations
    ///      compute a signed difference and treat a future timestamp as age zero, so the panic
    ///      was also a three-way divergence the canonical fixtures could not see: they contain no
    ///      future-dated timestamp. Saturating here matches the other implementations, and a
    ///      future timestamp reads as maximally fresh rather than maximally stale.
    function _age(uint64 nowTs, uint64 then) private pure returns (uint64) {
        return nowTs > then ? nowTs - then : 0;
    }

    function assetGates(Types.AssetRiskInput memory a, uint64 nowTs) internal pure returns (uint32 g) {
        if (a.quantity == 0) return 0;

        if (_age(nowTs, a.priceUpdatedAt) > a.params.maxOracleAge) g |= Types.GATE_ORACLE_STALE;
        if (a.priceUsd18 == 0) g |= Types.GATE_ORACLE_INVALID;
        if (_age(nowTs, a.passportCommittedAt) > a.params.maxPassportAge) g |= Types.GATE_PASSPORT_STALE;
        if (a.passportStatus == Types.PassportStatus.CONFLICTED) g |= Types.GATE_CLAIM_CONFLICT;
        if (
            a.passportStatus == Types.PassportStatus.SUSPENDED || a.assetStatus == Types.AssetStatus.SUSPENDED
        ) g |= Types.GATE_ASSET_SUSPENDED;
    }

    // ---------------------------------------------------------------------------------
    // §4.6 + §5 Portfolio evaluation
    // ---------------------------------------------------------------------------------

    /// @notice The whole pipeline. This is the number the protocol lends against.
    /// @param assets Held positions, ascending by `assetId`. Ordering is asserted, not assumed:
    ///        truncated sums are order-dependent, so an unordered array would silently produce a
    ///        different total than the reference model.
    function evaluate(
        Types.AssetRiskInput[] memory assets,
        Types.AccountInput memory account,
        Types.SequencerInput memory seq,
        uint64 nowTs
    ) internal pure returns (Types.RiskResult memory r, Types.AssetValuation[] memory vals) {
        uint256 n = assets.length;
        vals = new Types.AssetValuation[](n);

        // Sequencer gates are portfolio-wide: an unarbitrable L2 price is not a price.
        if (!seq.up) {
            r.gates |= Types.GATE_SEQUENCER_DOWN;
        } else if (_age(nowTs, seq.lastRestartAt) < seq.gracePeriod) {
            r.gates |= Types.GATE_SEQUENCER_GRACE;
        }

        uint256 rawTotal;
        for (uint256 i; i < n; ++i) {
            if (i > 0 && uint256(assets[i].assetId) <= uint256(assets[i - 1].assetId)) {
                revert AssetsNotOrdered();
            }
            vals[i] = valueAsset(assets[i]);
            r.gates |= assetGates(assets[i], nowTs);
            rawTotal += vals[i].recognizedUsd18;
        }

        // §4.6 concentration — single pass against the uncapped total
        for (uint256 i; i < n; ++i) {
            uint256 cap = mulDiv(rawTotal, assets[i].params.maxConcentrationBps, Types.BPS);
            uint256 capped = vals[i].recognizedUsd18 < cap ? vals[i].recognizedUsd18 : cap;
            vals[i].cappedUsd18 = capped;

            r.totalRecognizedUsd18 += capped;
            r.borrowLimitUsd18 += mulDiv(capped, assets[i].params.initialLtvBps, Types.BPS);
            r.maintenanceLimitUsd18 += mulDiv(capped, assets[i].params.maintenanceLtvBps, Types.BPS);
            r.liquidationLimitUsd18 += mulDiv(capped, assets[i].params.liquidationLtvBps, Types.BPS);
        }

        // §3.1 debt reconstruction, rounds up
        r.debtUsd18 = mulDivUp(account.scaledPrincipal, account.borrowIndex, Types.WAD);

        // §5.1 status
        Types.AccountStatus base;
        if (r.debtUsd18 == 0 || r.debtUsd18 <= r.borrowLimitUsd18) {
            base = Types.AccountStatus.NORMAL;
        } else if (r.debtUsd18 <= r.maintenanceLimitUsd18) {
            base = Types.AccountStatus.NO_NEW_RISK;
        } else if (r.debtUsd18 <= r.liquidationLimitUsd18) {
            base = Types.AccountStatus.REDUCE_ONLY;
        } else {
            base = Types.AccountStatus.MARGIN_CALL;
        }

        Types.AccountStatus gateFloor =
            r.gates != 0 ? Types.AccountStatus.NO_NEW_RISK : Types.AccountStatus.NORMAL;

        r.status = max(max(base, gateFloor), account.statusOverride);

        // §5 capacity
        if (r.status == Types.AccountStatus.NORMAL) {
            uint256 used = r.debtUsd18 + account.reservedUsd18;
            r.availableBorrowUsd18 = r.borrowLimitUsd18 > used ? r.borrowLimitUsd18 - used : 0;
        }

        r.healthFactorWad =
            r.debtUsd18 == 0 ? type(uint256).max : mulDiv(r.maintenanceLimitUsd18, Types.WAD, r.debtUsd18);
    }

    // ---------------------------------------------------------------------------------
    // §6 Interest
    // ---------------------------------------------------------------------------------

    /// @notice Two-slope utilisation curve. Returns an annualised borrow rate in bps.
    function borrowRateBps(
        uint256 cash,
        uint256 borrows,
        uint16 baseBps,
        uint16 slope1Bps,
        uint16 slope2Bps,
        uint16 kinkBps
    ) internal pure returns (uint256) {
        if (borrows == 0) return baseBps;
        uint256 u = mulDiv(borrows, Types.BPS, cash + borrows);
        if (u <= kinkBps) {
            return baseBps + mulDiv(u, slope1Bps, kinkBps);
        }
        return baseBps + slope1Bps + mulDiv(u - kinkBps, slope2Bps, Types.BPS - kinkBps);
    }

    /// @notice Advance the borrow index. Monotone non-decreasing by construction.
    function accrueIndex(uint256 index, uint256 rateBps, uint256 dt) internal pure returns (uint256) {
        if (dt == 0 || rateBps == 0) return index;
        // Floored, so the index can never overstate what borrowers owe through rounding alone.
        return index + mulDiv(index, rateBps * dt, Types.BPS * Types.SECONDS_PER_YEAR);
    }
}

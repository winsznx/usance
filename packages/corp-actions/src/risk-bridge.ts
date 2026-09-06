import { effectiveQuantity } from "./quantity";
import type { CorporateActionSnapshot } from "./types";

/**
 * The seam between corporate-action accounting and the existing risk pipeline.
 *
 * The deployed pipeline (`contracts/src/libraries/RiskMath.sol`, `packages/domain/src/risk.ts`) is
 * a pure function of `Types.AssetRiskInput`, whose `quantity` is a token amount and `priceUsd18`
 * is a per-unit price. This function decides which `quantity` to hand it so the corporate-action
 * factor is applied exactly once (`spec/corporate-action-model.md §5`, invariant I-84):
 *
 *   - `FACTOR_IN_PRICE`  → `quantity = storedRaw`; the oracle MUST be the factor-carrying feed
 *                          (e.g. the Chainlink B20 Total-Return feed). Do NOT also scale quantity.
 *   - `FACTOR_IN_QUANTITY`→ `quantity = effective`; the oracle reports the raw underlying price.
 *   - `FACTOR_ABSENT`     → `quantity = storedRaw` (FIXED_UNIT).
 *
 * It never lets a degraded snapshot raise capacity: `restrictNewRisk` is surfaced for the caller
 * to fold into the account-status gate the same way a stale oracle is (`I-07`, `I-85`).
 */
export interface RiskQuantity {
  /** The number to place in `AssetRiskInput.quantity`. */
  quantityForPipeline: bigint;
  /** Which oracle the caller must have configured for this asset. */
  requiredOracleBasis: "FACTOR_CARRYING_FEED" | "RAW_UNDERLYING_FEED" | "PLAIN";
  /** When true the caller must not allow this input to increase borrow capacity. */
  restrictNewRisk: boolean;
  reason: string | null;
  /** The exact snapshot this quantity was derived under — pin it on the quote / RiskEpoch. */
  pinnedSnapshot: CorporateActionSnapshot;
}

export function toRiskQuantity(
  storedRaw: bigint,
  snap: CorporateActionSnapshot,
  now: number,
): RiskQuantity {
  switch (snap.priceConvention) {
    case "FACTOR_ABSENT":
      return {
        quantityForPipeline: storedRaw,
        requiredOracleBasis: "PLAIN",
        restrictNewRisk: false,
        reason: null,
        pinnedSnapshot: snap,
      };

    case "FACTOR_IN_PRICE": {
      // Quantity stays raw. Still compute the factor state to surface any restriction.
      const e = snap.accountingMode === "FIXED_UNIT"
        ? { restrictNewRisk: false, reason: null as string | null }
        : effectiveQuantity(storedRaw, snap, now);
      return {
        quantityForPipeline: storedRaw,
        requiredOracleBasis: "FACTOR_CARRYING_FEED",
        restrictNewRisk: e.restrictNewRisk,
        reason: e.reason,
        pinnedSnapshot: snap,
      };
    }

    case "FACTOR_IN_QUANTITY": {
      const e = effectiveQuantity(storedRaw, snap, now);
      return {
        quantityForPipeline: e.effective,
        requiredOracleBasis: "RAW_UNDERLYING_FEED",
        restrictNewRisk: e.restrictNewRisk,
        reason: e.reason,
        pinnedSnapshot: snap,
      };
    }
  }
}

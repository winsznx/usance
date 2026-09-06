import { describe, expect, it } from "vitest";
import { WAD, toRiskQuantity, type CorporateActionSnapshot } from "../src/index";

const snap = (over: Partial<CorporateActionSnapshot>): CorporateActionSnapshot => ({
  instrumentId: "0x",
  accountingMode: "EXTERNALLY_SCALED",
  accountingModeVersion: 1,
  factorWad: WAD,
  pendingFactorWad: null,
  pendingActivationAt: null,
  sourceDomain: "eip155:8453",
  sourceBlock: 1,
  sourceEvent: null,
  priceConvention: "FACTOR_IN_PRICE",
  feedStatus: "LIVE",
  adapterVersion: "t",
  support: "TESTED_SUPPORTED",
  observedAt: 0,
  ...over,
});
const U = (n: bigint) => n * WAD;

describe("toRiskQuantity — the seam to AssetRiskInput.quantity, I-84 / I-85", () => {
  it("B20 (FACTOR_IN_PRICE): quantity stays RAW and the oracle must be the factor-carrying feed", () => {
    const r = toRiskQuantity(U(3n), snap({ factorWad: 2n * WAD, priceConvention: "FACTOR_IN_PRICE" }), 0);
    expect(r.quantityForPipeline).toBe(U(3n));
    expect(r.requiredOracleBasis).toBe("FACTOR_CARRYING_FEED");
  });

  it("xStocks (FACTOR_IN_QUANTITY): quantity becomes EFFECTIVE and the oracle is the raw underlying feed", () => {
    const r = toRiskQuantity(
      U(4n),
      snap({ accountingMode: "REBASING_BALANCE", factorWad: 4n * WAD, priceConvention: "FACTOR_IN_QUANTITY" }),
      0,
    );
    expect(r.quantityForPipeline).toBe(U(4n)); // already adjusted, no pending change
    expect(r.requiredOracleBasis).toBe("RAW_UNDERLYING_FEED");
  });

  it("FIXED_UNIT: plain pass-through, no restriction", () => {
    const r = toRiskQuantity(U(100n), snap({ accountingMode: "FIXED_UNIT", priceConvention: "FACTOR_ABSENT" }), 0);
    expect(r.quantityForPipeline).toBe(U(100n));
    expect(r.requiredOracleBasis).toBe("PLAIN");
    expect(r.restrictNewRisk).toBe(false);
  });

  it("a pending split restricts new risk and does not raise the pipeline quantity", () => {
    const r = toRiskQuantity(
      U(3n),
      snap({ priceConvention: "FACTOR_IN_QUANTITY", factorWad: WAD, pendingFactorWad: 2n * WAD, pendingActivationAt: 100 }),
      50,
    );
    expect(r.quantityForPipeline).toBe(U(3n)); // not 6
    expect(r.restrictNewRisk).toBe(true);
  });

  it("a paused feed restricts regardless of convention", () => {
    for (const c of ["FACTOR_IN_PRICE", "FACTOR_IN_QUANTITY"] as const) {
      const r = toRiskQuantity(U(1n), snap({ priceConvention: c, feedStatus: "PAUSED_FOR_ACTION" }), 0);
      expect(r.restrictNewRisk).toBe(true);
    }
  });

  it("the pinned snapshot travels with the quantity for the quote / RiskEpoch to bind", () => {
    const s = snap({ sourceBlock: 4242, sourceEvent: "SPLIT-9" });
    const r = toRiskQuantity(U(1n), s, 0);
    expect(r.pinnedSnapshot.sourceBlock).toBe(4242);
    expect(r.pinnedSnapshot.sourceEvent).toBe("SPLIT-9");
  });
});

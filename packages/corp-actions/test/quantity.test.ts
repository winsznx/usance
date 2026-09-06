import { describe, expect, it } from "vitest";
import {
  WAD,
  effectiveFactor,
  effectiveQuantity,
  economicValueUsd18,
  mulDivDown,
  type CorporateActionSnapshot,
} from "../src/index";

const base = (over: Partial<CorporateActionSnapshot> = {}): CorporateActionSnapshot => ({
  instrumentId: "0xinstr",
  accountingMode: "EXTERNALLY_SCALED",
  accountingModeVersion: 1,
  factorWad: WAD,
  pendingFactorWad: null,
  pendingActivationAt: null,
  sourceDomain: "eip155:8453",
  sourceBlock: 1000,
  sourceEvent: null,
  priceConvention: "FACTOR_IN_QUANTITY",
  feedStatus: "LIVE",
  adapterVersion: "test/1",
  support: "TESTED_SUPPORTED",
  observedAt: 0,
  ...over,
});

describe("effectiveFactor — §9", () => {
  it("FIXED_UNIT must carry exactly 1e18 and never restricts", () => {
    const f = effectiveFactor(base({ accountingMode: "FIXED_UNIT" }), 0);
    expect(f).toEqual({ factorWad: WAD, restrictNewRisk: false, reason: null });
    expect(() =>
      effectiveFactor(base({ accountingMode: "FIXED_UNIT", factorWad: WAD + 1n }), 0),
    ).toThrow(/1e18/);
  });

  it("a LIVE feed with no pending change and full support does not restrict", () => {
    expect(effectiveFactor(base({ factorWad: 2n * WAD }), 0).restrictNewRisk).toBe(false);
  });

  it("a paused or stale feed restricts", () => {
    expect(effectiveFactor(base({ feedStatus: "PAUSED_FOR_ACTION" }), 0).restrictNewRisk).toBe(true);
    expect(effectiveFactor(base({ feedStatus: "STALE" }), 0).restrictNewRisk).toBe(true);
  });

  it("UNKNOWN support restricts and never unlocks new risk", () => {
    const f = effectiveFactor(base({ support: "UNKNOWN" }), 0);
    expect(f.restrictNewRisk).toBe(true);
  });

  it("UNSUPPORTED is unreachable in a valuation path", () => {
    expect(() => effectiveFactor(base({ support: "UNSUPPORTED" }), 0)).toThrow(/UNSUPPORTED/);
  });

  it("a pending split does not raise the factor before activation — uses the more conservative one", () => {
    const snap = base({ factorWad: WAD, pendingFactorWad: 2n * WAD, pendingActivationAt: 100 });
    const f = effectiveFactor(snap, 50); // before activation
    expect(f.factorWad).toBe(WAD); // min(1x, 2x)
    expect(f.restrictNewRisk).toBe(true);
  });

  it("a pending reverse split is applied conservatively before activation", () => {
    const snap = base({ factorWad: 4n * WAD, pendingFactorWad: 2n * WAD, pendingActivationAt: 100 });
    const f = effectiveFactor(snap, 50);
    expect(f.factorWad).toBe(2n * WAD); // the coming reduction is priced in immediately
    expect(f.restrictNewRisk).toBe(true);
  });

  it("past activation with a stale pending factor still set → restrict and signal re-read", () => {
    const snap = base({ factorWad: 4n * WAD, pendingFactorWad: 2n * WAD, pendingActivationAt: 100 });
    const f = effectiveFactor(snap, 150);
    expect(f.restrictNewRisk).toBe(true);
    expect(f.reason).toMatch(/re-read/i);
  });
});

describe("effectiveQuantity — §1", () => {
  it("FIXED_UNIT is the identity", () => {
    const q = effectiveQuantity(1234n, base({ accountingMode: "FIXED_UNIT" }), 0);
    expect(q.effective).toBe(1234n);
  });

  it("EXTERNALLY_SCALED (B20): effective = raw × factor / WAD, rounded down", () => {
    const q = effectiveQuantity(1_000_001n, base({ factorWad: 1_333_333_333_333_333_333n }), 0);
    expect(q.effective).toBe(mulDivDown(1_000_001n, 1_333_333_333_333_333_333n, WAD));
    expect(q.effective).toBe(1_333_334n);
  });

  it("REBASING_BALANCE (xStocks): stored is already adjusted; a conservative factor scales it back", () => {
    const snap = base({
      accountingMode: "REBASING_BALANCE",
      factorWad: 4n * WAD,
      pendingFactorWad: 2n * WAD,
      pendingActivationAt: 100,
    });
    // stored = raw(1) * currentFactor(4) = 4. Conservative factor 2 → effective = 4 * 2 / 4 = 2.
    const q = effectiveQuantity(4n * WAD, snap, 50);
    expect(q.effective).toBe(2n * WAD);
    expect(q.restrictNewRisk).toBe(true);
  });

  it("SHARE_BASED_CUSTODY and EXTERNALLY_MANAGED are not per-instrument conversions", () => {
    expect(() => effectiveQuantity(1n, base({ accountingMode: "SHARE_BASED_CUSTODY" }), 0)).toThrow(/pool/);
    expect(() => effectiveQuantity(1n, base({ accountingMode: "EXTERNALLY_MANAGED" }), 0)).toThrow();
  });

  it("rounding is always down — never increases the effective quantity", () => {
    for (const factor of [1n, WAD - 1n, WAD + 1n, 3n * WAD - 7n]) {
      const q = effectiveQuantity(999_999_999n, base({ factorWad: factor }), 0);
      expect(q.effective).toBeLessThanOrEqual((999_999_999n * factor) / WAD);
    }
  });
});

describe("economicValueUsd18 — I-84, the factor appears exactly once", () => {
  it("FACTOR_IN_PRICE uses RAW (the feed already carries the multiplier)", () => {
    const snap = base({ priceConvention: "FACTOR_IN_PRICE", factorWad: 2n * WAD });
    // feed price already = underlying(100) × 2 = 200
    const r = economicValueUsd18({ storedRaw: 3n * WAD, priceUsd18: 200n * WAD, decimals: 18, snap, now: 0 });
    expect(r.basis).toBe("RAW");
    expect(r.valueUsd18).toBe(600n * WAD);
  });

  it("FACTOR_IN_QUANTITY uses EFFECTIVE (the feed reports the raw share price)", () => {
    const snap = base({ priceConvention: "FACTOR_IN_QUANTITY", factorWad: 2n * WAD });
    const r = economicValueUsd18({ storedRaw: 3n * WAD, priceUsd18: 100n * WAD, decimals: 18, snap, now: 0 });
    expect(r.basis).toBe("EFFECTIVE");
    expect(r.quantityUsed).toBe(6n * WAD);
    expect(r.valueUsd18).toBe(600n * WAD);
  });

  it("FACTOR_ABSENT (FIXED_UNIT): neither side scales", () => {
    const snap = base({ accountingMode: "FIXED_UNIT", priceConvention: "FACTOR_ABSENT" });
    const r = economicValueUsd18({ storedRaw: 5n * WAD, priceUsd18: 2n * WAD, decimals: 18, snap, now: 0 });
    expect(r.valueUsd18).toBe(10n * WAD);
  });

  it("carries the restrict flag through when the state is degraded", () => {
    const snap = base({ priceConvention: "FACTOR_IN_QUANTITY", feedStatus: "PAUSED_FOR_ACTION" });
    const r = economicValueUsd18({ storedRaw: WAD, priceUsd18: WAD, decimals: 18, snap, now: 0 });
    expect(r.restrictNewRisk).toBe(true);
  });
});

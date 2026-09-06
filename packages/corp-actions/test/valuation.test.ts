import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { WAD, economicValueUsd18, mulDivDown, type CorporateActionSnapshot } from "../src/index";

/**
 * Split / reverse-split / dividend must not double-count quantity and price — invariant I-84.
 *
 * Driven by `fixtures/corporate-actions/scenarios.json`, whose 'derived' entries encode mechanics
 * from authoritative B20 / xStocks documentation.
 */

const fixtures = JSON.parse(
  readFileSync(resolve(__dirname, "../../../fixtures/corporate-actions/scenarios.json"), "utf8"),
);
const byId = (id: string) => fixtures.scenarios.find((s: { id: string }) => s.id === id);

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

describe("B20 2-for-1 split — value preserved (FACTOR_IN_PRICE)", () => {
  const f = byId("b20-2for1-split");
  const feedPrice = (sharePrice: string, factorWad: string) =>
    mulDivDown(BigInt(sharePrice), BigInt(factorWad), WAD);

  it("before and after the split, economic value is identical", () => {
    const raw = BigInt(f.rawBalance);
    const before = economicValueUsd18({
      storedRaw: raw,
      priceUsd18: feedPrice(f.before.underlyingSharePriceUsd18, f.before.factorWad),
      decimals: f.decimals,
      snap: snap({ factorWad: BigInt(f.before.factorWad), priceConvention: "FACTOR_IN_PRICE" }),
      now: 0,
    });
    const after = economicValueUsd18({
      storedRaw: raw,
      priceUsd18: feedPrice(f.after.underlyingSharePriceUsd18, f.after.factorWad),
      decimals: f.decimals,
      snap: snap({ factorWad: BigInt(f.after.factorWad), priceConvention: "FACTOR_IN_PRICE" }),
      now: 0,
    });
    expect(before.valueUsd18).toBe(BigInt(f.expectedValueBeforeUsd18));
    expect(after.valueUsd18).toBe(BigInt(f.expectedValueAfterUsd18));
    expect(before.valueUsd18).toBe(after.valueUsd18);
    expect(before.basis).toBe("RAW");
  });

  it("applying the multiplier to BOTH sides doubles the value — the defect I-84 catches", () => {
    const raw = BigInt(f.rawBalance);
    const feedPriceAfter = feedPrice(f.after.underlyingSharePriceUsd18, f.after.factorWad);
    const correct = mulDivDown(raw, feedPriceAfter, 10n ** BigInt(f.decimals));
    const scaledQty = mulDivDown(raw, BigInt(f.after.factorWad), WAD);
    const doubled = mulDivDown(scaledQty, feedPriceAfter, 10n ** BigInt(f.decimals));
    expect(doubled).toBe(correct * BigInt(f.after.factorWad) / WAD);
    expect(doubled).not.toBe(correct);
  });
});

describe("xStocks 2-for-1 reverse split — value preserved (FACTOR_IN_QUANTITY)", () => {
  const f = byId("xstocks-2for1-reverse-split");
  it("adjusted balance halves, underlying price doubles, value unchanged", () => {
    const before = economicValueUsd18({
      storedRaw: BigInt(f.before.adjustedBalance),
      priceUsd18: BigInt(f.before.underlyingSharePriceUsd18),
      decimals: f.decimals,
      snap: snap({
        accountingMode: "REBASING_BALANCE",
        priceConvention: "FACTOR_IN_QUANTITY",
        factorWad: BigInt(f.before.factorWad),
      }),
      now: 0,
    });
    const after = economicValueUsd18({
      storedRaw: BigInt(f.after.adjustedBalance),
      priceUsd18: BigInt(f.after.underlyingSharePriceUsd18),
      decimals: f.decimals,
      snap: snap({
        accountingMode: "REBASING_BALANCE",
        priceConvention: "FACTOR_IN_QUANTITY",
        factorWad: BigInt(f.after.factorWad),
      }),
      now: 0,
    });
    expect(before.valueUsd18).toBe(BigInt(f.expectedValueBeforeUsd18));
    expect(after.valueUsd18).toBe(BigInt(f.expectedValueAfterUsd18));
  });
});

describe("B20 dividend — economic value rises by the reinvestment", () => {
  const f = byId("b20-dividend-reinvested");
  it("multiplier lifts, raw unchanged, value up 1%", () => {
    const raw = BigInt(f.rawBalance);
    const price = (factorWad: string) =>
      mulDivDown(BigInt(f.before.underlyingSharePriceUsd18), BigInt(factorWad), WAD);
    const before = economicValueUsd18({
      storedRaw: raw,
      priceUsd18: price(f.before.factorWad),
      decimals: f.decimals,
      snap: snap({ factorWad: BigInt(f.before.factorWad) }),
      now: 0,
    });
    const after = economicValueUsd18({
      storedRaw: raw,
      priceUsd18: price(f.after.factorWad),
      decimals: f.decimals,
      snap: snap({ factorWad: BigInt(f.after.factorWad) }),
      now: 0,
    });
    expect(before.valueUsd18).toBe(BigInt(f.expectedValueBeforeUsd18));
    expect(after.valueUsd18).toBe(BigInt(f.expectedValueAfterUsd18));
    expect(after.valueUsd18).toBeGreaterThan(before.valueUsd18);
  });
});

describe("6-decimal token, odd multiplier — conservative rounding", () => {
  const f = byId("synthetic-6dp-token-odd-multiplier");
  it("effective and value both round down", () => {
    const r = economicValueUsd18({
      storedRaw: BigInt(f.rawBalance),
      priceUsd18: BigInt(f.priceUsd18),
      decimals: f.decimals,
      snap: snap({ priceConvention: "FACTOR_IN_QUANTITY", factorWad: BigInt(f.factorWad) }),
      now: 0,
    });
    expect(r.quantityUsed).toBe(1_333_334n);
    expect(r.valueUsd18).toBe(1_333_334_000_000_000_000n);
  });
});

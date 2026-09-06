import { describe, expect, it } from "vitest";
import { corporateActionSnapshotSchema } from "../src/corporate-action";

const WAD = "1000000000000000000";

const ok = {
  instrumentId: `0x${"11".repeat(32)}`,
  accountingMode: "EXTERNALLY_SCALED" as const,
  accountingModeVersion: 1,
  factorWad: "2000000000000000000",
  pendingFactorWad: null,
  pendingActivationAt: null,
  sourceDomain: "eip155:8453",
  sourceBlock: 12345,
  sourceEvent: "SPLIT-1",
  priceConvention: "FACTOR_IN_PRICE" as const,
  feedStatus: "LIVE" as const,
  adapterVersion: "b20/1",
  support: "TESTED_SUPPORTED" as const,
  observedAt: 1_756_900_000,
};

describe("corporateActionSnapshotSchema — spec/corporate-action-model.md §3", () => {
  it("accepts a well-formed EXTERNALLY_SCALED snapshot", () => {
    expect(corporateActionSnapshotSchema.safeParse(ok).success).toBe(true);
  });

  it("FIXED_UNIT must carry factor 1e18 and FACTOR_ABSENT", () => {
    expect(
      corporateActionSnapshotSchema.safeParse({
        ...ok,
        accountingMode: "FIXED_UNIT",
        factorWad: WAD,
        priceConvention: "FACTOR_ABSENT",
      }).success,
    ).toBe(true);
    expect(
      corporateActionSnapshotSchema.safeParse({ ...ok, accountingMode: "FIXED_UNIT", factorWad: "2" + WAD })
        .success,
    ).toBe(false);
    expect(
      corporateActionSnapshotSchema.safeParse({
        ...ok,
        accountingMode: "FIXED_UNIT",
        factorWad: WAD,
        priceConvention: "FACTOR_IN_PRICE",
      }).success,
    ).toBe(false);
  });

  it("a pending factor requires an activation time", () => {
    expect(
      corporateActionSnapshotSchema.safeParse({ ...ok, pendingFactorWad: "3" + WAD, pendingActivationAt: null })
        .success,
    ).toBe(false);
    expect(
      corporateActionSnapshotSchema.safeParse({ ...ok, pendingFactorWad: "3" + WAD, pendingActivationAt: 20000 })
        .success,
    ).toBe(true);
  });

  it("an UNSUPPORTED family cannot present a LIVE feed", () => {
    expect(
      corporateActionSnapshotSchema.safeParse({ ...ok, support: "UNSUPPORTED", feedStatus: "LIVE" }).success,
    ).toBe(false);
    expect(
      corporateActionSnapshotSchema.safeParse({ ...ok, support: "UNSUPPORTED", feedStatus: "UNKNOWN" }).success,
    ).toBe(true);
  });

  it("factorWad must be an integer string, not a float", () => {
    expect(corporateActionSnapshotSchema.safeParse({ ...ok, factorWad: "2.0" }).success).toBe(false);
  });

  it("rejects an unknown accounting mode / price convention / feed status", () => {
    expect(corporateActionSnapshotSchema.safeParse({ ...ok, accountingMode: "REBASE" }).success).toBe(false);
    expect(corporateActionSnapshotSchema.safeParse({ ...ok, priceConvention: "FACTOR_MAYBE" }).success).toBe(
      false,
    );
    expect(corporateActionSnapshotSchema.safeParse({ ...ok, feedStatus: "DOWN" }).success).toBe(false);
  });
});

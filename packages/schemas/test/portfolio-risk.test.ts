import { describe, expect, it } from "vitest";
import { portfolioRiskPolicySchema, portfolioSnapshotDigest } from "../src/portfolio-risk";

const bpsPair = (n: string, u: string) => ({ NAMED: n, UNKNOWN: u });

const ok = {
  policyId: "PORT-LAUNCH",
  version: 1,
  taxonomyVersion: "usance-risk-groups/1",
  capBps: {
    UNDERLYING: bpsPair("4000", "2500"),
    ISSUER: bpsPair("6000", "3000"),
    CUSTODY: bpsPair("6000", "3000"),
    SECTOR: bpsPair("5000", "3000"),
    LIQUIDITY: bpsPair("10000", "4000"),
  },
  sessionFactorBps: { OPEN: "10000", PRE_MARKET: "9500", POST_MARKET: "9500", CLOSED: "8000", UNKNOWN: "6000" },
  stressScenarios: [] as { id: string; haircutBps: string; appliesToGroupIds: string[]; appliesToSessions: string[] }[],
  maxCollateralInstruments: 24,
  maxStressScenarios: 8,
  effectiveAt: 1_756_900_000,
};

describe("portfolioRiskPolicySchema", () => {
  it("accepts a well-formed launch policy", () => {
    expect(portfolioRiskPolicySchema.safeParse(ok).success).toBe(true);
  });

  it("rejects an UNKNOWN cap above the NAMED cap", () => {
    const bad = structuredClone(ok);
    bad.capBps.SECTOR = bpsPair("3000", "6000");
    expect(portfolioRiskPolicySchema.safeParse(bad).success).toBe(false);
  });

  it("rejects a cap over 100%", () => {
    const bad = structuredClone(ok);
    bad.capBps.UNDERLYING = bpsPair("10001", "2500");
    expect(portfolioRiskPolicySchema.safeParse(bad).success).toBe(false);
  });

  it("rejects a session factor over 100%", () => {
    const bad = structuredClone(ok);
    bad.sessionFactorBps.OPEN = "10001";
    expect(portfolioRiskPolicySchema.safeParse(bad).success).toBe(false);
  });

  it("rejects more stress scenarios than the policy's own bound", () => {
    const bad = structuredClone(ok);
    bad.maxStressScenarios = 1;
    bad.stressScenarios = [
      { id: "a", haircutBps: "1000", appliesToGroupIds: [], appliesToSessions: [] },
      { id: "b", haircutBps: "1000", appliesToGroupIds: [], appliesToSessions: [] },
    ];
    expect(portfolioRiskPolicySchema.safeParse(bad).success).toBe(false);
  });

  it("the snapshot digest is deterministic", () => {
    const a = portfolioSnapshotDigest('{"pos":[],"pol":{}}');
    const b = portfolioSnapshotDigest('{"pos":[],"pol":{}}');
    expect(a).toBe(b);
    expect(a).toMatch(/^0x[0-9a-f]{64}$/);
  });
});

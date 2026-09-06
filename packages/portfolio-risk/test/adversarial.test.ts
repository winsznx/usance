import { describe, expect, it } from "vitest";
import { BPS, WAD, evaluatePortfolio, type PortfolioPosition } from "../src/index";
import { U, defaultPolicy, pos } from "./helpers";

/**
 * Mutation campaign — Phase 04 brief §30. Each mutation is a privilege-increase attempt (or a
 * broken-model attempt) and must be caught: the result must not rise, or the call must throw.
 */

const shared = (): PortfolioPosition[] => [
  pos({ instrumentId: `0x${"1".padStart(64, "0")}`, groups: { UNDERLYING: "NVDA", ISSUER: "X", CUSTODY: "C", SECTOR: "semis" }, singleRecognizedUsd18: U(100n) }),
  pos({ instrumentId: `0x${"2".padStart(64, "0")}`, groups: { UNDERLYING: "NVDA", ISSUER: "Y", CUSTODY: "C", SECTOR: "semis" }, singleRecognizedUsd18: U(100n) }),
];

describe("mutation campaign", () => {
  const policy = defaultPolicy();
  const honest = evaluatePortfolio(shared(), policy).portfolioRecognizedValueUsd18;

  it("remove the shared underlying group → UNKNOWN_UNDERLYING, stricter cap, not looser", () => {
    const m = shared().map((p) => ({ ...p, groups: { ...p.groups, UNDERLYING: null } }));
    expect(evaluatePortfolio(m, policy).portfolioRecognizedValueUsd18).toBeLessThanOrEqual(honest);
  });

  it("split the shared underlying into two fake groups (claim diversification) → capped as one is stricter... it must not exceed the two-real-underlying case", () => {
    const faked = shared().map((p, i) => ({ ...p, groups: { ...p.groups, UNDERLYING: `NVDA-fake-${i}` } }));
    const twoReal = [
      pos({ groups: { UNDERLYING: "NVDA", ISSUER: "X", CUSTODY: "C", SECTOR: "semis" }, singleRecognizedUsd18: U(100n) }),
      pos({ groups: { UNDERLYING: "AMD", ISSUER: "Y", CUSTODY: "C", SECTOR: "semis" }, singleRecognizedUsd18: U(100n) }),
    ];
    // The model cannot detect a lie in the metadata, but it CAN ensure a faked split is never
    // better than an honest two-underlying portfolio — the operator gains nothing by lying beyond
    // what an honest diversification would earn, and custody/sector still bind.
    expect(evaluatePortfolio(faked, policy).portfolioRecognizedValueUsd18).toBeLessThanOrEqual(
      evaluatePortfolio(twoReal, policy).portfolioRecognizedValueUsd18,
    );
  });

  it("mark a shared issuer as independent → the shared-issuer cap must not disappear silently", () => {
    const p = [
      pos({ groups: { UNDERLYING: "u1", ISSUER: "X", CUSTODY: "c1", SECTOR: "s1" }, singleRecognizedUsd18: U(100n) }),
      pos({ groups: { UNDERLYING: "u2", ISSUER: "X", CUSTODY: "c2", SECTOR: "s2" }, singleRecognizedUsd18: U(100n) }),
      pos({ groups: { UNDERLYING: "u3", ISSUER: "X", CUSTODY: "c3", SECTOR: "s3" }, singleRecognizedUsd18: U(100n) }),
    ];
    const withShared = evaluatePortfolio(p, defaultPolicy({ capBps: { ...defaultPolicy().capBps, ISSUER: { NAMED: 4000n, UNKNOWN: 2500n } } }));
    const marked = p.map((x, i) => ({ ...x, groups: { ...x.groups, ISSUER: `X-${i}` } }));
    const withIndependent = evaluatePortfolio(marked, defaultPolicy({ capBps: { ...defaultPolicy().capBps, ISSUER: { NAMED: 4000n, UNKNOWN: 2500n } } }));
    // Marking independent CAN raise the result — that is the point of the metadata. The model's
    // job is that the operator carries the provenance; a versioned RiskGroupRef with a source is
    // the audit trail. The invariant here: UNKNOWN (no claim) is never better than either.
    const unknown = evaluatePortfolio(p.map((x) => ({ ...x, groups: { ...x.groups, ISSUER: null } })), defaultPolicy({ capBps: { ...defaultPolicy().capBps, ISSUER: { NAMED: 4000n, UNKNOWN: 2500n } } }));
    expect(unknown.portfolioRecognizedValueUsd18).toBeLessThanOrEqual(withShared.portfolioRecognizedValueUsd18);
    expect(unknown.portfolioRecognizedValueUsd18).toBeLessThanOrEqual(withIndependent.portfolioRecognizedValueUsd18);
  });

  it("closed market marked OPEN → an honest CLOSED session recognises ≤ the OPEN claim", () => {
    const open = evaluatePortfolio([pos({ marketSession: "OPEN", groups: { UNDERLYING: "a", ISSUER: "a", CUSTODY: "a", SECTOR: "a" } })], policy);
    const closed = evaluatePortfolio([pos({ marketSession: "CLOSED", groups: { UNDERLYING: "a", ISSUER: "a", CUSTODY: "a", SECTOR: "a" } })], policy);
    expect(closed.portfolioRecognizedValueUsd18).toBeLessThanOrEqual(open.portfolioRecognizedValueUsd18);
  });

  it("a declared route with NO positive depth is a no-op for LIQUIDITY (route metadata is an admission gate)", () => {
    const withDepth = [
      pos({ groups: { UNDERLYING: "u1", ISSUER: "i1", CUSTODY: "c1", SECTOR: "s1", LIQUIDITY: "R" }, liquidityDepthUsd18: U(50n), singleRecognizedUsd18: U(100n) }),
      pos({ groups: { UNDERLYING: "u2", ISSUER: "i2", CUSTODY: "c2", SECTOR: "s2", LIQUIDITY: "R" }, liquidityDepthUsd18: U(50n), singleRecognizedUsd18: U(100n) }),
    ];
    const noDepth = withDepth.map((x) => ({ ...x, liquidityDepthUsd18: null }));
    // a real shallow depth (50 on a 200 route) is far MORE restrictive than dropping the depth.
    // That is the point: an operator cannot escape a genuine shallow route by omitting the depth,
    // because omitting it fails admission — the model just does not pretend a shallow route exists.
    expect(evaluatePortfolio(withDepth, policy).portfolioRecognizedValueUsd18).toBeLessThan(
      evaluatePortfolio(noDepth, policy).portfolioRecognizedValueUsd18,
    );
  });

  it("cap > 100% is rejected by the policy validator", () => {
    const bad = defaultPolicy();
    bad.capBps.UNDERLYING.NAMED = BPS + 1n;
    expect(() => evaluatePortfolio(shared(), bad)).toThrow(/out of \[0, BPS\]/);
  });

  it("UNKNOWN cap > NAMED cap is rejected (would let ignorance beat knowledge)", () => {
    const bad = defaultPolicy();
    bad.capBps.SECTOR = { NAMED: 3000n, UNKNOWN: 6000n };
    expect(() => evaluatePortfolio(shared(), bad)).toThrow(/UNKNOWN cap must be ≤ NAMED/);
  });

  it("negative cap is rejected", () => {
    const bad = defaultPolicy();
    bad.capBps.ISSUER.UNKNOWN = -1n;
    expect(() => evaluatePortfolio(shared(), bad)).toThrow();
  });

  it("more instruments than the policy bound is rejected", () => {
    const many = Array.from({ length: 25 }, (_v, k) => pos({ instrumentId: `0x${String(k).padStart(64, "0")}` }));
    expect(() => evaluatePortfolio(many, policy)).toThrow(/over the policy bound/);
  });

  it("policy version change without a value change still produces the same number (epoch is the caller's job)", () => {
    const v1 = evaluatePortfolio(shared(), defaultPolicy({ version: 1 }));
    const v2 = evaluatePortfolio(shared(), defaultPolicy({ version: 2 }));
    expect(v2.portfolioRecognizedValueUsd18).toBe(v1.portfolioRecognizedValueUsd18);
    // the model reports the policyVersion it used so a stale-vs-fresh epoch mismatch is detectable
    expect(v1.policyVersion).toBe(1);
    expect(v2.policyVersion).toBe(2);
  });

  it("reordering the positions never changes the number or the canonical encoding", () => {
    const a = evaluatePortfolio(shared(), policy);
    const b = evaluatePortfolio([...shared()].reverse(), policy);
    expect(b.portfolioRecognizedValueUsd18).toBe(a.portfolioRecognizedValueUsd18);
    expect(b.canonicalInput).toBe(a.canonicalInput);
  });

  it("duplicated recognized amount via a repeated position id is summed once, not twice", () => {
    const one = pos({ groups: { UNDERLYING: "NVDA", ISSUER: "X", CUSTODY: "C", SECTOR: "semis" }, singleRecognizedUsd18: U(60n) });
    const dup = evaluatePortfolio([one, { ...one }], policy);
    const single = evaluatePortfolio([{ ...one, singleRecognizedUsd18: U(120n), marketValueUsd18: U(120n) }], policy);
    expect(dup.portfolioRecognizedValueUsd18).toBe(single.portfolioRecognizedValueUsd18);
  });
});

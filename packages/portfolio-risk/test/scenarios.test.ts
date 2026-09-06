import { describe, expect, it } from "vitest";
import { evaluatePortfolio } from "../src/index";
import { U, defaultPolicy, pos } from "./helpers";

/**
 * Scenario matrix — `spec/portfolio-risk-model.md`, Phase 04 brief §31.
 *
 * The launch policy caps the portfolio share of each underlying at 40%, issuer/custody at 60%,
 * sector at 50%. Small portfolios are conservatively capped on purpose (spec §4): a portfolio
 * that is not diversified does not get portfolio-scale recognition. The model still distinguishes
 * KINDS of concentration.
 */

describe("A. single instrument — a one-name portfolio caps itself to the underlying cap", () => {
  it("recognised == base × 40%, binding = UNDERLYING (matches risk-model.md §5)", () => {
    const r = evaluatePortfolio([pos({ singleRecognizedUsd18: U(100n) })], defaultPolicy());
    expect(r.portfolioRecognizedValueUsd18).toBe(U(40n));
    expect(r.bindingConstraint).toBe("UNDERLYING");
  });
});

describe("B. two instruments, different in every dimension", () => {
  it("50/50 each > the 40% underlying cap → each scaled to 40% → total 160, ≤ sum", () => {
    const r = evaluatePortfolio([pos(), pos()], defaultPolicy());
    expect(r.portfolioRecognizedValueUsd18).toBe(U(160n));
    expect(r.singleAssetRecognizedTotalUsd18).toBe(U(200n));
    expect(r.portfolioRecognizedValueUsd18).toBeLessThan(r.singleAssetRecognizedTotalUsd18);
  });
});

describe("C. same underlying, different wrappers — no diversification (I-89, constraint 13)", () => {
  it("NVDA B20 + NVDA xStock are ONE underlying group of 200 → scaled to 40% → 80", () => {
    const positions = [
      pos({ groups: { UNDERLYING: "NVDA", ISSUER: "coinbase", CUSTODY: "cust-a", SECTOR: "semis" }, homeDomain: "eip155:8453", singleRecognizedUsd18: U(100n) }),
      pos({ groups: { UNDERLYING: "NVDA", ISSUER: "backed", CUSTODY: "cust-b", SECTOR: "semis" }, homeDomain: "eip155:1952", singleRecognizedUsd18: U(100n) }),
    ];
    const r = evaluatePortfolio(positions, defaultPolicy());
    expect(r.portfolioRecognizedValueUsd18).toBe(U(80n));
    expect(r.bindingConstraint).toBe("UNDERLYING");
  });

  it("two DIFFERENT underlyings recognise strictly more than two wrappers of one", () => {
    const same = evaluatePortfolio(
      [
        pos({ groups: { UNDERLYING: "NVDA", ISSUER: "i1", CUSTODY: "c1", SECTOR: "sX" }, singleRecognizedUsd18: U(100n) }),
        pos({ groups: { UNDERLYING: "NVDA", ISSUER: "i2", CUSTODY: "c2", SECTOR: "sY" }, singleRecognizedUsd18: U(100n) }),
      ],
      defaultPolicy(),
    );
    const diff = evaluatePortfolio(
      [
        pos({ groups: { UNDERLYING: "NVDA", ISSUER: "i1", CUSTODY: "c1", SECTOR: "sX" }, singleRecognizedUsd18: U(100n) }),
        pos({ groups: { UNDERLYING: "AAPL", ISSUER: "i2", CUSTODY: "c2", SECTOR: "sY" }, singleRecognizedUsd18: U(100n) }),
      ],
      defaultPolicy(),
    );
    expect(diff.portfolioRecognizedValueUsd18).toBeGreaterThan(same.portfolioRecognizedValueUsd18);
  });
});

describe("D. same issuer, different underlying — issuer risk retained, underlying diversified", () => {
  it("AAPL + NVDA + GOOGL from one issuer: issuer group 300 → 60% cap → 180", () => {
    const positions = ["AAPL", "NVDA", "GOOGL"].map((u, k) =>
      pos({
        instrumentId: `0x${"a".repeat(63)}${k}`,
        groups: { UNDERLYING: u, ISSUER: "issuerX", CUSTODY: `cu-${k}`, SECTOR: `sec-${k}` },
        singleRecognizedUsd18: U(100n),
      }),
    );
    const r = evaluatePortfolio(positions, defaultPolicy());
    // underlying: each 100 = 33% < 40% → ok. issuer issuerX 300 → 60% → 180.
    expect(r.portfolioRecognizedValueUsd18).toBe(U(180n));
    expect(r.bindingConstraint).toBe("ISSUER");
  });
});

describe("E. same custodian, different issuers — shared custody risk retained (constraint 15)", () => {
  it("issuer X + issuer Y both custodian C: custody group 200 → 60% cap → 120", () => {
    const positions = [
      pos({ groups: { UNDERLYING: "u1", ISSUER: "X", CUSTODY: "C", SECTOR: "s1" }, singleRecognizedUsd18: U(100n) }),
      pos({ groups: { UNDERLYING: "u2", ISSUER: "Y", CUSTODY: "C", SECTOR: "s2" }, singleRecognizedUsd18: U(100n) }),
    ];
    const r = evaluatePortfolio(positions, defaultPolicy());
    // underlying groups are 100 each → allowed 80 → scale 0.8. custody C = 200 → allowed 120 →
    // scale 0.6. min per position = 0.6 → 120. Custody is the binding constraint.
    expect(r.portfolioRecognizedValueUsd18).toBe(U(120n));
    expect(r.bindingConstraint).toBe("CUSTODY");
  });

  it("with more names so underlying is not binding, shared custody becomes the constraint", () => {
    const positions = [
      pos({ groups: { UNDERLYING: "u1", ISSUER: "X", CUSTODY: "C", SECTOR: "s1" }, singleRecognizedUsd18: U(100n) }),
      pos({ groups: { UNDERLYING: "u2", ISSUER: "Y", CUSTODY: "C", SECTOR: "s2" }, singleRecognizedUsd18: U(100n) }),
      pos({ groups: { UNDERLYING: "u3", ISSUER: "Z", CUSTODY: "D", SECTOR: "s3" }, singleRecognizedUsd18: U(100n) }),
    ];
    const r = evaluatePortfolio(positions, defaultPolicy());
    // underlying each 33% ok. custody C = 200 of 300 = 67% > 60% → the two C positions scale to 0.9.
    expect(r.bindingConstraint).toBe("CUSTODY");
    expect(r.portfolioRecognizedValueUsd18).toBeLessThan(U(300n));
  });
});

describe("F. same sector, different underlying (constraint 13)", () => {
  it("distinguishes underlying diversification from sector concentration", () => {
    const positions = [
      pos({ groups: { UNDERLYING: "NVDA", ISSUER: "i1", CUSTODY: "c1", SECTOR: "semis" }, singleRecognizedUsd18: U(100n) }),
      pos({ groups: { UNDERLYING: "AMD", ISSUER: "i2", CUSTODY: "c2", SECTOR: "semis" }, singleRecognizedUsd18: U(100n) }),
    ];
    const r = evaluatePortfolio(positions, defaultPolicy());
    // NVDA group 100 → allowed 80 → scale 0.8. AMD group 100 → 0.8. sector semis 200 → allowed 100
    // → scale 0.5. Per position min = 0.5 → 100. Sector is the binding constraint (reduces more).
    expect(r.portfolioRecognizedValueUsd18).toBe(U(100n));
    expect(r.bindingConstraint).toBe("SECTOR");
  });
});

describe("G. highly concentrated portfolio — the tightest cap binds, min not product", () => {
  it("one underlying, one issuer, one sector, 4 wrappers: min(0.4, 0.6, 0.6, 0.5) = 0.4 → 160", () => {
    const positions = Array.from({ length: 4 }, (_v, k) =>
      pos({
        instrumentId: `0x${"c".repeat(63)}${k}`,
        groups: { UNDERLYING: "NVDA", ISSUER: "X", CUSTODY: "C", SECTOR: "semis" },
        singleRecognizedUsd18: U(100n),
      }),
    );
    const r = evaluatePortfolio(positions, defaultPolicy());
    expect(r.portfolioRecognizedValueUsd18).toBe(U(160n));
    expect(r.bindingConstraint).toBe("UNDERLYING");
  });
});

describe("H. diversified but illiquid — shared liquidity route (constraint 16)", () => {
  it("positions competing for one shallow route are capped at the route depth", () => {
    const positions = [
      pos({ groups: { UNDERLYING: "u1", ISSUER: "i1", CUSTODY: "c1", SECTOR: "s1", LIQUIDITY: "route-Z" }, liquidityDepthUsd18: U(120n), singleRecognizedUsd18: U(80n) }),
      pos({ groups: { UNDERLYING: "u2", ISSUER: "i2", CUSTODY: "c2", SECTOR: "s2", LIQUIDITY: "route-Z" }, liquidityDepthUsd18: U(120n), singleRecognizedUsd18: U(80n) }),
      pos({ groups: { UNDERLYING: "u3", ISSUER: "i3", CUSTODY: "c3", SECTOR: "s3" }, singleRecognizedUsd18: U(80n) }),
    ];
    const r = evaluatePortfolio(positions, defaultPolicy());
    // route-Z total 160, depth 120 → allowed 120 → the two route-Z positions scale to 0.75.
    expect(r.bindingConstraint).toBe("LIQUIDITY");
    expect(r.portfolioRecognizedValueUsd18).toBeLessThan(U(240n));
  });

  it("a declared route with NO observed depth is treated as UNKNOWN, not as a reliable route", () => {
    const positions = [
      pos({ groups: { UNDERLYING: "u1", ISSUER: "i1", CUSTODY: "c1", SECTOR: "s1", LIQUIDITY: "route-Q" }, liquidityDepthUsd18: null, singleRecognizedUsd18: U(50n) }),
      pos({ groups: { UNDERLYING: "u2", ISSUER: "i2", CUSTODY: "c2", SECTOR: "s2", LIQUIDITY: "route-Q" }, liquidityDepthUsd18: null, singleRecognizedUsd18: U(50n) }),
    ];
    const r = evaluatePortfolio(positions, defaultPolicy());
    // no positive depth → the LIQUIDITY dimension is a no-op for these positions (route metadata
    // is an admission requirement, not a silent zero). underlying u1/u2 each 50% > 40% → 80.
    expect(r.portfolioRecognizedValueUsd18).toBe(U(80n));
    expect(r.bindingConstraint).toBe("UNDERLYING");
  });
});

describe("I. mixed market-session states (constraint 17)", () => {
  it("CLOSED and UNKNOWN sessions reduce; OPEN does not; unknown is the harshest", () => {
    const positions = [
      pos({ marketSession: "OPEN", groups: { UNDERLYING: "a", ISSUER: "a", CUSTODY: "a", SECTOR: "a" }, singleRecognizedUsd18: U(100n) }),
      pos({ marketSession: "CLOSED", groups: { UNDERLYING: "b", ISSUER: "b", CUSTODY: "b", SECTOR: "b" }, singleRecognizedUsd18: U(100n) }),
      pos({ marketSession: "UNKNOWN", groups: { UNDERLYING: "c", ISSUER: "c", CUSTODY: "c", SECTOR: "c" }, singleRecognizedUsd18: U(100n) }),
    ];
    const r = evaluatePortfolio(positions, defaultPolicy());
    // each 33% underlying ok. session: 100 + 100*0.8 + 100*0.6 = 240.
    expect(r.portfolioRecognizedValueUsd18).toBe(U(240n));
    expect(r.bindingConstraint).toBe("SESSION");
  });
});

describe("J. unknown metadata is conservative — I-89", () => {
  it("dropping the underlying group → UNKNOWN_UNDERLYING with the stricter 25% cap", () => {
    const known = evaluatePortfolio(
      [
        pos({ groups: { UNDERLYING: "u1", ISSUER: "i1", CUSTODY: "c1", SECTOR: "s1" }, singleRecognizedUsd18: U(100n) }),
        pos({ groups: { UNDERLYING: "u2", ISSUER: "i2", CUSTODY: "c2", SECTOR: "s2" }, singleRecognizedUsd18: U(100n) }),
      ],
      defaultPolicy(),
    );
    const unknown = evaluatePortfolio(
      [
        pos({ groups: { UNDERLYING: null, ISSUER: "i1", CUSTODY: "c1", SECTOR: "s1" }, singleRecognizedUsd18: U(100n) }),
        pos({ groups: { UNDERLYING: null, ISSUER: "i2", CUSTODY: "c2", SECTOR: "s2" }, singleRecognizedUsd18: U(100n) }),
      ],
      defaultPolicy(),
    );
    expect(unknown.portfolioRecognizedValueUsd18).toBeLessThan(known.portfolioRecognizedValueUsd18);
    expect(unknown.portfolioRecognizedValueUsd18).toBe(U(50n)); // 200 × 2500/10000
  });
});

describe("K. corporate action enters through the single-asset path only", () => {
  it("a changed effective quantity is just a changed singleRecognizedUsd18 input", () => {
    const before = evaluatePortfolio([pos({ singleRecognizedUsd18: U(100n) })], defaultPolicy());
    const afterSplit = evaluatePortfolio([pos({ singleRecognizedUsd18: U(200n) })], defaultPolicy());
    expect(afterSplit.portfolioRecognizedValueUsd18).toBe(before.portfolioRecognizedValueUsd18 * 2n);
  });
});

describe("L / M. portfolio worsens or improves after debt exists — I-92", () => {
  it("the result carries only recognised value; there is no debt field to rewrite", () => {
    const r = evaluatePortfolio([pos()], defaultPolicy());
    expect(Object.keys(r)).not.toContain("debtUsd18");
    expect(Object.keys(r)).not.toContain("borrowRateBps");
  });
});

describe("N / O. exact boundary and one unit around a cap — no cliff (I-93)", () => {
  it("at the cap: no reduction; one wei over: sub-dollar reduction", () => {
    const p = defaultPolicy();
    const atCap = evaluatePortfolio(
      [
        pos({ groups: { UNDERLYING: "NVDA", ISSUER: "i1", CUSTODY: "c1", SECTOR: "s1" }, singleRecognizedUsd18: U(40n) }),
        pos({ groups: { UNDERLYING: "AAPL", ISSUER: "i2", CUSTODY: "c2", SECTOR: "s2" }, singleRecognizedUsd18: U(30n) }),
        pos({ groups: { UNDERLYING: "GOOG", ISSUER: "i3", CUSTODY: "c3", SECTOR: "s3" }, singleRecognizedUsd18: U(30n) }),
      ],
      p,
    );
    // base 100; NVDA 40 = exactly 40% → no reduction
    expect(atCap.portfolioRecognizedValueUsd18).toBe(U(100n));

    const oneOver = evaluatePortfolio(
      [
        pos({ groups: { UNDERLYING: "NVDA", ISSUER: "i1", CUSTODY: "c1", SECTOR: "s1" }, singleRecognizedUsd18: U(40n) + 1n }),
        pos({ groups: { UNDERLYING: "AAPL", ISSUER: "i2", CUSTODY: "c2", SECTOR: "s2" }, singleRecognizedUsd18: U(30n) }),
        pos({ groups: { UNDERLYING: "GOOG", ISSUER: "i3", CUSTODY: "c3", SECTOR: "s3" }, singleRecognizedUsd18: U(30n) }),
      ],
      p,
    );
    const drop = U(100n) + 1n - oneOver.portfolioRecognizedValueUsd18;
    expect(drop).toBeLessThan(U(1n));
    expect(drop).toBeGreaterThanOrEqual(0n);
  });
});

describe("P. duplicate instrument input — I-91", () => {
  it("the same instrumentId twice is summed, not double-counted", () => {
    const same = pos({ groups: { UNDERLYING: "NVDA", ISSUER: "X", CUSTODY: "C", SECTOR: "semis" }, singleRecognizedUsd18: U(50n) });
    const r = evaluatePortfolio([same, { ...same }], defaultPolicy());
    expect(r.positions).toHaveLength(1);
    expect(r.singleAssetRecognizedTotalUsd18).toBe(U(100n));
    expect(r.portfolioRecognizedValueUsd18).toBe(U(40n)); // one NVDA group of 100 → 40% cap
  });

  it("a duplicate instrumentId with conflicting metadata is rejected", () => {
    const a = pos({ groups: { UNDERLYING: "NVDA", ISSUER: "X", CUSTODY: "C", SECTOR: "semis" } });
    const b = { ...a, groups: { ...a.groups, SECTOR: "tech" } };
    expect(() => evaluatePortfolio([a, b], defaultPolicy())).toThrow(/conflicting risk metadata/);
  });
});

describe("explainability — §5", () => {
  it("names the binding constraint and the over-cap groups, not just a number", () => {
    const r = evaluatePortfolio(
      [
        pos({ groups: { UNDERLYING: "NVDA", ISSUER: "X", CUSTODY: "C1", SECTOR: "semis" }, singleRecognizedUsd18: U(100n) }),
        pos({ groups: { UNDERLYING: "NVDA", ISSUER: "Y", CUSTODY: "C2", SECTOR: "semis" }, singleRecognizedUsd18: U(100n) }),
      ],
      defaultPolicy(),
    );
    expect(r.bindingConstraint).toBe("UNDERLYING");
    const underlying = r.constraintBreakdown.find((b) => b.kind === "UNDERLYING")!;
    expect(underlying.standaloneReductionUsd18).toBeGreaterThan(0n);
    expect(underlying.bindingGroups).toContain("NVDA");
    expect(r.positions.every((p) => p.bindingDimension === "UNDERLYING")).toBe(true);
  });
});

describe("stress scenarios (constraint 8 / 23) — deterministic, never a positive effect", () => {
  it("a named scenario haircuts matching positions; the result is the min of stressed vs unstressed", () => {
    const policy = defaultPolicy({
      stressScenarios: [{ id: "SEMIS-SHOCK", haircutBps: 3000n, appliesToGroupIds: ["semis"], appliesToSessions: [] }],
    });
    const positions = [
      pos({ groups: { UNDERLYING: "NVDA", ISSUER: "i1", CUSTODY: "c1", SECTOR: "semis" }, singleRecognizedUsd18: U(100n) }),
      pos({ groups: { UNDERLYING: "SPY", ISSUER: "i2", CUSTODY: "c2", SECTOR: "index" }, singleRecognizedUsd18: U(100n) }),
    ];
    const withStress = evaluatePortfolio(positions, policy);
    const noStress = evaluatePortfolio(positions, defaultPolicy());
    expect(withStress.portfolioRecognizedValueUsd18).toBeLessThan(noStress.portfolioRecognizedValueUsd18);
  });

  it("a stress scenario can never increase the result", () => {
    const positions = [pos(), pos(), pos()];
    const noStress = evaluatePortfolio(positions, defaultPolicy());
    const withStress = evaluatePortfolio(
      positions,
      defaultPolicy({ stressScenarios: [{ id: "X", haircutBps: 5000n, appliesToGroupIds: [], appliesToSessions: ["OPEN"] }] }),
    );
    expect(withStress.portfolioRecognizedValueUsd18).toBeLessThanOrEqual(noStress.portfolioRecognizedValueUsd18);
  });
});

describe("snapshot reproducibility — §7", () => {
  it("the canonical input encoding is stable and order-independent", () => {
    const a = [pos({ instrumentId: "0x1" }), pos({ instrumentId: "0x2" })];
    const r1 = evaluatePortfolio(a, defaultPolicy());
    const r2 = evaluatePortfolio([...a].reverse(), defaultPolicy());
    expect(r1.canonicalInput).toBe(r2.canonicalInput);
    expect(r1.canonicalInput.length).toBeGreaterThan(10);
  });
});

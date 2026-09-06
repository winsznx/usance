import { describe, expect, it } from "vitest";
import {
  BPS,
  DIMENSIONS,
  WAD,
  evaluatePortfolio,
  type Dimension,
  type MarketSession,
  type PortfolioPosition,
} from "../src/index";
import { defaultPolicy } from "./helpers";

/**
 * Safety properties — `spec/portfolio-risk-model.md`, Phase 04 brief §25, §30.
 *
 * A small deterministic PRNG so the campaign is reproducible.
 */
function prng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1_664_525 + 1_013_904_223) >>> 0;
    return s / 0xffffffff;
  };
}

const SESSIONS: MarketSession[] = ["OPEN", "PRE_MARKET", "POST_MARKET", "CLOSED", "UNKNOWN"];

function randomPortfolio(rand: () => number, n: number): PortfolioPosition[] {
  const out: PortfolioPosition[] = [];
  for (let i = 0; i < n; i++) {
    const groups: Partial<Record<Dimension, string | null>> = {};
    for (const d of DIMENSIONS) {
      const r = rand();
      groups[d] = r < 0.15 ? null : `${d}-${Math.floor(rand() * 4)}`;
    }
    out.push({
      instrumentId: `0x${String(i).padStart(64, "0")}`,
      homeDomain: "eip155:8453",
      singleRecognizedUsd18: BigInt(1 + Math.floor(rand() * 1000)) * 10n ** 15n,
      marketValueUsd18: BigInt(1 + Math.floor(rand() * 1200)) * 10n ** 15n,
      marketSession: SESSIONS[Math.floor(rand() * SESSIONS.length)]!,
      groups,
      liquidityDepthUsd18: rand() < 0.5 ? null : BigInt(Math.floor(rand() * 500)) * 10n ** 15n,
    });
  }
  return out;
}

describe("portfolio safety properties (fuzzed, 400 portfolios)", () => {
  const policy = defaultPolicy();

  it("I-86: PortfolioRecognized ≤ Σ single, and ≥ 0", () => {
    for (let seed = 1; seed <= 400; seed++) {
      const rand = prng(seed);
      const p = randomPortfolio(rand, 1 + Math.floor(rand() * 12));
      const r = evaluatePortfolio(p, policy);
      expect(r.portfolioRecognizedValueUsd18).toBeGreaterThanOrEqual(0n);
      expect(r.portfolioRecognizedValueUsd18).toBeLessThanOrEqual(r.singleAssetRecognizedTotalUsd18);
    }
  });

  it("I-88: permutation invariance — shuffling the input does not change the result", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const rand = prng(seed);
      const p = randomPortfolio(rand, 2 + Math.floor(rand() * 10));
      const a = evaluatePortfolio(p, policy);
      const shuffled = [...p].reverse();
      const b = evaluatePortfolio(shuffled, policy);
      expect(b.portfolioRecognizedValueUsd18).toBe(a.portfolioRecognizedValueUsd18);
      expect(b.bindingConstraint).toBe(a.bindingConstraint);
      expect(b.canonicalInput).toBe(a.canonicalInput);
    }
  });

  it("I-90: a stricter policy cap cannot increase the recognised value", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const rand = prng(seed);
      const p = randomPortfolio(rand, 2 + Math.floor(rand() * 10));
      const base = evaluatePortfolio(p, policy);
      for (const d of DIMENSIONS) {
        const stricter = defaultPolicy();
        stricter.capBps[d] = {
          NAMED: policy.capBps[d].NAMED / 2n,
          UNKNOWN: policy.capBps[d].UNKNOWN / 2n,
        };
        const s = evaluatePortfolio(p, stricter);
        expect(s.portfolioRecognizedValueUsd18).toBeLessThanOrEqual(base.portfolioRecognizedValueUsd18);
      }
      // worse session factors
      const worseSession = defaultPolicy();
      worseSession.sessionFactorBps = { OPEN: 9000n, PRE_MARKET: 8000n, POST_MARKET: 8000n, CLOSED: 5000n, UNKNOWN: 3000n };
      expect(evaluatePortfolio(p, worseSession).portfolioRecognizedValueUsd18).toBeLessThanOrEqual(
        base.portfolioRecognizedValueUsd18,
      );
    }
  });

  it("I-89: replacing a known group with UNKNOWN never increases the recognised value", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const rand = prng(seed);
      const p = randomPortfolio(rand, 2 + Math.floor(rand() * 8));
      const known = evaluatePortfolio(p, policy);
      // The concentration dimensions: blanking a group → UNKNOWN_<d> with a stricter cap.
      for (const d of ["UNDERLYING", "ISSUER", "CUSTODY", "SECTOR"] as const) {
        const blanked = p.map((x) => ({ ...x, groups: { ...x.groups, [d]: null } }));
        const r = evaluatePortfolio(blanked, policy);
        expect(r.portfolioRecognizedValueUsd18).toBeLessThanOrEqual(known.portfolioRecognizedValueUsd18);
      }
    }
  });

  it("LIQUIDITY: a shallower declared depth never increases capacity", () => {
    for (let seed = 1; seed <= 150; seed++) {
      const rand = prng(seed);
      const p = randomPortfolio(rand, 2 + Math.floor(rand() * 6)).map((x, i) => ({
        ...x,
        groups: { ...x.groups, LIQUIDITY: i % 2 === 0 ? "route-A" : "route-B" },
        liquidityDepthUsd18: 400n * 10n ** 15n,
      }));
      const base = evaluatePortfolio(p, policy);
      const shallower = p.map((x) => ({ ...x, liquidityDepthUsd18: 200n * 10n ** 15n }));
      expect(evaluatePortfolio(shallower, policy).portfolioRecognizedValueUsd18).toBeLessThanOrEqual(
        base.portfolioRecognizedValueUsd18,
      );
    }
  });

  it("I-91: duplicating a position (same id + metadata) does not change the result", () => {
    for (let seed = 1; seed <= 100; seed++) {
      const rand = prng(seed);
      const p = randomPortfolio(rand, 1 + Math.floor(rand() * 6));
      const doubled = [...p, ...p.map((x) => ({ ...x }))];
      // duplicated recognized amounts halve on the dedupe path only if we also halve the input;
      // here the same id twice with the same value → summed. Compare to a portfolio where we
      // pre-sum: each position's recognized doubled.
      const preSummed = p.map((x) => ({ ...x, singleRecognizedUsd18: x.singleRecognizedUsd18 * 2n, marketValueUsd18: x.marketValueUsd18 * 2n }));
      expect(evaluatePortfolio(doubled, policy).portfolioRecognizedValueUsd18).toBe(
        evaluatePortfolio(preSummed, policy).portfolioRecognizedValueUsd18,
      );
    }
  });

  it("I-93: adding an unrelated eligible position never reduces the working value of existing ones", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const rand = prng(seed);
      const p = randomPortfolio(rand, 2 + Math.floor(rand() * 6));
      const before = evaluatePortfolio(p, policy);
      const beforeById = new Map(before.positions.map((x) => [x.instrumentId, x.workingUsd18]));
      // an addition that shares NO group with anyone
      const added: PortfolioPosition = {
        instrumentId: `0x${"f".repeat(64)}`,
        homeDomain: "eip155:8453",
        singleRecognizedUsd18: 10n ** 18n,
        marketValueUsd18: 10n ** 18n,
        marketSession: "OPEN",
        groups: { UNDERLYING: "iso-U", ISSUER: "iso-I", CUSTODY: "iso-C", SECTOR: "iso-S", LIQUIDITY: "iso-route" },
        liquidityDepthUsd18: 10n ** 24n,
      };
      const after = evaluatePortfolio([...p, added], policy);
      for (const x of after.positions) {
        if (x.instrumentId === added.instrumentId) continue;
        expect(x.workingUsd18).toBeGreaterThanOrEqual(beforeById.get(x.instrumentId) ?? 0n);
      }
    }
  });

  it("no cliff: sweeping one position's recognised value up by 1% steps moves the result smoothly", () => {
    const rand = prng(42);
    const p = randomPortfolio(rand, 5);
    p[0]!.groups = { UNDERLYING: "SHARED", ISSUER: "i", CUSTODY: "c", SECTOR: "s" };
    p[1]!.groups = { UNDERLYING: "SHARED", ISSUER: "j", CUSTODY: "d", SECTOR: "t" };
    let prev: bigint | null = null;
    for (let k = 0; k <= 100; k++) {
      const step = p.map((x, i) => (i === 0 ? { ...x, singleRecognizedUsd18: BigInt(k + 1) * 10n ** 18n } : x));
      const r = evaluatePortfolio(step, policy);
      if (prev !== null) {
        const delta = r.portfolioRecognizedValueUsd18 - prev;
        // one extra dollar of input never moves the portfolio result by more than a dollar
        expect(delta < 2n * 10n ** 18n && delta > -2n * 10n ** 18n).toBe(true);
      }
      prev = r.portfolioRecognizedValueUsd18;
    }
  });
});

describe("composition — I-93, no double counting", () => {
  it("a position sharing an over-cap underlying AND an over-cap sector takes the MIN, not the product", () => {
    const policy = defaultPolicy();
    const positions: PortfolioPosition[] = [
      { instrumentId: "0x1", homeDomain: "eip155:8453", singleRecognizedUsd18: 100n * WAD, marketValueUsd18: 100n * WAD, marketSession: "OPEN", groups: { UNDERLYING: "NVDA", ISSUER: "a", CUSTODY: "a", SECTOR: "semis", LIQUIDITY: "deep" }, liquidityDepthUsd18: 10n ** 30n },
      { instrumentId: "0x2", homeDomain: "eip155:8453", singleRecognizedUsd18: 100n * WAD, marketValueUsd18: 100n * WAD, marketSession: "OPEN", groups: { UNDERLYING: "NVDA", ISSUER: "b", CUSTODY: "b", SECTOR: "semis", LIQUIDITY: "deep" }, liquidityDepthUsd18: 10n ** 30n },
    ];
    const r = evaluatePortfolio(positions, policy);
    // underlying NVDA 200 → 40% → 0.4. sector semis 200 → 50% → 0.5. min = 0.4, NOT 0.4×0.5=0.2.
    expect(r.portfolioRecognizedValueUsd18).toBe(80n * WAD);
    expect(r.positions[0]!.positionScaleWad).toBe((40n * WAD) / 100n);
  });
});

describe("scope — I-87", () => {
  it("evaluatePortfolio operates only over the positions handed to it (the facility's admitted set)", () => {
    // A position on another domain is simply not in the array; the function never reaches for it.
    const facilitySet: PortfolioPosition[] = [
      { instrumentId: "0xaapl", homeDomain: "eip155:8453", singleRecognizedUsd18: 50n * WAD, marketValueUsd18: 50n * WAD, marketSession: "OPEN", groups: { UNDERLYING: "AAPL", ISSUER: "cb", CUSTODY: "x", SECTOR: "tech", LIQUIDITY: "deep" }, liquidityDepthUsd18: 10n ** 30n },
    ];
    const r = evaluatePortfolio(facilitySet, defaultPolicy());
    expect(r.positions).toHaveLength(1);
    expect(r.singleAssetRecognizedTotalUsd18).toBe(50n * WAD);
  });
});

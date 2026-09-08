/**
 * Portfolio-risk differential fixtures — Solidity `PortfolioRiskEngine` ⇔ the frozen TS reference
 * `packages/portfolio-risk/src/evaluate.ts`. Mirrors `scripts/gen_fixtures.py` for RiskMath.
 *
 *   node scripts/gen_portfolio_fixtures.mjs           # writes fixtures/portfolio/portfolio-scenarios.json
 *
 * `make test-differential` regenerates this and byte-compares against the committed file, then runs
 * `contracts/test/base/PortfolioRiskConformance.t.sol` which evaluates the same scenarios in
 * Solidity and asserts `portfolioRecognizedValueUsd18` (and every position's working value) match
 * wei-for-wei (I-116).
 *
 * The TS reference keys groups by string; on-chain they are bytes32. This generator emits the
 * canonical mapping: a non-empty group string → `keccak256(utf8(string))`, empty/absent → 0x0…0.
 * Sessions: OPEN 0, PRE_MARKET 1, POST_MARKET 2, CLOSED 3, UNKNOWN 4.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { keccak256, toBytes } from "viem";

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(here, "../fixtures/portfolio/portfolio-scenarios.json");
const PKG = path.resolve(here, "../packages/portfolio-risk");
fs.mkdirSync(path.dirname(OUT), { recursive: true });

// Compile the frozen TS reference to a throwaway CJS `dist/` and load it — the fixture MUST come
// from `packages/portfolio-risk/src/evaluate.ts` unchanged (I-116), never a re-transcription.
fs.rmSync(path.join(PKG, "dist"), { recursive: true, force: true });
execFileSync(
  "pnpm",
  ["exec", "tsc", "src/index.ts", "src/evaluate.ts", "src/types.ts", "--outDir", "dist", "--target",
    "es2022", "--module", "commonjs", "--moduleResolution", "node", "--skipLibCheck", "--declaration", "false"],
  { cwd: PKG, stdio: "inherit" },
);
fs.writeFileSync(path.join(PKG, "dist/package.json"), '{"type":"commonjs"}\n');
const { evaluatePortfolio } = createRequire(import.meta.url)(path.join(PKG, "dist/evaluate.js"));

const WAD = 1_000_000_000_000_000_000n;
const BPS = 10_000n;
const DIMS = ["UNDERLYING", "ISSUER", "CUSTODY", "SECTOR", "LIQUIDITY"];
const SESSIONS = ["OPEN", "PRE_MARKET", "POST_MARKET", "CLOSED", "UNKNOWN"];
const U = (n) => n * WAD;
const g32 = (s) => (s === undefined || s === null || s === "" ? `0x${"0".repeat(64)}` : keccak256(toBytes(s)));
const idHex = (() => {
  let n = 0;
  return () => `0x${(++n).toString(16).padStart(64, "0")}`;
})();

/** A CANARY_PROVISIONAL-shaped policy (matches `spec/base-portfolio-facility-model.md §11`). */
function policy(over = {}) {
  const base = {
    policyId: "BASE-CANARY",
    version: 1,
    taxonomyVersion: "usance-risk-groups/1",
    capBps: {
      UNDERLYING: { NAMED: 3500n, UNKNOWN: 1500n },
      ISSUER: { NAMED: 5000n, UNKNOWN: 2000n },
      CUSTODY: { NAMED: 5000n, UNKNOWN: 2000n },
      SECTOR: { NAMED: 4000n, UNKNOWN: 1500n },
      LIQUIDITY: { NAMED: 6000n, UNKNOWN: 6000n },
    },
    sessionFactorBps: { OPEN: 10000n, PRE_MARKET: 7500n, POST_MARKET: 7500n, CLOSED: 5000n, UNKNOWN: 3000n },
    stressScenarios: [],
    maxCollateralInstruments: 8,
    maxStressScenarios: 8,
  };
  return { ...base, ...over, capBps: { ...base.capBps, ...(over.capBps ?? {}) } };
}

function pos(over = {}) {
  const id = over.instrumentId ?? idHex();
  const n = id.slice(-6);
  const d = {
    instrumentId: id,
    homeDomain: "eip155:84532",
    singleRecognizedUsd18: U(100n),
    marketValueUsd18: U(100n),
    marketSession: "OPEN",
    groups: { UNDERLYING: `u-${n}`, ISSUER: `i-${n}`, CUSTODY: `cu-${n}`, SECTOR: `s-${n}`, LIQUIDITY: `r-${n}` },
    liquidityDepthUsd18: U(10_000_000n),
  };
  return { ...d, ...over, instrumentId: id, groups: over.groups ? { ...d.groups, ...over.groups } : d.groups };
}

// ---- scenarios: §23 A–M plus the monotonicity / stress cases ----
const scenarios = [];
const add = (name, positions, pol) => scenarios.push({ name, positions, policy: pol ?? policy() });

// A. one stock — a single-underlying portfolio caps itself to UNDERLYING NAMED
add("A_single_instrument", [pos({ singleRecognizedUsd18: U(400n), marketValueUsd18: U(500n) })]);

// B. two independent underlyings
add("B_two_independent_underlyings", [
  pos({ groups: { UNDERLYING: "NVDA", ISSUER: "coinbase", CUSTODY: "cb-custody", SECTOR: "semis" }, singleRecognizedUsd18: U(300n) }),
  pos({ groups: { UNDERLYING: "AAPL", ISSUER: "coinbase", CUSTODY: "cb-custody", SECTOR: "megacap-tech" }, singleRecognizedUsd18: U(300n) }),
]);

// C. same underlying twice (two wrappers of NVIDIA are 2× NVIDIA)
add("C_same_underlying_two_wrappers", [
  pos({ groups: { UNDERLYING: "NVDA" }, singleRecognizedUsd18: U(300n) }),
  pos({ groups: { UNDERLYING: "NVDA" }, singleRecognizedUsd18: U(300n) }),
]);

// D. same issuer / multiple stocks
add("D_same_issuer", [
  pos({ groups: { UNDERLYING: "NVDA", ISSUER: "coinbase" }, singleRecognizedUsd18: U(400n) }),
  pos({ groups: { UNDERLYING: "AAPL", ISSUER: "coinbase" }, singleRecognizedUsd18: U(400n) }),
  pos({ groups: { UNDERLYING: "GOOGL", ISSUER: "coinbase" }, singleRecognizedUsd18: U(400n) }),
]);

// E. same custodian
add("E_same_custodian", [
  pos({ groups: { UNDERLYING: "NVDA", ISSUER: "iss-a", CUSTODY: "shared-custodian" }, singleRecognizedUsd18: U(500n) }),
  pos({ groups: { UNDERLYING: "AAPL", ISSUER: "iss-b", CUSTODY: "shared-custodian" }, singleRecognizedUsd18: U(500n) }),
]);

// F. same sector
add("F_same_sector", [
  pos({ groups: { UNDERLYING: "NVDA", SECTOR: "semiconductors" }, singleRecognizedUsd18: U(500n) }),
  pos({ groups: { UNDERLYING: "INTC", SECTOR: "semiconductors" }, singleRecognizedUsd18: U(500n) }),
]);

// G. one OPEN, one CLOSED
add("G_mixed_session", [
  pos({ marketSession: "OPEN", groups: { UNDERLYING: "NVDA" }, singleRecognizedUsd18: U(500n) }),
  pos({ marketSession: "CLOSED", groups: { UNDERLYING: "AAPL" }, singleRecognizedUsd18: U(500n) }),
]);

// H. missing metadata — UNKNOWN caps
add("H_missing_metadata", [
  pos({ groups: { UNDERLYING: "", ISSUER: "", CUSTODY: "", SECTOR: "", LIQUIDITY: "" }, liquidityDepthUsd18: 0n, singleRecognizedUsd18: U(600n) }),
  pos({ groups: { UNDERLYING: "AAPL" }, singleRecognizedUsd18: U(400n) }),
]);

// I. shared shallow liquidity route
add("I_shared_shallow_liquidity", [
  pos({ groups: { UNDERLYING: "NVDA", LIQUIDITY: "aero-pool-1" }, liquidityDepthUsd18: U(150n), singleRecognizedUsd18: U(500n) }),
  pos({ groups: { UNDERLYING: "AAPL", LIQUIDITY: "aero-pool-1" }, liquidityDepthUsd18: U(150n), singleRecognizedUsd18: U(500n) }),
]);

// J. stress scenario over a sector while debt exists (engine-level: just the recognition)
add(
  "J_stress_sector",
  [
    pos({ groups: { UNDERLYING: "NVDA", SECTOR: "semis" }, singleRecognizedUsd18: U(500n) }),
    pos({ groups: { UNDERLYING: "AAPL", SECTOR: "megacap" }, singleRecognizedUsd18: U(500n) }),
  ],
  policy({
    stressScenarios: [{ id: "SEMI_SHOCK", haircutBps: 3000n, appliesToGroupIds: ["semis"], appliesToSessions: [] }],
  }),
);

// K. three-name portfolio, three sectors (the intended canary shape)
add("K_three_name_three_sector", [
  pos({ groups: { UNDERLYING: "NVDA", ISSUER: "coinbase", CUSTODY: "cb", SECTOR: "semis" }, singleRecognizedUsd18: U(333n), marketValueUsd18: U(400n) }),
  pos({ groups: { UNDERLYING: "AAPL", ISSUER: "coinbase", CUSTODY: "cb", SECTOR: "megacap-tech" }, singleRecognizedUsd18: U(333n), marketValueUsd18: U(400n) }),
  pos({ groups: { UNDERLYING: "GOOGL", ISSUER: "coinbase", CUSTODY: "cb", SECTOR: "comms" }, singleRecognizedUsd18: U(334n), marketValueUsd18: U(400n) }),
]);

// L. asymmetric sizes — the largest position binds first
add("L_asymmetric_sizes", [
  pos({ groups: { UNDERLYING: "NVDA" }, singleRecognizedUsd18: U(900n) }),
  pos({ groups: { UNDERLYING: "AAPL" }, singleRecognizedUsd18: U(100n) }),
]);

// M. all base zero
add("M_zero_base", [pos({ singleRecognizedUsd18: 0n, marketValueUsd18: 0n })]);

// N. session degradation monotonicity: same portfolio, worse session → not more capacity
add("N_session_pre_market", [
  pos({ marketSession: "PRE_MARKET", groups: { UNDERLYING: "NVDA" }, singleRecognizedUsd18: U(500n) }),
  pos({ marketSession: "PRE_MARKET", groups: { UNDERLYING: "AAPL" }, singleRecognizedUsd18: U(500n) }),
]);

// ---- evaluate + serialize ----
const out = {
  $generated: "scripts/gen_portfolio_fixtures.mjs — DO NOT EDIT BY HAND",
  reference: "packages/portfolio-risk/src/evaluate.ts",
  wad: WAD.toString(),
  bps: BPS.toString(),
  scenarioCount: scenarios.length,
  scenarios: scenarios.map((sc) => {
    const r = evaluatePortfolio(sc.positions, sc.policy);
    // capBps flattened to 10 values: [d0.NAMED, d0.UNKNOWN, d1.NAMED, d1.UNKNOWN, ...]
    const capBpsFlat = DIMS.flatMap((d) => [Number(sc.policy.capBps[d].NAMED), Number(sc.policy.capBps[d].UNKNOWN)]);
    const st = sc.policy.stressScenarios;
    return {
      name: sc.name,
      positionCount: sc.positions.length,
      stressCount: st.length,
      policy: {
        capBpsFlat,
        sessionFactorBps: SESSIONS.map((s) => Number(sc.policy.sessionFactorBps[s])),
        maxCollateralInstruments: sc.policy.maxCollateralInstruments,
        // single-scenario stress support in the fixtures (matches BaseCanaryPortfolioRiskPolicy: 0 or 1)
        stressHaircutBps: st[0] ? Number(st[0].haircutBps) : 0,
        stressGroupIds: st[0] ? st[0].appliesToGroupIds.map(g32) : [],
        stressSessions: st[0] ? st[0].appliesToSessions.map((x) => SESSIONS.indexOf(x)) : [],
      },
      positions: sc.positions.map((p) => ({
        instrumentId: p.instrumentId,
        singleRecognizedUsd18: p.singleRecognizedUsd18.toString(),
        marketValueUsd18: p.marketValueUsd18.toString(),
        marketSession: SESSIONS.indexOf(p.marketSession),
        groups: DIMS.map((d) => g32(p.groups[d])),
        liquidityDepthUsd18: (p.liquidityDepthUsd18 ?? 0n).toString(),
      })),
      expected: {
        portfolioRecognizedValueUsd18: r.portfolioRecognizedValueUsd18.toString(),
        singleAssetRecognizedTotalUsd18: r.singleAssetRecognizedTotalUsd18.toString(),
        portfolioMarketValueUsd18: r.portfolioMarketValueUsd18.toString(),
        working: r.positions.map((x) => x.workingUsd18.toString()),
        positionScaleWad: r.positions.map((x) => x.positionScaleWad.toString()),
      },
    };
  }),
};

fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n");
console.log(`✓ ${OUT} — ${out.scenarios.length} scenarios`);

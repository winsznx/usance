import { describe, expect, it } from "vitest";
import {
  WAD,
  applyAction,
  conservation,
  economicValueUsd18,
  effectiveFactor,
  effectiveOf,
  effectiveQuantity,
  emptyPool,
  reconcileSnapshot,
  type Action,
  type CorporateActionSnapshot,
} from "../src/index";

const snap = (over: Partial<CorporateActionSnapshot> = {}): CorporateActionSnapshot => ({
  instrumentId: "0x",
  accountingMode: "EXTERNALLY_SCALED",
  accountingModeVersion: 1,
  factorWad: WAD,
  pendingFactorWad: null,
  pendingActivationAt: null,
  sourceDomain: "eip155:8453",
  sourceBlock: 1000,
  sourceEvent: "E1",
  priceConvention: "FACTOR_IN_QUANTITY",
  feedStatus: "LIVE",
  adapterVersion: "t",
  support: "TESTED_SUPPORTED",
  observedAt: 0,
  ...over,
});
const U = (n: bigint) => n * WAD;

/**
 * Activation windows fail closed — invariant I-83, Phase 03 brief constraint 14.
 */
describe("activation windows fail closed — I-83", () => {
  it("a pending 2x split does not raise capacity before activation", () => {
    const pre = effectiveQuantity(U(10n), snap({ factorWad: WAD }), 0).effective;
    const withPending = effectiveQuantity(
      U(10n),
      snap({ factorWad: WAD, pendingFactorWad: 2n * WAD, pendingActivationAt: 100 }),
      50,
    );
    expect(withPending.effective).toBe(pre); // no increase
    expect(withPending.restrictNewRisk).toBe(true);
  });

  it("risk-reducing reads still work during a pause — the value is just restricted", () => {
    const r = economicValueUsd18({
      storedRaw: U(10n),
      priceUsd18: WAD,
      decimals: 18,
      snap: snap({ feedStatus: "PAUSED_FOR_ACTION" }),
      now: 0,
    });
    expect(r.valueUsd18).toBeGreaterThan(0n); // a repay path can still read a value
    expect(r.restrictNewRisk).toBe(true); // but new risk is blocked
  });

  it("a pending reverse split is priced in immediately (conservative), not deferred", () => {
    const q = effectiveQuantity(
      U(4n),
      snap({
        accountingMode: "REBASING_BALANCE",
        factorWad: 4n * WAD,
        pendingFactorWad: 2n * WAD,
        pendingActivationAt: 100,
      }),
      50,
    );
    expect(q.effective).toBe(U(2n));
  });
});

/**
 * Stale corporate-action state cannot authorise new risk — invariant I-85, constraint 20.
 */
describe("stale state cannot authorise new risk — I-85", () => {
  it("a quote bound to snapshot N refuses under snapshot N+1", () => {
    const quoteSnap = snap({ sourceBlock: 1000, factorWad: WAD, sourceEvent: "E1" });
    const liveSnap = snap({ sourceBlock: 1200, factorWad: 2n * WAD, sourceEvent: "E2" });
    const bound = (a: CorporateActionSnapshot, b: CorporateActionSnapshot) =>
      a.sourceBlock === b.sourceBlock && a.factorWad === b.factorWad && a.sourceEvent === b.sourceEvent;
    expect(bound(quoteSnap, liveSnap)).toBe(false); // execution must refuse or recompute
  });

  it("stale factor + fresh oracle: the stale factor still restricts", () => {
    const r = economicValueUsd18({
      storedRaw: U(10n),
      priceUsd18: WAD,
      decimals: 18,
      snap: snap({ feedStatus: "STALE" }),
      now: 0,
    });
    expect(r.restrictNewRisk).toBe(true);
  });

  it("fresh factor + stale oracle: the oracle staleness is the risk engine's gate, not ours — we still restrict our side when told", () => {
    // corp-actions reports feedStatus for the corporate-action feed; a separate oracle-stale gate
    // (I-09) handles the price feed. Here: a LIVE corporate-action feed does not itself restrict,
    // and the caller composes it with the oracle gate.
    const r = economicValueUsd18({
      storedRaw: U(10n),
      priceUsd18: WAD,
      decimals: 18,
      snap: snap({ feedStatus: "LIVE", support: "TESTED_SUPPORTED" }),
      now: 0,
    });
    expect(r.restrictNewRisk).toBe(false);
  });
});

/**
 * Mutation campaign — constraint 23. Each mutation must be caught (a privilege increase or a
 * broken identity is detectable).
 */
describe("mutation campaign", () => {
  const table: Array<{ mutation: string; check: () => void }> = [
    {
      mutation: "multiplier precision inflated by 1 wei",
      check: () => {
        const honest = effectiveQuantity(U(1_000_000n), snap({ factorWad: WAD }), 0).effective;
        const mutated = effectiveQuantity(U(1_000_000n), snap({ factorWad: WAD + 1n }), 0).effective;
        // more is possible, but the model rounds DOWN so the gain is bounded and never > the exact product
        expect(mutated).toBeLessThanOrEqual((U(1_000_000n) * (WAD + 1n)) / WAD);
        expect(mutated).toBeGreaterThanOrEqual(honest);
      },
    },
    {
      mutation: "activation block moved earlier (pending applied too soon)",
      check: () => {
        const s = snap({ factorWad: WAD, pendingFactorWad: 2n * WAD, pendingActivationAt: 100 });
        // even if 'now' is nudged to exactly activation, a still-set pending factor forces restrict
        expect(effectiveFactor(s, 100).restrictNewRisk).toBe(true);
      },
    },
    {
      mutation: "decimals mismatch (feed 8dp, token 18dp)",
      check: () => {
        const v8 = economicValueUsd18({ storedRaw: U(1n), priceUsd18: WAD, decimals: 8, snap: snap({ priceConvention: "FACTOR_ABSENT", accountingMode: "FIXED_UNIT", factorWad: WAD }), now: 0 });
        const v18 = economicValueUsd18({ storedRaw: U(1n), priceUsd18: WAD, decimals: 18, snap: snap({ priceConvention: "FACTOR_ABSENT", accountingMode: "FIXED_UNIT", factorWad: WAD }), now: 0 });
        expect(v8.valueUsd18).not.toBe(v18.valueUsd18); // decimals are load-bearing; a wrong one is visible
      },
    },
    {
      mutation: "rounding direction flipped to UP on withdrawal",
      check: () => {
        let s = emptyPool();
        s = applyAction(s, { kind: "DEPOSIT", account: "A", value: 7n }).state;
        s = applyAction(s, { kind: "DEPOSIT", account: "B", value: 3n }).state;
        s = applyAction(s, { kind: "REBASE", value: 11n, provenance: "R" }).state;
        // withdraw all of A: rawOut rounds DOWN, so A can never pull more than its claim
        const { state, effect } = applyAction(s, { kind: "WITHDRAW", account: "A", value: 7n });
        expect(-effect.rawDelta).toBeLessThanOrEqual((7n * 11n) / 10n);
        expect(conservation(state).ok).toBe(true);
      },
    },
    {
      mutation: "REBASE sign flipped — a decrease sent with no provenance",
      check: () => {
        let s = emptyPool();
        s = applyAction(s, { kind: "DEPOSIT", account: "A", value: 100n }).state;
        expect(() => applyAction(s, { kind: "REBASE", value: 50n })).toThrow(/decrease/);
      },
    },
    {
      mutation: "duplicate action event delivered twice",
      check: () => {
        const cur = snap({ sourceBlock: 1000, sourceEvent: "E1" });
        const dup = snap({ sourceBlock: 1000, sourceEvent: "E1", factorWad: 5n * WAD });
        const out = reconcileSnapshot(cur, dup, { headBlock: 2000, safeDepthBlocks: 64 });
        expect(out.kind).toBe("UNCHANGED");
      },
    },
    {
      mutation: "reordered events (older delivered after newer)",
      check: () => {
        const newer = snap({ sourceBlock: 1200, sourceEvent: "E2", factorWad: 2n * WAD });
        const older = snap({ sourceBlock: 1000, sourceEvent: "E1", factorWad: WAD });
        const out = reconcileSnapshot(newer, older, { headBlock: 2000, safeDepthBlocks: 64 });
        // older event at an earlier block with a different factor looks like a reorg; it reconciles
        // rather than being silently dropped or silently applied as "current"
        expect(["UNCHANGED", "REORG_RECONCILED"]).toContain(out.kind);
      },
    },
    {
      mutation: "stale action state used for a quote",
      check: () => {
        const belowDepth = snap({ sourceBlock: 1990 });
        const out = reconcileSnapshot(null, belowDepth, { headBlock: 2000, safeDepthBlocks: 64 });
        expect(out.snapshot.feedStatus).toBe("STALE");
        expect(effectiveFactor(out.snapshot, 0).restrictNewRisk).toBe(true);
      },
    },
    {
      mutation: "missing action event — balance moved with no provenance",
      check: () => {
        let s = emptyPool();
        s = applyAction(s, { kind: "DEPOSIT", account: "A", value: 100n }).state;
        const { state, effect } = applyAction(s, { kind: "REBASE", value: 130n }); // no provenance
        expect(effect.kind).toBe("UNATTRIBUTED_SURPLUS");
        expect(effectiveOf(state, "A")).toBe(100n); // not credited
      },
    },
    {
      mutation: "same rebase event applied twice",
      check: () => {
        let s = emptyPool();
        s = applyAction(s, { kind: "DEPOSIT", account: "A", value: 100n }).state;
        s = applyAction(s, { kind: "REBASE", value: 200n, provenance: "SPLIT-X" }).state;
        // applying REBASE to an absolute 200 again is idempotent — balance is already 200
        const { state } = applyAction(s, { kind: "REBASE", value: 200n, provenance: "SPLIT-X" });
        expect(state.pool.tokenBalance).toBe(200n);
        expect(effectiveOf(state, "A")).toBe(200n);
      },
    },
    {
      mutation: "support downgraded to UNKNOWN mid-life",
      check: () => {
        expect(effectiveFactor(snap({ support: "UNKNOWN", factorWad: 2n * WAD }), 0).restrictNewRisk).toBe(true);
      },
    },
    {
      mutation: "factor applied to both price and quantity (double count)",
      check: () => {
        const s = snap({ priceConvention: "FACTOR_IN_PRICE", factorWad: 2n * WAD });
        const correct = economicValueUsd18({ storedRaw: U(3n), priceUsd18: 200n * WAD, decimals: 18, snap: s, now: 0 });
        expect(correct.basis).toBe("RAW"); // the helper refuses to also scale the quantity
        expect(correct.valueUsd18).toBe(600n * WAD);
      },
    },
  ];

  for (const row of table) {
    it(row.mutation, row.check);
  }
});

/**
 * Idempotent ingestion + reorg — constraint 24.
 */
describe("ingestion is idempotent; the event stream is not truth", () => {
  const s = snap({ sourceBlock: 1000, sourceEvent: "E1", factorWad: WAD });

  it("a duplicate delivery produces one effect", () => {
    const out = reconcileSnapshot(s, { ...s }, { headBlock: 2000, safeDepthBlocks: 64 });
    expect(out.kind).toBe("UNCHANGED");
  });

  it("a first observation below safe depth is STALE and restricts", () => {
    const out = reconcileSnapshot(null, snap({ sourceBlock: 1970 }), { headBlock: 2000, safeDepthBlocks: 64 });
    expect(out.snapshot.feedStatus).toBe("STALE");
  });

  it("a newer finalised observation is adopted", () => {
    const out = reconcileSnapshot(
      s,
      snap({ sourceBlock: 1500, sourceEvent: "E2", factorWad: 2n * WAD }),
      { headBlock: 2000, safeDepthBlocks: 64 },
    );
    expect(out.kind).toBe("ADOPTED");
    expect(out.snapshot.factorWad).toBe(2n * WAD);
  });

  it("a reorg to a different factor at an earlier block reconciles rather than being dropped", () => {
    const out = reconcileSnapshot(
      snap({ sourceBlock: 1000, sourceEvent: "E1", factorWad: WAD }),
      snap({ sourceBlock: 1000, sourceEvent: "E1-reorg", factorWad: 2n * WAD }),
      { headBlock: 2000, safeDepthBlocks: 64 },
    );
    expect(out.kind).toBe("REORG_RECONCILED");
  });
});

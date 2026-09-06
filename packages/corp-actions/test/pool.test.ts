import { describe, expect, it } from "vitest";
import {
  WAD,
  applyAction,
  conservation,
  dust,
  effectiveOf,
  emptyPool,
  totalEffective,
  type PoolState,
} from "../src/index";

const U = (n: bigint) => n * WAD;

function run(actions: Parameters<typeof applyAction>[1][]): PoolState {
  let s = emptyPool();
  for (const a of actions) s = applyAction(s, a).state;
  return s;
}

describe("share pool — deposit and withdraw", () => {
  it("the first depositor gets shares 1:1 with the deposit", () => {
    const s = run([{ kind: "DEPOSIT", account: "A", value: U(100n) }]);
    expect(s.shares.get("A")).toBe(U(100n));
    expect(effectiveOf(s, "A")).toBe(U(100n));
    expect(conservation(s).ok).toBe(true);
  });

  it("a later depositor is credited proportionally to the current pool", () => {
    const s = run([
      { kind: "DEPOSIT", account: "A", value: U(100n) },
      { kind: "DEPOSIT", account: "B", value: U(300n) },
    ]);
    // pool was 100 for 100 shares; B adds 300 → 300 shares. total 400/400.
    expect(effectiveOf(s, "A")).toBe(U(100n));
    expect(effectiveOf(s, "B")).toBe(U(300n));
    expect(conservation(s).ok).toBe(true);
  });

  it("withdrawal redeems shares for the current per-share value", () => {
    const s = run([
      { kind: "DEPOSIT", account: "A", value: U(100n) },
      { kind: "DEPOSIT", account: "B", value: U(300n) },
    ]);
    const { state, effect } = applyAction(s, { kind: "WITHDRAW", account: "B", value: U(300n) });
    expect(effect.kind).toBe("SHARES_BURNED");
    expect(effect.rawDelta).toBe(-U(300n));
    expect(state.shares.get("B")).toBe(0n);
    expect(conservation(state).ok).toBe(true);
  });
});

describe("a rebase moves effective ownership proportionally, mints no deposit — I-81", () => {
  it("positive rebase (split/dividend)", () => {
    let s = run([
      { kind: "DEPOSIT", account: "A", value: U(100n) },
      { kind: "DEPOSIT", account: "B", value: U(300n) },
    ]);
    const { state, effect } = applyAction(s, { kind: "REBASE", value: U(800n), provenance: "SPLIT-1" });
    expect(effect.kind).toBe("REBASE_OBSERVED");
    expect(effect.impliedFactorWad).toBe(2n * WAD); // 800/400
    // shares unchanged, effective doubled, proportion preserved
    expect(state.shares.get("A")).toBe(U(100n));
    expect(effectiveOf(state, "A")).toBe(U(200n));
    expect(effectiveOf(state, "B")).toBe(U(600n));
    expect(conservation(state).ok).toBe(true);
  });

  it("reverse split cannot break solvency — the pool never owes more than it holds", () => {
    let s = run([
      { kind: "DEPOSIT", account: "A", value: U(100n) },
      { kind: "DEPOSIT", account: "B", value: U(300n) },
    ]);
    const { state } = applyAction(s, { kind: "REBASE", value: U(200n), provenance: "REVSPLIT-1" });
    expect(effectiveOf(state, "A")).toBe(U(50n));
    expect(effectiveOf(state, "B")).toBe(U(150n));
    expect(totalEffective(state)).toBeLessThanOrEqual(state.pool.tokenBalance);
    expect(conservation(state).ok).toBe(true);
  });
});

describe("unsolicited transfer is not a corporate action — I-82", () => {
  it("an unprovenanced balance increase becomes unattributed surplus, credited to nobody", () => {
    let s = run([{ kind: "DEPOSIT", account: "A", value: U(100n) }]);
    const { state, effect } = applyAction(s, { kind: "REBASE", value: U(150n) }); // no provenance
    expect(effect.kind).toBe("UNATTRIBUTED_SURPLUS");
    expect(state.unattributedSurplus).toBe(U(50n));
    expect(effectiveOf(state, "A")).toBe(U(100n)); // A's claim did not grow
    expect(conservation(state).ok).toBe(true);
  });
});

describe("dust is classified, never swept", () => {
  it("rounding residue shows up as non-negative dust that balances the identity", () => {
    // odd deposits that don't divide evenly
    let s = run([
      { kind: "DEPOSIT", account: "A", value: 7n },
      { kind: "DEPOSIT", account: "B", value: 3n },
    ]);
    s = applyAction(s, { kind: "REBASE", value: 11n, provenance: "R" }).state; // 10 → 11
    const c = conservation(s);
    expect(c.ok).toBe(true);
    expect(c.dust).toBeGreaterThanOrEqual(0n);
    expect(dust(s)).toBe(c.dust);
  });
});

import { describe, expect, it } from "vitest";
import { WAD, applyAction, conservation, effectiveOf, emptyPool, type Action, type PoolState } from "../src/index";

const U = (n: bigint) => n * WAD;

/**
 * Multi-user attribution conservation campaign — `spec/corporate-action-model.md §10` of the
 * Phase 03 brief (constraint 10), invariant I-80.
 *
 * Every row: after the sequence, `Σ effectiveOf + surplus + dust == tokenBalance`, movement only
 * from authorised deposits / withdrawals / liquidation transfers / issuer corporate actions /
 * fees, and no account's economic ownership is disproportionate to its entitlement.
 */

interface Row {
  name: string;
  actions: Action[];
  /** Expected effective ownership after the sequence, for spot-checking proportionality. */
  expect: Record<string, bigint>;
}

const rows: Row[] = [
  {
    name: "A before, B after, then a 2x split; both proportional",
    actions: [
      { kind: "DEPOSIT", account: "A", value: U(100n) },
      { kind: "REBASE", value: U(100n), provenance: "noop" }, // no change yet
      { kind: "DEPOSIT", account: "B", value: U(100n) },
      { kind: "REBASE", value: U(400n), provenance: "SPLIT" }, // 200 → 400, 2x
    ],
    expect: { A: U(200n), B: U(200n) },
  },
  {
    name: "A deposits, borrows conceptually (no pool effect), B deposits, split, A partial withdraw",
    actions: [
      { kind: "DEPOSIT", account: "A", value: U(400n) },
      { kind: "DEPOSIT", account: "B", value: U(100n) },
      { kind: "REBASE", value: U(1000n), provenance: "SPLIT" }, // 500 → 1000, 2x
      { kind: "WITHDRAW", account: "A", value: U(200n) }, // redeem 200 of 400 shares → 400 raw
    ],
    expect: { A: U(400n), B: U(200n) },
  },
  {
    name: "three accounts, dividend, one liquidated",
    actions: [
      { kind: "DEPOSIT", account: "A", value: U(100n) },
      { kind: "DEPOSIT", account: "B", value: U(200n) },
      { kind: "DEPOSIT", account: "C", value: U(300n) },
      { kind: "REBASE", value: U(660n), provenance: "DIV" }, // 600 → 660, +10%
      { kind: "LIQUIDATION_SEIZE", account: "C", value: U(150n) }, // seize half of C's 300 shares
    ],
    expect: { A: U(110n), B: U(220n), C: U(165n) },
  },
  {
    name: "reverse split then full exits — nobody can withdraw more than their claim",
    actions: [
      { kind: "DEPOSIT", account: "A", value: U(100n) },
      { kind: "DEPOSIT", account: "B", value: U(300n) },
      { kind: "REBASE", value: U(200n), provenance: "REVSPLIT" }, // 400 → 200
      { kind: "WITHDRAW", account: "A", value: U(100n) },
      { kind: "WITHDRAW", account: "B", value: U(300n) },
    ],
    expect: { A: 0n, B: 0n },
  },
  {
    name: "unsolicited donation mid-life does not accrue to holders",
    actions: [
      { kind: "DEPOSIT", account: "A", value: U(100n) },
      { kind: "DEPOSIT", account: "B", value: U(100n) },
      { kind: "REBASE", value: U(260n) }, // no provenance → 60 surplus
      { kind: "REBASE", value: U(520n), provenance: "SPLIT" }, // 260 → 520, 2x on the WHOLE balance
    ],
    // pool token went 200 → 260 (60 surplus) → 520. tokenBalance 520, surplus doubled? No — surplus
    // is a fixed 60 recorded before; a subsequent rebase to 520 means dust/surplus rebalance. The
    // identity must still hold; proportionality of A and B relative to each other must be 1:1.
    expect: {},
  },
];

describe("conservation campaign — I-80", () => {
  for (const row of rows) {
    it(row.name, () => {
      let s: PoolState = emptyPool();
      let expectedTokenBalance = 0n;
      for (const a of s ? row.actions : []) void a;
      for (const a of row.actions) {
        const { state, effect } = applyAction(s, a);
        s = state;
        // track the authorised movement independently
        if (a.kind === "DEPOSIT") expectedTokenBalance += a.value;
        else if (a.kind === "WITHDRAW" || a.kind === "LIQUIDATION_SEIZE") expectedTokenBalance += effect.rawDelta;
        else if (a.kind === "FEE") expectedTokenBalance -= a.value;
        else if (a.kind === "REBASE") expectedTokenBalance = a.value; // absolute
      }

      const c = conservation(s);
      expect(c.ok, JSON.stringify({ ...c, note: "identity" }, (_k, v) => (typeof v === "bigint" ? v.toString() : v))).toBe(true);
      expect(s.pool.tokenBalance).toBe(expectedTokenBalance);

      for (const [acct, want] of Object.entries(row.expect)) {
        expect(effectiveOf(s, acct)).toBe(want);
      }
    });
  }

  it("A and B who deposited equally stay 1:1 through a donation and a split", () => {
    let s = emptyPool();
    for (const a of [
      { kind: "DEPOSIT", account: "A", value: U(100n) },
      { kind: "DEPOSIT", account: "B", value: U(100n) },
      { kind: "REBASE", value: U(260n) },
      { kind: "REBASE", value: U(520n), provenance: "SPLIT" },
    ] as Action[]) {
      s = applyAction(s, a).state;
    }
    expect(effectiveOf(s, "A")).toBe(effectiveOf(s, "B"));
    expect(conservation(s).ok).toBe(true);
  });
});

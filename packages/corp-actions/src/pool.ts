import { mulDivDown } from "./quantity";
import { WAD, type Action, type ActionEffect, type SharePool } from "./types";

/**
 * Share-based custody — the additive V2 model for `REBASING_BALANCE` instruments
 * (`spec/corporate-action-model.md §8`).
 *
 * Per account: a share count. The pool's `tokenBalance` is the custodied token balance. Of that,
 * `unattributedSurplus` is tokens that back no share — unsolicited transfers and rounding residue
 * (invariant I-82). The **share-backed balance** is `tokenBalance - unattributedSurplus`, and that
 * is what shares redeem against.
 *
 * A rebase changes `tokenBalance` (and scales the surplus, since the issuer rebases every token in
 * the vault), never `totalShares`, so every account's effective ownership moves proportionally and
 * no deposit/withdraw is implied (I-81). A reverse split can never make the pool owe more than its
 * share-backed balance (I-80).
 */

export interface PoolState {
  pool: SharePool;
  shares: Map<string, bigint>;
  unattributedSurplus: bigint;
}

export function emptyPool(): PoolState {
  return { pool: { totalShares: 0n, tokenBalance: 0n }, shares: new Map(), unattributedSurplus: 0n };
}

/** Tokens that back shares: total balance minus surplus that backs nothing. */
export function backedBalance(state: PoolState): bigint {
  return state.pool.tokenBalance - state.unattributedSurplus;
}

/** effectiveOf — an account's economic token ownership right now. Rounds down. */
export function effectiveOf(state: PoolState, account: string): bigint {
  const s = state.shares.get(account) ?? 0n;
  if (state.pool.totalShares === 0n) return 0n;
  return mulDivDown(s, backedBalance(state), state.pool.totalShares);
}

export function totalEffective(state: PoolState): bigint {
  let sum = 0n;
  for (const account of state.shares.keys()) sum += effectiveOf(state, account);
  return sum;
}

/** Classified dust: share-backed tokens beyond what accounts can withdraw. Always ≥ 0. Never swept. */
export function dust(state: PoolState): bigint {
  const owed = totalEffective(state);
  const backed = backedBalance(state);
  return backed >= owed ? backed - owed : 0n;
}

/**
 * Conservation identity — invariant I-80.
 *
 * `Σ effectiveOf + unattributedSurplus + dust == tokenBalance`, and `Σ effectiveOf ≤ backedBalance`.
 */
export function conservation(state: PoolState): {
  ok: boolean;
  totalEffective: bigint;
  unattributedSurplus: bigint;
  dust: bigint;
  tokenBalance: bigint;
} {
  const te = totalEffective(state);
  const d = dust(state);
  return {
    ok:
      te + state.unattributedSurplus + d === state.pool.tokenBalance &&
      te <= backedBalance(state) &&
      state.unattributedSurplus >= 0n,
    totalEffective: te,
    unattributedSurplus: state.unattributedSurplus,
    dust: d,
    tokenBalance: state.pool.tokenBalance,
  };
}

export function applyAction(state: PoolState, action: Action): { state: PoolState; effect: ActionEffect } {
  const next: PoolState = {
    pool: { ...state.pool },
    shares: new Map(state.shares),
    unattributedSurplus: state.unattributedSurplus,
  };

  switch (action.kind) {
    case "DEPOSIT": {
      if (!action.account) throw new Error("DEPOSIT needs an account");
      if (action.value <= 0n) throw new Error("DEPOSIT value must be positive");
      const backedBefore = backedBalance(next);
      const minted =
        next.pool.totalShares === 0n
          ? action.value
          : mulDivDown(action.value, next.pool.totalShares, backedBefore === 0n ? action.value : backedBefore);
      next.shares.set(action.account, (next.shares.get(action.account) ?? 0n) + minted);
      next.pool.totalShares += minted;
      next.pool.tokenBalance += action.value;
      return {
        state: next,
        effect: {
          kind: "SHARES_MINTED",
          account: action.account,
          shares: minted,
          rawDelta: action.value,
          impliedFactorWad: null,
          note: "authorised deposit",
        },
      };
    }

    case "WITHDRAW":
    case "LIQUIDATION_SEIZE": {
      if (!action.account) throw new Error(`${action.kind} needs an account`);
      const have = next.shares.get(action.account) ?? 0n;
      if (action.value > have) throw new Error("cannot redeem more shares than held");
      const rawOut = mulDivDown(action.value, backedBalance(next), next.pool.totalShares);
      next.shares.set(action.account, have - action.value);
      next.pool.totalShares -= action.value;
      next.pool.tokenBalance -= rawOut;
      return {
        state: next,
        effect: {
          kind: "SHARES_BURNED",
          account: action.account,
          shares: action.value,
          rawDelta: -rawOut,
          impliedFactorWad: null,
          note: action.kind === "LIQUIDATION_SEIZE" ? "liquidation transfer" : "authorised withdrawal",
        },
      };
    }

    case "REBASE": {
      const before = next.pool.tokenBalance;
      const delta = action.value - before;
      if (!action.provenance) {
        if (delta < 0n) throw new Error("an unprovenanced balance decrease cannot happen to a vault");
        next.pool.tokenBalance = action.value;
        next.unattributedSurplus += delta;
        return {
          state: next,
          effect: {
            kind: "UNATTRIBUTED_SURPLUS",
            account: null,
            shares: 0n,
            rawDelta: delta,
            impliedFactorWad: null,
            note: "balance increased with no corporate-action provenance; classified as surplus (I-82)",
          },
        };
      }
      const impliedFactorWad = before === 0n ? WAD : mulDivDown(action.value, WAD, before);
      // The issuer rebases every token in the vault, surplus included.
      next.unattributedSurplus =
        before === 0n ? next.unattributedSurplus : mulDivDown(next.unattributedSurplus, action.value, before);
      next.pool.tokenBalance = action.value;
      return {
        state: next,
        effect: {
          kind: "REBASE_OBSERVED",
          account: null,
          shares: 0n,
          rawDelta: delta,
          impliedFactorWad,
          note: `issuer corporate action, event ${action.provenance}`,
        },
      };
    }

    case "FEE": {
      if (action.value < 0n) throw new Error("FEE value must be non-negative");
      next.pool.tokenBalance -= action.value;
      return {
        state: next,
        effect: {
          kind: "FEE_TAKEN",
          account: null,
          shares: 0n,
          rawDelta: -action.value,
          impliedFactorWad: null,
          note: "modelled protocol fee",
        },
      };
    }
  }
}

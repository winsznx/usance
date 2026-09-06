import type { CorporateActionSnapshot } from "./types";

/**
 * Idempotent snapshot reconciliation — `spec/corporate-action-model.md §10`.
 *
 * The factor is reconciled from authoritative chain state at the domain's safe depth. An off-chain
 * event stream gives advance notice and provenance; it never sets the number. So:
 *
 *   - the same event delivered twice produces one state effect;
 *   - a restart reproduces the same snapshot;
 *   - a reorg reconciles to the canonical chain's value at safe depth;
 *   - a read below safe depth is `STALE` and restricts.
 */

export interface ReconcileContext {
  /** Head block on the domain, for the safe-depth check. */
  headBlock: number;
  /** Blocks an observation must be buried under to be treated as final on this domain. */
  safeDepthBlocks: number;
}

export type ReconcileOutcome =
  | { kind: "UNCHANGED"; snapshot: CorporateActionSnapshot; reason: string }
  | { kind: "ADOPTED"; snapshot: CorporateActionSnapshot; reason: string }
  | { kind: "REORG_RECONCILED"; snapshot: CorporateActionSnapshot; reason: string };

/**
 * Decide whether an observed snapshot replaces the current one.
 *
 * `current` may be null (first observation). `observed` is a candidate read from chain.
 */
export function reconcileSnapshot(
  current: CorporateActionSnapshot | null,
  observed: CorporateActionSnapshot,
  ctx: ReconcileContext,
): ReconcileOutcome {
  const belowSafeDepth = ctx.headBlock - observed.sourceBlock < ctx.safeDepthBlocks;
  const staged: CorporateActionSnapshot = belowSafeDepth
    ? { ...observed, feedStatus: "STALE" }
    : observed;

  if (current === null) {
    return { kind: "ADOPTED", snapshot: staged, reason: belowSafeDepth ? "first observation, below safe depth → STALE" : "first observation" };
  }

  // Same event at the same or an earlier block: a duplicate delivery. One effect only.
  if (
    observed.sourceEvent !== null &&
    observed.sourceEvent === current.sourceEvent &&
    observed.sourceBlock <= current.sourceBlock
  ) {
    return { kind: "UNCHANGED", snapshot: current, reason: "duplicate event delivery" };
  }

  // A strictly newer, safe-depth observation on the same chain advances the state.
  if (observed.sourceBlock > current.sourceBlock && !belowSafeDepth) {
    return { kind: "ADOPTED", snapshot: staged, reason: "newer finalised observation" };
  }

  // A newer observation still below safe depth: adopt the value but mark it STALE so it restricts.
  if (observed.sourceBlock > current.sourceBlock && belowSafeDepth) {
    return { kind: "ADOPTED", snapshot: staged, reason: "newer observation, below safe depth → STALE" };
  }

  // A different event at an EARLIER-or-equal block than the current one, with a different factor:
  // the chain the current snapshot was read from was reorganised. Reconcile to the observed value.
  if (
    observed.sourceBlock <= current.sourceBlock &&
    (observed.sourceEvent !== current.sourceEvent || observed.factorWad !== current.factorWad)
  ) {
    return {
      kind: "REORG_RECONCILED",
      snapshot: staged,
      reason: "current snapshot's source block was reorganised; reconciled to canonical state",
    };
  }

  return { kind: "UNCHANGED", snapshot: current, reason: "no change" };
}

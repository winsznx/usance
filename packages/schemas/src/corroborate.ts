import {
  claimValuesEqual,
  normalizeForComparison,
  UNKNOWN,
  type ClaimValue,
  type Unknown,
} from "./primitives";
import type { ClaimSet, Corroboration, FieldComparison, FieldOutcome } from "./evidence";

/**
 * Field-by-field corroboration.
 *
 * Deliberately vendor-neutral and deliberately dumb. Exact equality after type-directed
 * normalisation, and nothing else: no fuzzy matching, no embedding distance, no confidence
 * weighting. Every softer rule anyone has proposed for this function amounts to letting two
 * different readings of a redemption term count as agreement, and the whole point of corroboration
 * is that they must not.
 *
 * See `spec/evidence-model.md §6`.
 */

/**
 * Fields whose value can reach the chain and therefore affect capacity.
 *
 * Only these are allowed to force a `CLAIM_CONFLICT`. A disagreement about a descriptive field is
 * recorded and does not restrict the asset — restricting an asset because two extractors phrased
 * the issuer's marketing name differently would make the conflict state useless through noise.
 */
export const RISK_BEARING_FIELDS: readonly string[] = [
  "redemption.supported",
  "redemption.floorBps",
  "redemption.estimatedWindowSeconds",
  "transfer.permissionModel",
  "backing.model",
  "legal.holderRights",
  "corporateActions.mechanism",
];

export function isRiskBearing(field: string): boolean {
  return RISK_BEARING_FIELDS.includes(field);
}

/**
 * Compare claim sets from independent extraction paths.
 *
 * `independentPathCount` counts distinct `independenceGroup` values, not distinct extractors. Two
 * prompts against the same model share a group and count once — they are one path wearing two
 * hats, and counting them as two would let a single hallucination corroborate itself.
 */
export function corroborate(sets: readonly ClaimSet[]): Corroboration {
  const fields = new Set<string>();
  for (const s of sets) for (const c of s.claims) fields.add(c.field);

  const comparisons: FieldComparison[] = [];
  let anyConflict = false;

  // Groups that produced at least one non-UNKNOWN value anywhere.
  const contributingGroups = new Set<string>();
  for (const s of sets) {
    if (s.claims.some((c) => c.value !== UNKNOWN)) contributingGroups.add(s.independenceGroup);
  }

  for (const field of [...fields].sort()) {
    const byExtractor = new Map<string, ClaimValue | Unknown>();
    // One value per independence group. If two extractors in the same group disagree that is a
    // defect in the group, surfaced as a conflict within it rather than hidden by picking one.
    const byGroup = new Map<string, Set<string>>();

    for (const s of sets) {
      const claim = s.claims.find((c) => c.field === field);
      const value: ClaimValue | Unknown = claim ? claim.value : UNKNOWN;
      byExtractor.set(s.extractor, value);
      if (value !== UNKNOWN) {
        const norm = normalizeForComparison(value);
        const seen = byGroup.get(s.independenceGroup) ?? new Set<string>();
        seen.add(norm);
        byGroup.set(s.independenceGroup, seen);
      }
    }

    const groupsWithValue = [...byGroup.keys()];
    const distinctValues = new Set<string>();
    for (const vs of byGroup.values()) for (const v of vs) distinctValues.add(v);

    let outcome: FieldOutcome;
    if (groupsWithValue.length === 0) {
      outcome = "ABSENT";
    } else if (distinctValues.size > 1) {
      outcome = "CONFLICT";
      if (isRiskBearing(field)) anyConflict = true;
    } else if (groupsWithValue.length === 1) {
      outcome = "SINGLE";
    } else {
      outcome = "AGREED";
    }

    comparisons.push({ field, outcome, byExtractor });
  }

  const independentPathCount = contributingGroups.size;

  // Order matters. A conflict on a risk-bearing field wins over everything, because "we do not
  // know what this asset is" must never be resolved by counting paths.
  const outcome: Corroboration["outcome"] = anyConflict
    ? "CLAIM_CONFLICT"
    : independentPathCount >= 2 && comparisons.some((c) => c.outcome === "AGREED")
      ? "CORROBORATED"
      : "SINGLE_SOURCE";

  return { outcome, fields: comparisons, independentPathCount };
}

/**
 * Deterministic corroborator implementing the `EvidenceCorroborator` interface.
 *
 * Async only to satisfy the interface; it performs no I/O and cannot fail on the network. A
 * corroborator that could make a network call would be a corroborator that could be made to
 * agree.
 */
export class DeterministicCorroborator {
  readonly name = "deterministic-corroborator/1";

  status(): "available" {
    return "available";
  }

  async compare(sets: readonly ClaimSet[]): Promise<Corroboration> {
    return corroborate(sets);
  }
}

export { claimValuesEqual };

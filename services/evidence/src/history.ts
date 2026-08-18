import type { Hex32 } from "@usance/schemas";

/**
 * Semantic history between successive filings for the same instrument.
 *
 * The question a risk system has to answer about a re-filing is narrow: did anything change that
 * changes what the asset *is*? A prospectus is re-typeset every year — pages move, boilerplate is
 * rewritten, dates advance — so a comparison over document text reports change constantly and means
 * nothing. What is compared here is normalized claim values, the same representation the Passport
 * commits to.
 *
 * The classification is made by policy from the diff. No model decides whether a change is a risk
 * deterioration, because a model that could would be a model that sets risk parameters.
 *
 * `NO_MATERIAL_CHANGE` is a successful result. If a fund's terms did not change, the honest report
 * is that they did not.
 */

export type ChangeClassification =
  | "NO_MATERIAL_CHANGE"
  | "MATERIAL_CHANGE_NO_RISK_IMPACT"
  | "MATERIAL_RISK_IMPROVEMENT"
  | "MATERIAL_RISK_DETERIORATION";

export type RiskDirection = "DETERIORATION" | "IMPROVEMENT";

/** Fields that decide what an asset is. Grouped so a diff reads as sentences, not field indices. */
export const MATERIAL_FIELD_GROUPS: Readonly<Record<string, readonly string[]>> = {
  "legal structure": ["issuer.legalStructure", "issuer.jurisdiction", "issuer.regulatoryStatus"],
  "holder rights": ["holder.rights", "transfer.permissionModel", "transfer.restrictions"],
  backing: ["backing.model", "backing.custodian", "backing.assets"],
  redemption: [
    "redemption.supported",
    "redemption.estimatedWindowSeconds",
    "redemption.gateable",
    "redemption.floorBps",
  ],
  eligibility: ["eligibility.investorClass", "eligibility.jurisdictionRestrictions"],
  "corporate actions": ["corporateActions.mechanism", "corporateActions.noticePeriodSeconds"],
};

export const MATERIAL_FIELDS: readonly string[] = Object.values(MATERIAL_FIELD_GROUPS).flat();

type Claim = unknown;

const PERMISSION_RANK: Readonly<Record<string, number>> = {
  PERMISSIONLESS: 0,
  PERMISSIONED: 1,
  RESTRICTED: 2,
};

const nameOf = (v: Claim): string | undefined =>
  typeof v === "object" && v !== null && "name" in v ? String((v as { name: unknown }).name) : undefined;

const numberOf = (v: Claim): number | undefined => {
  if (typeof v === "number") return v;
  if (typeof v === "object" && v !== null && "value" in v) {
    const inner = (v as { value: unknown }).value;
    return typeof inner === "number" ? inner : undefined;
  }
  return undefined;
};

const boolOf = (v: Claim): boolean | undefined => {
  if (typeof v === "boolean") return v;
  if (typeof v === "object" && v !== null && "value" in v) {
    const inner = (v as { value: unknown }).value;
    return typeof inner === "boolean" ? inner : undefined;
  }
  return undefined;
};

/**
 * Which direction a change moves risk, per field.
 *
 * Deliberately narrow. A field whose direction is not encoded here yields no direction, and the
 * transition classifies as `MATERIAL_CHANGE_NO_RISK_IMPACT`. Being unable to classify a change is a
 * legitimate answer; inventing a direction for it is how a risk system starts making things up.
 */
export const RISK_DIRECTION: Readonly<
  Record<string, (from: Claim, to: Claim) => RiskDirection | null>
> = {
  "redemption.supported": (from, to) => {
    const a = boolOf(from);
    const b = boolOf(to);
    if (a === undefined || b === undefined || a === b) return null;
    return b ? "IMPROVEMENT" : "DETERIORATION";
  },
  "redemption.estimatedWindowSeconds": (from, to) => {
    const a = numberOf(from);
    const b = numberOf(to);
    if (a === undefined || b === undefined || a === b) return null;
    // A longer wait to get your money out is worse, however the document phrases it.
    return b > a ? "DETERIORATION" : "IMPROVEMENT";
  },
  "redemption.gateable": (from, to) => {
    const a = boolOf(from);
    const b = boolOf(to);
    if (a === undefined || b === undefined || a === b) return null;
    return b ? "DETERIORATION" : "IMPROVEMENT";
  },
  "redemption.floorBps": (from, to) => {
    const a = numberOf(from);
    const b = numberOf(to);
    if (a === undefined || b === undefined || a === b) return null;
    return b < a ? "DETERIORATION" : "IMPROVEMENT";
  },
  "transfer.permissionModel": (from, to) => {
    const a = PERMISSION_RANK[nameOf(from) ?? String(from)];
    const b = PERMISSION_RANK[nameOf(to) ?? String(to)];
    if (a === undefined || b === undefined || a === b) return null;
    return b > a ? "DETERIORATION" : "IMPROVEMENT";
  },
};

export interface FieldChange {
  readonly group: string;
  readonly field: string;
  /** A value that moved, versus a field one filing mentioned and the other did not. */
  readonly kind: "VALUE_CHANGE" | "COVERAGE_DIFFERENCE";
  readonly from: Claim | null;
  readonly to: Claim | null;
  readonly riskDirection: RiskDirection | null;
}

export interface DiffCoverage {
  readonly fieldsInScope: number;
  /** The honest denominator: fields with a value on both sides. Two silences agreeing is not a comparison. */
  readonly fieldsComparedOnBothSides: number;
  readonly comparedFields: readonly string[];
  readonly fieldsAbsentFromBoth: number;
  readonly absentFields: readonly string[];
  readonly note: string;
}

export interface FilingSnapshot {
  readonly id: string;
  readonly contentHash: Hex32;
  readonly claims: ReadonlyMap<string, Claim>;
}

export interface SemanticDiff {
  readonly from: string;
  readonly to: string;
  readonly classification: ChangeClassification;
  readonly materialChanges: number;
  readonly coverageDifferences: number;
  readonly changes: readonly FieldChange[];
  readonly coverage: DiffCoverage;
  readonly contentHashesDiffer: boolean;
}

const norm = (v: Claim): string | undefined => (v === undefined ? undefined : JSON.stringify(v));

export function diffFilings(before: FilingSnapshot, after: FilingSnapshot): SemanticDiff {
  const changes: FieldChange[] = [];
  const comparedFields: string[] = [];
  const absentFields: string[] = [];

  for (const [group, fields] of Object.entries(MATERIAL_FIELD_GROUPS)) {
    for (const field of fields) {
      const a = before.claims.get(field);
      const b = after.claims.get(field);

      if (a === undefined && b === undefined) {
        absentFields.push(field);
        continue;
      }
      if (a !== undefined && b !== undefined) comparedFields.push(field);
      if (norm(a) === norm(b)) continue;

      // One side absent is not the fund changing its terms. It means one filing said something the
      // other did not, which is an extraction-coverage fact and is reported as one.
      const kind = a === undefined || b === undefined ? "COVERAGE_DIFFERENCE" : "VALUE_CHANGE";
      changes.push({
        group,
        field,
        kind,
        from: a ?? null,
        to: b ?? null,
        riskDirection: kind === "VALUE_CHANGE" ? (RISK_DIRECTION[field]?.(a, b) ?? null) : null,
      });
    }
  }

  const valueChanges = changes.filter((c) => c.kind === "VALUE_CHANGE");
  const deteriorations = valueChanges.filter((c) => c.riskDirection === "DETERIORATION");
  const improvements = valueChanges.filter((c) => c.riskDirection === "IMPROVEMENT");

  // Deterioration wins over improvement when both are present. A filing that shortens the
  // redemption window while adding a gate has not made the asset safer on balance, and a
  // classification that averaged the two would report exactly that.
  const classification: ChangeClassification =
    valueChanges.length === 0
      ? "NO_MATERIAL_CHANGE"
      : deteriorations.length > 0
        ? "MATERIAL_RISK_DETERIORATION"
        : improvements.length > 0
          ? "MATERIAL_RISK_IMPROVEMENT"
          : "MATERIAL_CHANGE_NO_RISK_IMPACT";

  return {
    from: before.id,
    to: after.id,
    classification,
    materialChanges: valueChanges.length,
    coverageDifferences: changes.length - valueChanges.length,
    changes,
    coverage: {
      fieldsInScope: MATERIAL_FIELDS.length,
      fieldsComparedOnBothSides: comparedFields.length,
      comparedFields,
      fieldsAbsentFromBoth: absentFields.length,
      absentFields,
      note:
        comparedFields.length === 0
          ? "no field was comparable on both sides; this transition asserts nothing"
          : `${comparedFields.length} of ${MATERIAL_FIELDS.length} fields were comparable; the rest were absent from both filings and say nothing about stability`,
    },
    contentHashesDiffer: before.contentHash !== after.contentHash,
  };
}

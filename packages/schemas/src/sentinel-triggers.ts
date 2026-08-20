import { keccak256, stringToBytes } from "viem";
import { z } from "zod";
import { addressSchema, hex32Schema, unixSecondsSchema, type Hex32 } from "./primitives";
import { marketSessionSchema } from "./sentinel-market";

/**
 * Sentinel triggers: what may wake an autonomous agent, and how much each waking is worth.
 *
 * Two decisions carry this file. First, a trigger is a discriminated union rather than a generic
 * "the AI saw something" — the class of a trigger decides how its identity is derived and how far
 * its authority reaches. Second, identity is derived from the source event, never assigned, so a
 * trigger delivered twice is the same trigger and produces the same run
 * (`docs/SENTINELS_ARCHITECTURE.md §6, §9`).
 */

// ------------------------------------------------------------------ authority

/**
 * Ordered from most to least trustworthy. The ordinal is load-bearing: policy compares ranks, and
 * the asymmetry in `docs/SENTINELS_SECURITY.md` (I-66) is "a plan that increases risk requires a
 * trigger at or above VERIFIED_EXTERNAL". Weak evidence may always make an account safer or
 * quieter; it may never make it riskier.
 */
export const TRIGGER_AUTHORITY_CLASSES = [
  "DETERMINISTIC_ONCHAIN",
  "DETERMINISTIC_SCHEDULE",
  "VERIFIED_EXTERNAL",
  "EVIDENCE_BOUND",
  "AI_INTERPRETED",
  "LOW_TRUST_OBSERVATION",
] as const;

export type TriggerAuthorityClass = (typeof TRIGGER_AUTHORITY_CLASSES)[number];

export const triggerAuthoritySchema = z.enum(TRIGGER_AUTHORITY_CLASSES);

/** Lower rank = stronger authority. */
export function authorityRank(a: TriggerAuthorityClass): number {
  return TRIGGER_AUTHORITY_CLASSES.indexOf(a);
}

export function authorityAtLeast(a: TriggerAuthorityClass, floor: TriggerAuthorityClass): boolean {
  return authorityRank(a) <= authorityRank(floor);
}

// ------------------------------------------------------------------ specs

/**
 * What an instance subscribes to. A spec matches events; it carries no occurrence data.
 * COMPOSITE is a conjunction — every member must have a matching event in the same evaluation
 * window. Disjunction is expressed by configuring several triggers, which keeps each run
 * attributable to exactly one spec.
 */
const onchainStateSpec = z
  .object({
    class: z.literal("ONCHAIN_STATE"),
    event: z.enum(["DEBT_CHANGED", "COLLATERAL_CHANGED", "RESERVATION_CHANGED"]),
  })
  .strict();

const riskStateSpec = z
  .object({
    class: z.literal("RISK_STATE"),
    kind: z.enum(["EPOCH_CHANGED", "HEALTH_CHANGED"]),
    /** For HEALTH_CHANGED: fire when the safety buffer falls to or below this many bps. */
    bufferAtOrBelowBps: z.number().int().min(0).max(10_000).optional(),
  })
  .strict();

const passportStateSpec = z
  .object({ class: z.literal("PASSPORT_STATE"), assetId: hex32Schema.optional() })
  .strict();

const oracleStateSpec = z
  .object({
    class: z.literal("ORACLE_STATE"),
    kind: z.enum(["STALE", "RECOVERED", "SEQUENCER"]),
    assetId: hex32Schema.optional(),
  })
  .strict();

const marketStateSpec = z
  .object({
    class: z.literal("MARKET_STATE"),
    assetId: hex32Schema,
    onSession: marketSessionSchema,
  })
  .strict();

const timeSpec = z
  .object({
    class: z.literal("TIME"),
    kind: z.enum(["INTERVAL", "WINDOW"]),
    /** INTERVAL: evaluation cadence. Also the dedup bucket, so it is the floor, not a hint. */
    intervalSeconds: z.number().int().min(60).optional(),
    windowStart: unixSecondsSchema.optional(),
    windowEnd: unixSecondsSchema.optional(),
  })
  .strict();

const corporateActionSpec = z
  .object({
    class: z.literal("CORPORATE_ACTION"),
    assetId: hex32Schema,
    actionType: z.enum(["EARNINGS", "SPLIT", "DIVIDEND", "REDEMPTION_CHANGE", "OTHER"]),
  })
  .strict();

const evidenceObservationSpec = z
  .object({ class: z.literal("EVIDENCE_OBSERVATION"), assetId: hex32Schema.optional() })
  .strict();

const aiObservationSpec = z
  .object({
    class: z.literal("AI_OBSERVATION"),
    topics: z.array(z.string().min(1)).min(1).max(16),
  })
  .strict();

const manualSpec = z.object({ class: z.literal("MANUAL") }).strict();

const nonCompositeSpecSchema = z.discriminatedUnion("class", [
  onchainStateSpec,
  riskStateSpec,
  passportStateSpec,
  oracleStateSpec,
  marketStateSpec,
  timeSpec,
  corporateActionSpec,
  evidenceObservationSpec,
  aiObservationSpec,
  manualSpec,
]);

export type NonCompositeTriggerSpec = z.infer<typeof nonCompositeSpecSchema>;

/**
 * TIME's cross-field rule lives here, not on `timeSpec`, because a `superRefine` produces a
 * `ZodEffects` and `discriminatedUnion` accepts only plain objects. Refining after the union is
 * built keeps every member a `ZodObject` and preserves the discriminated inference.
 */
function refineTimeSpec(v: { class: string }, ctx: z.RefinementCtx): void {
  if (v.class !== "TIME") return;
  const t = v as z.infer<typeof timeSpec>;
  if (t.kind === "INTERVAL" && t.intervalSeconds === undefined)
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "INTERVAL requires intervalSeconds", path: ["intervalSeconds"] });
  if (t.kind === "WINDOW" && (t.windowStart === undefined || t.windowEnd === undefined))
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "WINDOW requires windowStart and windowEnd", path: ["windowStart"] });
}

const compositeSpec = z
  .object({
    class: z.literal("COMPOSITE"),
    all: z.array(nonCompositeSpecSchema.superRefine(refineTimeSpec)).min(2).max(8),
  })
  .strict();

export const triggerSpecSchema = z.union([
  nonCompositeSpecSchema.superRefine(refineTimeSpec),
  compositeSpec,
]);

export type TriggerSpec = z.infer<typeof triggerSpecSchema>;

export type TriggerClass = TriggerSpec["class"];

// ------------------------------------------------------------------ events

/**
 * The 11 trigger classes, ordered. The ordinal is the bit position in a template's
 * `requiredTriggerClasses` mask (`sentinel-template.ts`), so this order is load-bearing and may
 * only be appended to, never reordered.
 */
export const TRIGGER_CLASSES = [
  "ONCHAIN_STATE",
  "RISK_STATE",
  "PASSPORT_STATE",
  "ORACLE_STATE",
  "MARKET_STATE",
  "TIME",
  "CORPORATE_ACTION",
  "EVIDENCE_OBSERVATION",
  "AI_OBSERVATION",
  "MANUAL",
  "COMPOSITE",
] as const;

/**
 * A concrete, deduplicable occurrence. `identity` holds exactly the fields the architecture's §6
 * table names for the class — nothing more, because every extra field is a way for the same event
 * to arrive under two ids.
 */
export const triggerEventSchema = z
  .object({
    class: z.enum(TRIGGER_CLASSES),
    authority: triggerAuthoritySchema,
    /** Class-specific identity fields, string-valued, canonicalised by `triggerIdFor`. */
    identity: z.record(z.string(), z.string()),
    observedAt: unixSecondsSchema,
    /** Presentation-only context. Never part of identity, never an input to authorization. */
    detail: z.string().max(2_000).optional(),
    account: addressSchema.optional(),
  })
  .strict();

export type TriggerEvent = z.infer<typeof triggerEventSchema>;

/**
 * The floor authority a class can ever claim. An ingestor may report weaker, never stronger —
 * a news source cannot promote itself to DETERMINISTIC_ONCHAIN by lying about its class.
 */
export const CLASS_AUTHORITY_CEILING: Readonly<Record<TriggerClass, TriggerAuthorityClass>> = {
  ONCHAIN_STATE: "DETERMINISTIC_ONCHAIN",
  RISK_STATE: "DETERMINISTIC_ONCHAIN",
  PASSPORT_STATE: "DETERMINISTIC_ONCHAIN",
  ORACLE_STATE: "DETERMINISTIC_ONCHAIN",
  TIME: "DETERMINISTIC_SCHEDULE",
  MARKET_STATE: "VERIFIED_EXTERNAL",
  CORPORATE_ACTION: "VERIFIED_EXTERNAL",
  EVIDENCE_OBSERVATION: "EVIDENCE_BOUND",
  AI_OBSERVATION: "AI_INTERPRETED",
  MANUAL: "DETERMINISTIC_SCHEDULE",
  COMPOSITE: "DETERMINISTIC_SCHEDULE",
};

export function clampAuthority(cls: TriggerClass, claimed: TriggerAuthorityClass): TriggerAuthorityClass {
  const ceiling = CLASS_AUTHORITY_CEILING[cls];
  return authorityAtLeast(claimed, ceiling) ? ceiling : claimed;
}

// ------------------------------------------------------------------ identity

/** Canonical JSON: sorted keys, no undefined, lowercased hex strings. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return Object.fromEntries(entries.map(([k, v]) => [k, sortValue(v)]));
  }
  if (typeof value === "string" && /^0x[0-9a-fA-F]+$/.test(value)) return value.toLowerCase();
  return value;
}

/**
 * Derived trigger identity. Same source occurrence → same id, on any machine, forever. The
 * class is part of the preimage so two classes can never collide on shared field names.
 */
export function triggerIdFor(event: Pick<TriggerEvent, "class" | "identity">): Hex32 {
  return keccak256(stringToBytes(canonicalJson({ class: event.class, identity: event.identity })));
}

/**
 * Run identity (`§9`): one instance × one trigger occurrence × one trigger schema version.
 * Duplicate delivery cannot mint a second run because nothing here is assigned.
 */
export function runIdFor(instanceId: Hex32, triggerId: Hex32, triggerVersion: number): Hex32 {
  return keccak256(
    stringToBytes(canonicalJson({ instanceId, triggerId, triggerVersion, tag: "USANCE_SENTINEL_RUN_V1" })),
  );
}

/** Schedule dedup bucket: two schedulers in the same bucket produce one identity. */
export function scheduleBucket(nowSeconds: number, intervalSeconds: number): number {
  return Math.floor(nowSeconds / intervalSeconds) * intervalSeconds;
}

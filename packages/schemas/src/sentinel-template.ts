import { keccak256, stringToBytes } from "viem";
import { z } from "zod";
import { addressSchema, hex32Schema, unixSecondsSchema, type Hex32 } from "./primitives";
import { canonicalJson, TRIGGER_CLASSES } from "./sentinel-triggers";
import { actionsWithinVocabulary, maskRaisesRisk } from "./mandate-actions";
import { usd18StringSchema } from "./sentinel-run";

/**
 * A Sentinel template is a versioned strategy specification. It never holds user authority and
 * never contains executable code: it is declarative configuration plus a set of schema hashes the
 * runtime enforces, committed immutably per (templateId, version). Everything a marketplace shows
 * and everything an instance pins derives from here (`docs/SENTINELS_ARCHITECTURE.md §3.1, §4`).
 */

// ------------------------------------------------------------------ enums

/** What a template is permitted to do to an account's risk. Bounds which plans validate. */
export const RISK_CLASSES = ["RISK_REDUCING_ONLY", "MARKET_NEUTRAL", "RISK_INCREASING"] as const;
export type RiskClass = (typeof RISK_CLASSES)[number];
export const riskClassSchema = z.enum(RISK_CLASSES);

/**
 * Status ladder. The ordinal only increases: a template may be deprecated or security-disabled,
 * never quietly re-activated except by GOVERNANCE. Mirrors the PassportRegistry status pattern.
 */
export const TEMPLATE_STATUSES = ["ACTIVE", "DEPRECATED", "SECURITY_DISABLED"] as const;
export type TemplateStatus = (typeof TEMPLATE_STATUSES)[number];
export const templateStatusSchema = z.enum(TEMPLATE_STATUSES);

export function templateStatusRank(s: TemplateStatus): number {
  return TEMPLATE_STATUSES.indexOf(s);
}

/** True when moving to `to` only restricts (equal or higher ordinal). A GOVERNANCE lift is separate. */
export function isRestrictingStatusChange(from: TemplateStatus, to: TemplateStatus): boolean {
  return templateStatusRank(to) >= templateStatusRank(from);
}

export const AUDIT_STATUSES = ["UNAUDITED", "SELF_ATTESTED", "REVIEWED"] as const;
export type AuditStatus = (typeof AUDIT_STATUSES)[number];
export const auditStatusSchema = z.enum(AUDIT_STATUSES);

// ------------------------------------------------------------------ fee policy

/**
 * Fee ceilings. A publisher sets a fee at or below these; the values are pinned at registration and
 * mirrored by constants in `SentinelTemplateRegistry.sol` — governance that can raise its own
 * ceiling has no ceiling, so the ceiling is a constant, the FeeController pattern.
 */
export const MAX_TEMPLATE_FEE_BPS = 1_000; // 10% of an execution's protocol fee, hard ceiling
export const MAX_TEMPLATE_FLAT_FEE_USD18 = 100n * 10n ** 18n; // $100 per run, hard ceiling

export const templateFeePolicySchema = z
  .object({
    /** Share of an executed run's protocol fee, in bps, bounded by MAX_TEMPLATE_FEE_BPS. */
    perSuccessfulRunBps: z.number().int().min(0).max(MAX_TEMPLATE_FEE_BPS),
    /** Flat fee per successful run in usd18, bounded by MAX_TEMPLATE_FLAT_FEE_USD18. */
    flatPerRunUsd18: usd18StringSchema.refine(
      (s) => BigInt(s) <= MAX_TEMPLATE_FLAT_FEE_USD18,
      "flatPerRunUsd18 exceeds the template fee ceiling",
    ),
  })
  .strict();

export type TemplateFeePolicy = z.infer<typeof templateFeePolicySchema>;

// ------------------------------------------------------------------ trigger-class mask

type TriggerClassName = (typeof TRIGGER_CLASSES)[number];

/** Bit i corresponds to TRIGGER_CLASSES[i]. Keyed by the finite class union so lookups are total. */
const TRIGGER_CLASS_BIT: Readonly<Record<TriggerClassName, number>> = Object.fromEntries(
  TRIGGER_CLASSES.map((c, i) => [c, i]),
) as Record<TriggerClassName, number>;

export function triggerClassMaskFor(classes: readonly TriggerClassName[]): number {
  return classes.reduce((m, c) => m | (1 << TRIGGER_CLASS_BIT[c]), 0);
}

export function triggerClassesWithinVocabulary(mask: number): boolean {
  return Number.isInteger(mask) && mask >= 0 && mask < 1 << TRIGGER_CLASSES.length;
}

// ------------------------------------------------------------------ capabilities

/** The admission capability vocabulary (mirrors `Types.Capability`), for requiredCapabilities. */
export const CAPABILITIES = [
  "HOLD",
  "COLLATERAL",
  "TRADE",
  "BORROW",
  "LEND",
  "REPO",
  "CROSSCHAIN_ESCROW",
  "PERP_UNDERLYING",
  "OUTCOME_UNDERLYING",
] as const;
export const capabilitySchema = z.enum(CAPABILITIES);

// ------------------------------------------------------------------ manifest

/**
 * The canonical manifest — the artifact whose keccak256 is the `manifestHash` an instance pins.
 * It carries no `manifestHash` field itself (a hash cannot contain itself), and it is `.strict()`
 * so a publisher cannot smuggle an unmodelled field past the hash.
 */
export const sentinelTemplateManifestSchema = z
  .object({
    templateId: hex32Schema,
    version: z.number().int().min(1),
    publisher: addressSchema,
    name: z.string().min(1).max(120),
    description: z.string().min(1).max(4_000),
    riskClass: riskClassSchema,
    /** uint16 bitmask over the MandateAction vocabulary; a bit outside it is rejected. */
    requiredActions: z
      .number()
      .int()
      .min(0)
      .refine(actionsWithinVocabulary, "requiredActions has a bit outside the mandate vocabulary"),
    /** bitmask over TRIGGER_CLASSES. */
    requiredTriggerClasses: z
      .number()
      .int()
      .min(0)
      .refine(triggerClassesWithinVocabulary, "requiredTriggerClasses has a bit outside the trigger vocabulary"),
    requiredCapabilities: z.array(capabilitySchema).max(16).default([]),
    requiredVenues: z.array(z.string().min(1).max(64)).max(16).default([]),
    configSchemaHash: hex32Schema,
    triggerSchemaHash: hex32Schema,
    planSchemaHash: hex32Schema,
    feePolicy: templateFeePolicySchema,
    compilerVersion: z.string().min(1).max(64),
    promptVersion: z.string().min(1).max(64).optional(),
    minimumProtocolVersion: z.string().min(1).max(32),
    createdAt: unixSecondsSchema,
  })
  .strict()
  .superRefine((m, ctx) => {
    // A risk-reducing-only template cannot require a risk-increasing verb. This is the manifest-time
    // half of I-66; the runtime half is the plan validator refusing risk-increasing plans.
    if (m.riskClass === "RISK_REDUCING_ONLY" && maskRaisesRisk(m.requiredActions)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["requiredActions"],
        message: "RISK_REDUCING_ONLY template cannot require a risk-increasing action (BORROW/TRADE/HEDGE)",
      });
    }
  });

export type SentinelTemplateManifest = z.infer<typeof sentinelTemplateManifestSchema>;

/**
 * The manifest hash: parse (applying defaults, lowercasing hex) then keccak256 of canonical JSON.
 * Parsing first means two manifests that differ only by an omitted default or by hex casing hash
 * identically — the same key-order-insensitivity the trigger and run ids rely on.
 */
export function manifestHashFor(manifest: unknown): Hex32 {
  const parsed = sentinelTemplateManifestSchema.parse(manifest);
  return keccak256(stringToBytes(canonicalJson(parsed)));
}

/** Template family id, stable across versions: keccak256 of publisher + a name slug. */
export function templateIdFor(publisher: string, slug: string): Hex32 {
  return keccak256(stringToBytes(canonicalJson({ tag: "USANCE_SENTINEL_TEMPLATE_V1", publisher, slug })));
}

// ------------------------------------------------------------------ registry-stored version

/**
 * The record `SentinelTemplateRegistry` stores per (templateId, version): the hashes, the enums,
 * the bounded fee policy and the status ladder. The full manifest (name, description, compiler
 * version) is the offchain artifact whose hash is `manifestHash`.
 */
export const sentinelTemplateVersionSchema = z
  .object({
    templateId: hex32Schema,
    version: z.number().int().min(1),
    publisher: addressSchema,
    manifestHash: hex32Schema,
    configSchemaHash: hex32Schema,
    triggerSchemaHash: hex32Schema,
    planSchemaHash: hex32Schema,
    riskClass: riskClassSchema,
    requiredActions: z.number().int().min(0).refine(actionsWithinVocabulary),
    requiredTriggerClasses: z.number().int().min(0).refine(triggerClassesWithinVocabulary),
    feePolicy: templateFeePolicySchema,
    status: templateStatusSchema,
    auditStatus: auditStatusSchema,
    minimumProtocolVersion: z.string().min(1).max(32),
    createdAt: unixSecondsSchema,
  })
  .strict();

export type SentinelTemplateVersion = z.infer<typeof sentinelTemplateVersionSchema>;

// ------------------------------------------------------------------ marketplace statistics

/**
 * Receipt-derived marketplace statistics. Every figure is a count or a measured rate from indexed
 * receipts — there is no ROI, no PnL, no trust score, because none of those can be measured
 * honestly here and a marketplace that invents them is selling deception (`§14`).
 */
export const sentinelTemplateStatsSchema = z
  .object({
    templateId: hex32Schema,
    version: z.number().int().min(1),
    activeInstances: z.number().int().min(0),
    executedRuns: z.number().int().min(0),
    reconciledRuns: z.number().int().min(0),
    executionUnknownRuns: z.number().int().min(0),
    mandateViolationsRefused: z.number().int().min(0),
    /** Realized minus quoted slippage in bps, aggregate; null when no venue execution has occurred. */
    realizedVsQuotedSlippageBps: z.number().int().nullable(),
    versionAgeSeconds: z.number().int().min(0),
    auditStatus: auditStatusSchema,
    incidents: z.number().int().min(0),
  })
  .strict();

export type SentinelTemplateStats = z.infer<typeof sentinelTemplateStatsSchema>;

export const sentinelPublisherSchema = z
  .object({
    address: addressSchema,
    name: z.string().min(1).max(120).optional(),
    templatesPublished: z.number().int().min(0),
    firstPublishedAt: unixSecondsSchema.nullable(),
    incidents: z.number().int().min(0),
  })
  .strict();

export type SentinelPublisher = z.infer<typeof sentinelPublisherSchema>;

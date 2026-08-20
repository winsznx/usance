import { keccak256, stringToBytes } from "viem";
import { z } from "zod";
import {
  bpsSchema,
  canonicalJson,
  formatUsd18,
  manifestHashFor,
  maskForActions,
  parseUsd18,
  templateIdFor,
  triggerClassMaskFor,
  usd18StringSchema,
  type Hex32,
  type RiskClass,
  type SentinelPlan,
  type SentinelSnapshot,
  type SentinelTemplateManifest,
  type TriggerEvent,
} from "@usance/schemas";

/**
 * A template runtime is the deterministic compiler behind a marketplace template. It turns
 * (config, snapshot, trigger) into at most one plan — never executable code the publisher supplied,
 * always a fixed compiler dispatched by templateId (`docs/SENTINELS_ARCHITECTURE.md §13`).
 */
export interface CompileInput {
  readonly config: unknown;
  readonly snapshot: SentinelSnapshot;
  readonly trigger: TriggerEvent;
}

export interface CompileResult {
  /** `null` means NO_ACTION_REQUIRED — the buffer holds, there is nothing to do. */
  readonly plan: SentinelPlan | null;
  readonly reason: string;
}

export interface SentinelTemplateRuntime {
  readonly riskClass: RiskClass;
  readonly planSchemaHash: Hex32;
  compile(input: CompileInput): CompileResult;
}

export type TemplateRegistry = ReadonlyMap<Hex32, SentinelTemplateRuntime>;

/** The canonical hash of an instance configuration, matching the onchain `configHash` pin. */
export function configHashFor(config: unknown): Hex32 {
  return keccak256(stringToBytes(canonicalJson(config)));
}

// ------------------------------------------------------------------ T1 Safety Buffer

/**
 * Keep an account's safety buffer above a target by repaying debt. Risk-reducing only: the sole
 * action is REPAY, so no path here can increase risk (I-66). The daily cap and cooldown are
 * enforced by the instance budget; this compiler only sizes the per-run repay.
 */
export const safetyBufferConfigSchema = z
  .object({
    /** The buffer, in bps, to restore toward when action is taken. */
    targetBufferBps: bpsSchema,
    /** An early-warning level (presentation/alerts); above the action threshold. */
    warningBufferBps: bpsSchema,
    /** Act when the buffer is at or below this level. */
    actionBufferBps: bpsSchema,
    maxRepayPerRunUsd18: usd18StringSchema,
    dailyCapUsd18: usd18StringSchema,
    cooldownSeconds: z.number().int().min(0),
  })
  .strict()
  .superRefine((c, ctx) => {
    if (c.actionBufferBps > c.targetBufferBps)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["actionBufferBps"],
        message: "actionBufferBps must be at or below targetBufferBps",
      });
  });

export type SafetyBufferConfig = z.infer<typeof safetyBufferConfigSchema>;

const SAFETY_BUFFER_PLAN_SCHEMA_HASH = keccak256(stringToBytes("usance.sentinel.plan.repay.v1"));

export const safetyBufferRuntime: SentinelTemplateRuntime = {
  riskClass: "RISK_REDUCING_ONLY",
  planSchemaHash: SAFETY_BUFFER_PLAN_SCHEMA_HASH,
  compile({ config, snapshot }: CompileInput): CompileResult {
    const c = safetyBufferConfigSchema.parse(config);
    const debt = parseUsd18(snapshot.debtUsd18);
    const maintenance = parseUsd18(snapshot.maintenanceLimitUsd18);

    if (debt === 0n || maintenance === 0n) return { plan: null, reason: "no debt to reduce" };
    if (snapshot.bufferBps > c.actionBufferBps)
      return { plan: null, reason: `buffer ${snapshot.bufferBps}bps holds above the action threshold ${c.actionBufferBps}bps` };

    // buffer = (maintenance - debt) / maintenance; to reach targetBufferBps the debt must fall to
    // maintenance * (1 - target/10000). Repay the difference, clamped to the per-run cap.
    const targetDebt = (maintenance * BigInt(10_000 - c.targetBufferBps)) / 10_000n;
    let repay = debt > targetDebt ? debt - targetDebt : 0n;
    const cap = parseUsd18(c.maxRepayPerRunUsd18);
    if (repay > cap) repay = cap;
    if (repay <= 0n) return { plan: null, reason: "computed repay is zero" };

    return {
      plan: { action: "REPAY", amountUsd18: formatUsd18(repay), repayAll: false, riskDirection: "REDUCING" },
      reason: `repay to restore the buffer toward ${c.targetBufferBps}bps`,
    };
  },
};

/** The published T1 manifest, for the registry and marketplace. */
export function safetyBufferManifest(publisher: `0x${string}`, createdAt: number): SentinelTemplateManifest {
  const templateId = templateIdFor(publisher, "safety-buffer");
  return {
    templateId,
    version: 1,
    publisher,
    name: "Safety Buffer",
    description:
      "Keeps an account's safety buffer above a target by repaying debt from the agent's own balance. Risk-reducing only — it can never borrow, trade or move collateral.",
    riskClass: "RISK_REDUCING_ONLY",
    requiredActions: maskForActions(["REPAY", "ADD_COLLATERAL"]),
    requiredTriggerClasses: triggerClassMaskFor(["RISK_STATE", "ONCHAIN_STATE", "PASSPORT_STATE", "TIME"]),
    requiredCapabilities: [],
    requiredVenues: [],
    configSchemaHash: keccak256(stringToBytes("usance.sentinel.config.safety-buffer.v1")),
    triggerSchemaHash: keccak256(stringToBytes("usance.sentinel.trigger.v1")),
    planSchemaHash: SAFETY_BUFFER_PLAN_SCHEMA_HASH,
    feePolicy: { perSuccessfulRunBps: 0, flatPerRunUsd18: "0" },
    compilerVersion: "safety-buffer@1.0.0",
    minimumProtocolVersion: "1.0.0",
    createdAt,
  };
}

/** The manifest hash T1 instances pin. */
export function safetyBufferManifestHash(publisher: `0x${string}`, createdAt: number): Hex32 {
  return manifestHashFor(safetyBufferManifest(publisher, createdAt));
}

/** A template registry containing the flagship templates. */
export function defaultTemplateRegistry(publisher: `0x${string}`, createdAt: number): TemplateRegistry {
  const map = new Map<Hex32, SentinelTemplateRuntime>();
  map.set(templateIdFor(publisher, "safety-buffer"), safetyBufferRuntime);
  return map;
}

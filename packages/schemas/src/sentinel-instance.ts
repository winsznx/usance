import { encodeAbiParameters, keccak256 } from "viem";
import { z } from "zod";
import { addressSchema, hex32Schema, unixSecondsSchema, type Hex32 } from "./primitives";
import { triggerAuthoritySchema, triggerSpecSchema } from "./sentinel-triggers";
import { sentinelBudgetSchema } from "./sentinel-budget";
import { usd18StringSchema } from "./sentinel-run";

/**
 * A SentinelInstance binds one template version to one owner's account. It does not replace the
 * mandate — the mandate remains the entire financial authority — it records which template, which
 * executor, which mandate, and under what pacing and confirmation policy an owner armed a strategy
 * (`docs/SENTINELS_ARCHITECTURE.md §3.2, §4`).
 */

// ------------------------------------------------------------------ priority

/**
 * Priority orders work across several Sentinels on one account; it never accounts for capacity
 * (onchain reservation state is the only capacity truth, I-67). Lower ordinal = higher priority.
 */
export const SENTINEL_PRIORITIES = [
  "P0_EMERGENCY_RISK_REDUCTION",
  "P1_SAFETY_MAINTENANCE",
  "P2_HEDGE",
  "P3_REBALANCE",
  "P4_YIELD_OPPORTUNISTIC",
] as const;
export type SentinelPriority = (typeof SENTINEL_PRIORITIES)[number];
export const sentinelPrioritySchema = z.enum(SENTINEL_PRIORITIES);
export function priorityRank(p: SentinelPriority): number {
  return SENTINEL_PRIORITIES.indexOf(p);
}

// ------------------------------------------------------------------ confirmation policy

/**
 * When a compiled plan needs the owner's explicit confirmation before it may execute. Discriminated
 * on `mode`; CONFIRM_ABOVE_AMOUNT carries its threshold, the rest are bare. This is what lets
 * automation be sophisticated without being all-or-nothing (`§13`).
 */
export const confirmationPolicySchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("AUTO_WITHIN_MANDATE") }).strict(),
  z.object({ mode: z.literal("CONFIRM_EVERY_ACTION") }).strict(),
  z.object({ mode: z.literal("CONFIRM_RISK_INCREASING") }).strict(),
  z.object({ mode: z.literal("CONFIRM_ABOVE_AMOUNT"), thresholdUsd18: usd18StringSchema }).strict(),
  z.object({ mode: z.literal("CONFIRM_WEAK_TRIGGER") }).strict(),
]);
export type ConfirmationPolicy = z.infer<typeof confirmationPolicySchema>;

// ------------------------------------------------------------------ trigger policy

/**
 * What an instance subscribes to and which trigger authority classes it will allow to lead to
 * unattended execution. Authority outside this set parks a risk-relevant plan in
 * WAITING_USER_CONFIRMATION rather than executing (the §6 asymmetry, per instance).
 */
export const triggerPolicySchema = z
  .object({
    triggers: z.array(triggerSpecSchema).min(1).max(16),
    allowedAuthorityClasses: z.array(triggerAuthoritySchema).min(1).max(6),
  })
  .strict();
export type TriggerPolicy = z.infer<typeof triggerPolicySchema>;

// ------------------------------------------------------------------ lifecycle

export const INSTANCE_STATES = [
  "DRAFT",
  "AWAITING_MANDATE",
  "ARMED",
  "PAUSED",
  "BLOCKED",
  "EXPIRED",
  "REVOKED",
] as const;
export type InstanceState = (typeof INSTANCE_STATES)[number];
export const instanceStateSchema = z.enum(INSTANCE_STATES);

/**
 * Legal instance transitions. REVOKED is terminal — a revoked instance is dead, and re-arming is a
 * fresh registration over a fresh mandate, never a resurrection (the same discipline as run
 * terminals). EXPIRED (mandate elapsed) can only be cleaned up by revoking; there is no in-place
 * un-expire, because a new validity window means a new mandate the owner must sign.
 */
export const INSTANCE_TRANSITIONS: Readonly<Record<InstanceState, readonly InstanceState[]>> = {
  DRAFT: ["AWAITING_MANDATE", "REVOKED"],
  AWAITING_MANDATE: ["ARMED", "DRAFT", "REVOKED"],
  ARMED: ["PAUSED", "BLOCKED", "EXPIRED", "REVOKED"],
  PAUSED: ["ARMED", "BLOCKED", "EXPIRED", "REVOKED"],
  BLOCKED: ["ARMED", "PAUSED", "EXPIRED", "REVOKED"],
  EXPIRED: ["REVOKED"],
  REVOKED: [],
};

export function canTransitionInstance(from: InstanceState, to: InstanceState): boolean {
  return INSTANCE_TRANSITIONS[from].includes(to);
}
export function isInstanceTerminal(state: InstanceState): boolean {
  return INSTANCE_TRANSITIONS[state].length === 0;
}

export class IllegalInstanceTransition extends Error {
  readonly code = "ILLEGAL_INSTANCE_TRANSITION";
  constructor(
    readonly from: InstanceState,
    readonly to: InstanceState,
  ) {
    super(`illegal instance transition ${from} -> ${to}`);
    this.name = "IllegalInstanceTransition";
  }
}

// ------------------------------------------------------------------ instance record

export const sentinelInstanceSchema = z
  .object({
    instanceId: hex32Schema,
    owner: addressSchema,
    account: addressSchema,
    templateId: hex32Schema,
    templateVersion: z.number().int().min(1),
    manifestHash: hex32Schema,
    agentExecutor: addressSchema,
    mandateId: hex32Schema,
    configHash: hex32Schema,
    triggerPolicy: triggerPolicySchema,
    budgetPolicy: sentinelBudgetSchema,
    priorityClass: sentinelPrioritySchema,
    confirmationPolicy: confirmationPolicySchema,
    status: instanceStateSchema,
    createdAt: unixSecondsSchema,
    validAfter: unixSecondsSchema,
    expiresAt: unixSecondsSchema,
    lastRunId: hex32Schema.nullable(),
    lastSuccessfulRunAt: unixSecondsSchema.nullable(),
  })
  .strict()
  .superRefine((i, ctx) => {
    if (i.expiresAt <= i.validAfter)
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["expiresAt"], message: "expiresAt must be after validAfter" });
  });
export type SentinelInstance = z.infer<typeof sentinelInstanceSchema>;

/**
 * Instance identity, matching the onchain derivation
 * `keccak256(abi.encode("USANCE_SENTINEL_V1", owner, nonce))` so an offchain record and the
 * `SentinelInstanceRegistry` agree on the id without a round-trip.
 */
export function instanceIdFor(owner: `0x${string}`, nonce: bigint): Hex32 {
  return keccak256(
    encodeAbiParameters(
      [{ type: "string" }, { type: "address" }, { type: "uint256" }],
      ["USANCE_SENTINEL_V1", owner, nonce],
    ),
  );
}

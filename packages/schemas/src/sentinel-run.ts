import { keccak256, stringToBytes } from "viem";
import { z } from "zod";
import { addressSchema, hex32Schema, unixSecondsSchema, type Hex32 } from "./primitives";
import { canonicalJson, triggerAuthoritySchema, triggerEventSchema } from "./sentinel-triggers";
import { marketSessionSchema } from "./sentinel-market";

/**
 * The Sentinel run: one trigger occurrence, one independently auditable lifecycle.
 *
 * The state set deliberately has no generic FAILED. Every refusal names its reason, because
 * "something went wrong" is not a state (`spec/state-machines.md`), and because the run detail
 * page renders these names to a user who is deciding whether to keep trusting an autonomous
 * agent with a mandate.
 */

// ------------------------------------------------------------------ money-as-string

/**
 * usd18 amounts in Sentinel records are decimal strings, not bigint, because runs are persisted
 * as JSON and read back by more than one consumer. Parsing to bigint happens at the arithmetic
 * boundary. A string that is not a canonical non-negative integer is a schema failure, never a 0.
 */
export const usd18StringSchema = z.string().regex(/^(0|[1-9]\d*)$/, "expected a canonical usd18 integer string");

export function parseUsd18(s: string): bigint {
  return BigInt(s);
}

export function formatUsd18(v: bigint): string {
  if (v < 0n) throw new RangeError("usd18 amounts are non-negative");
  return v.toString(10);
}

// ------------------------------------------------------------------ plans

/**
 * Compiled plans, one arm per action class. No arm has a recipient, destination, spender or
 * callback field — the destinations are fixed at wiring time (DelegationGateway, IntentBook, the
 * vault), which is what makes "arbitrary recipient injection" a parse failure rather than a
 * policy question (`docs/SENTINELS_SECURITY.md §2`).
 */
const repayPlan = z
  .object({
    action: z.literal("REPAY"),
    amountUsd18: usd18StringSchema,
    repayAll: z.boolean(),
    riskDirection: z.literal("REDUCING"),
  })
  .strict();

const addCollateralPlan = z
  .object({
    action: z.literal("ADD_COLLATERAL"),
    assetId: hex32Schema,
    /** Raw token units with decimals alongside; a plan moves tokens, not dollars. */
    amountTokens: z.string().regex(/^(0|[1-9]\d*)$/),
    decimals: z.number().int().min(0).max(18),
    riskDirection: z.literal("REDUCING"),
  })
  .strict();

const supplyVaultPlan = z
  .object({
    action: z.literal("SUPPLY_VAULT"),
    amountTokens: z.string().regex(/^(0|[1-9]\d*)$/),
    decimals: z.number().int().min(0).max(18),
    riskDirection: z.literal("NEUTRAL"),
  })
  .strict();

const venueTradePlan = z
  .object({
    action: z.enum(["TRADE", "HEDGE", "CLOSE"]),
    venueId: z.string().min(1).max(64),
    assetId: hex32Schema,
    side: z.enum(["BUY", "SELL"]),
    notionalUsd18: usd18StringSchema,
    maxSlippageBps: z.number().int().min(0).max(10_000),
    riskDirection: z.enum(["REDUCING", "NEUTRAL", "INCREASING"]),
  })
  .strict();

export const sentinelPlanSchema = z.discriminatedUnion("action", [
  repayPlan,
  addCollateralPlan,
  supplyVaultPlan,
  venueTradePlan,
]);

export type SentinelPlan = z.infer<typeof sentinelPlanSchema>;

export type RiskDirection = SentinelPlan["riskDirection"];

export function planHashFor(plan: SentinelPlan): Hex32 {
  return keccak256(stringToBytes(canonicalJson(plan)));
}

// ------------------------------------------------------------------ snapshot

/**
 * The pinned financial world a plan was compiled against (`§7`). Everything a validator or a
 * reader needs to reproduce the decision is here; anything that moved by execution time is
 * re-read live by the authorization check, and a moved epoch invalidates rather than repricing.
 */
export const sentinelSnapshotSchema = z
  .object({
    chainId: z.number().int().positive(),
    blockNumber: z.number().int().min(0),
    blockHash: hex32Schema,
    account: addressSchema,
    accountStatus: z.string().min(1),
    recognisedUsd18: usd18StringSchema,
    debtUsd18: usd18StringSchema,
    borrowLimitUsd18: usd18StringSchema,
    maintenanceLimitUsd18: usd18StringSchema,
    availableBorrowUsd18: usd18StringSchema,
    reservedUsd18: usd18StringSchema,
    /** Safety buffer in bps of the maintenance limit; 0 when debt ≥ maintenance. */
    bufferBps: z.number().int().min(0).max(10_000),
    riskEpoch: z.number().int().min(1),
    mandate: z
      .object({
        mandateId: hex32Schema,
        live: z.boolean(),
        expiresAt: unixSecondsSchema,
        remainingDebtUsd18: usd18StringSchema,
        remainingNotionalUsd18: usd18StringSchema,
      })
      .strict(),
    passports: z
      .array(z.object({ assetId: hex32Schema, version: z.number().int().min(0), status: z.string() }).strict())
      .max(64),
    marketSession: marketSessionSchema.optional(),
    instanceConfigHash: hex32Schema,
    takenAt: unixSecondsSchema,
  })
  .strict();

export type SentinelSnapshot = z.infer<typeof sentinelSnapshotSchema>;

// ------------------------------------------------------------------ states

export const RUN_STATES = [
  "TRIGGER_OBSERVED",
  "TRIGGER_VALIDATED",
  "SNAPSHOT_PINNING",
  "SNAPSHOT_PINNED",
  "PLANNING",
  "PLAN_READY",
  "PLAN_REJECTED",
  "NO_ACTION_REQUIRED",
  "WAITING_USER_CONFIRMATION",
  "AUTHORIZATION_CHECKING",
  "AUTHORIZED",
  "AUTHORIZATION_REJECTED",
  "RESERVING",
  "CAPITAL_RESERVED",
  "RESERVATION_REJECTED",
  "SUBMITTING",
  "SUBMITTED",
  "CONFIRMATION_UNKNOWN",
  "PARTIALLY_FILLED",
  "FILLED",
  "EXECUTION_UNKNOWN",
  "RECONCILING",
  "RECONCILED",
  "COMPLETE",
  "BLOCKED_BY_POLICY",
  "BLOCKED_BY_MANDATE",
  "BLOCKED_BY_BUDGET",
  "BLOCKED_BY_RISK_EPOCH",
  "BLOCKED_BY_VENUE",
  "BLOCKED_BY_LIQUIDITY",
  "BLOCKED_BY_MARKET_SESSION",
] as const;

export type RunState = (typeof RUN_STATES)[number];

/**
 * Legal edges. Anything not listed is an `IllegalRunTransition`, the same discipline as the
 * evidence workflow's TRANSITIONS table. Terminal states have no outgoing edges; a new trigger
 * occurrence is a new run, never a resurrection.
 */
export const RUN_TRANSITIONS: Readonly<Record<RunState, readonly RunState[]>> = {
  TRIGGER_OBSERVED: ["TRIGGER_VALIDATED", "BLOCKED_BY_POLICY"],
  TRIGGER_VALIDATED: ["SNAPSHOT_PINNING"],
  SNAPSHOT_PINNING: ["SNAPSHOT_PINNED", "BLOCKED_BY_POLICY"],
  SNAPSHOT_PINNED: ["PLANNING"],
  PLANNING: ["PLAN_READY", "PLAN_REJECTED", "NO_ACTION_REQUIRED"],
  PLAN_READY: [
    "AUTHORIZATION_CHECKING",
    "WAITING_USER_CONFIRMATION",
    "BLOCKED_BY_BUDGET",
    "BLOCKED_BY_MARKET_SESSION",
    "BLOCKED_BY_POLICY",
  ],
  WAITING_USER_CONFIRMATION: ["AUTHORIZATION_CHECKING", "BLOCKED_BY_POLICY"],
  AUTHORIZATION_CHECKING: [
    "AUTHORIZED",
    "AUTHORIZATION_REJECTED",
    "BLOCKED_BY_MANDATE",
    "BLOCKED_BY_RISK_EPOCH",
  ],
  AUTHORIZED: ["RESERVING", "SUBMITTING"],
  RESERVING: ["CAPITAL_RESERVED", "RESERVATION_REJECTED", "BLOCKED_BY_LIQUIDITY"],
  CAPITAL_RESERVED: ["SUBMITTING"],
  SUBMITTING: ["SUBMITTED", "BLOCKED_BY_VENUE"],
  SUBMITTED: ["CONFIRMATION_UNKNOWN", "PARTIALLY_FILLED", "FILLED", "EXECUTION_UNKNOWN", "RECONCILING"],
  CONFIRMATION_UNKNOWN: ["RECONCILING"],
  PARTIALLY_FILLED: ["FILLED", "RECONCILING"],
  FILLED: ["RECONCILING"],
  EXECUTION_UNKNOWN: ["RECONCILING"],
  RECONCILING: ["RECONCILED", "EXECUTION_UNKNOWN"],
  RECONCILED: ["COMPLETE"],
  COMPLETE: [],
  PLAN_REJECTED: [],
  NO_ACTION_REQUIRED: [],
  AUTHORIZATION_REJECTED: [],
  RESERVATION_REJECTED: [],
  BLOCKED_BY_POLICY: [],
  BLOCKED_BY_MANDATE: [],
  BLOCKED_BY_BUDGET: [],
  BLOCKED_BY_RISK_EPOCH: [],
  BLOCKED_BY_VENUE: [],
  BLOCKED_BY_LIQUIDITY: [],
  BLOCKED_BY_MARKET_SESSION: [],
};

export const RUN_TERMINAL_STATES: readonly RunState[] = (
  Object.keys(RUN_TRANSITIONS) as RunState[]
).filter((s) => RUN_TRANSITIONS[s].length === 0);

/** States a supervisor must pick back up after a crash: mid-flight onchain or awaiting a read. */
export const RUN_RESUMABLE_STATES: readonly RunState[] = [
  "SNAPSHOT_PINNING",
  "PLANNING",
  "AUTHORIZATION_CHECKING",
  "AUTHORIZED",
  "RESERVING",
  "CAPITAL_RESERVED",
  "SUBMITTING",
  "SUBMITTED",
  "CONFIRMATION_UNKNOWN",
  "PARTIALLY_FILLED",
  "FILLED",
  "EXECUTION_UNKNOWN",
  "RECONCILING",
  "RECONCILED",
];

export function canTransitionRun(from: RunState, to: RunState): boolean {
  return RUN_TRANSITIONS[from].includes(to);
}

export function isRunTerminal(state: RunState): boolean {
  return RUN_TRANSITIONS[state].length === 0;
}

// ------------------------------------------------------------------ record

export const runTransitionRecordSchema = z
  .object({
    to: z.enum(RUN_STATES),
    at: unixSecondsSchema,
    /** The reason carried into a blocked or rejected state. Empty for happy-path edges. */
    reason: z.string().max(500).optional(),
  })
  .strict();

export const sentinelRunSchema = z
  .object({
    runId: hex32Schema,
    instanceId: hex32Schema,
    triggerId: hex32Schema,
    triggerVersion: z.number().int().min(1),
    trigger: triggerEventSchema,
    authority: triggerAuthoritySchema,
    state: z.enum(RUN_STATES),
    snapshot: sentinelSnapshotSchema.nullable(),
    plan: sentinelPlanSchema.nullable(),
    planHash: hex32Schema.nullable(),
    /** Transaction hashes this run submitted, in order. Confirmed-or-not lives in `state`. */
    transactions: z.array(hex32Schema).max(16),
    intentId: hex32Schema.nullable(),
    history: z.array(runTransitionRecordSchema),
    createdAt: unixSecondsSchema,
    updatedAt: unixSecondsSchema,
    attempts: z.number().int().min(0),
  })
  .strict();

export type SentinelRun = z.infer<typeof sentinelRunSchema>;
export type RunTransitionRecord = z.infer<typeof runTransitionRecordSchema>;

export class IllegalRunTransition extends Error {
  readonly code = "ILLEGAL_RUN_TRANSITION";
  constructor(
    readonly from: RunState,
    readonly to: RunState,
  ) {
    super(`illegal run transition ${from} -> ${to}`);
    this.name = "IllegalRunTransition";
  }
}

export interface AdvanceRunOptions {
  readonly reason?: string;
  readonly snapshot?: SentinelSnapshot;
  readonly plan?: SentinelPlan;
  readonly transaction?: Hex32;
  readonly intentId?: Hex32;
}

/** Pure. Refuses illegal edges; never mutates its input. */
export function advanceRun(
  run: SentinelRun,
  to: RunState,
  now: number,
  options: AdvanceRunOptions = {},
): SentinelRun {
  if (!canTransitionRun(run.state, to)) throw new IllegalRunTransition(run.state, to);
  const plan = options.plan ?? run.plan;
  return {
    ...run,
    state: to,
    snapshot: options.snapshot ?? run.snapshot,
    plan,
    planHash: plan ? planHashFor(plan) : run.planHash,
    transactions: options.transaction ? [...run.transactions, options.transaction] : run.transactions,
    intentId: options.intentId ?? run.intentId,
    history: [...run.history, { to, at: now, ...(options.reason ? { reason: options.reason } : {}) }],
    updatedAt: now,
    attempts: to === "SUBMITTING" ? run.attempts + 1 : run.attempts,
  };
}

export function createRun(
  runId: Hex32,
  instanceId: Hex32,
  trigger: z.infer<typeof triggerEventSchema>,
  triggerId: Hex32,
  triggerVersion: number,
  now: number,
): SentinelRun {
  return {
    runId,
    instanceId,
    triggerId,
    triggerVersion,
    trigger,
    authority: trigger.authority,
    state: "TRIGGER_OBSERVED",
    snapshot: null,
    plan: null,
    planHash: null,
    transactions: [],
    intentId: null,
    history: [{ to: "TRIGGER_OBSERVED", at: now }],
    createdAt: now,
    updatedAt: now,
    attempts: 0,
  };
}

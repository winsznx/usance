import { keccak256, stringToBytes } from "viem";
import type { Hex32, UnixSeconds } from "@usance/schemas";

/**
 * The evidence-to-Passport lifecycle, as an explicit state machine.
 *
 * The pipeline already ran end to end before this existed, which is exactly why it needed writing
 * down. A process that works when nothing goes wrong is not a workflow; the value here is in the
 * states that only occur when something does, and in refusing to collapse them.
 *
 * Two design rules run through the whole file.
 *
 * **Failure states are distinct.** `SOURCE_UNAVAILABLE`, `EXTRACTION_FAILED`, `POLICY_REJECTED` and
 * `COMMIT_FAILED` mean different things to whoever has to act: retry, re-fetch, escalate to
 * governance, reconcile against the chain. A single `FAILED` state turns all four into "someone go
 * and read the logs".
 *
 * **The chain is the authority, never local state.** A workflow that believes it committed because
 * it recorded that it did is a workflow that double-commits after a crash. Advancing past a commit
 * requires a read-back, and an unknown submission goes to `CONFIRMATION_UNKNOWN` — which is
 * resolved by asking the registry, not by sending again.
 */

// ---------------------------------------------------------------------------------- states

export const WORKFLOW_STATES = [
  "CREATED",

  "EVIDENCE_RESOLVING",
  "EVIDENCE_READY",

  "EXTRACTION_RUNNING",
  "EXTRACTION_COMPLETE",

  "CORROBORATING",
  "SINGLE_SOURCE",
  "CLAIM_CONFLICT",
  "EVIDENCE_VERIFIED",

  "PASSPORT_BUILDING",
  "PASSPORT_CANDIDATE_READY",

  "ADMISSION_EVALUATING",

  "EVIDENCE_COMMIT_PENDING",
  "EVIDENCE_COMMIT_SUBMITTED",
  "EVIDENCE_COMMIT_CONFIRMED",

  "PASSPORT_COMMIT_PENDING",
  "PASSPORT_COMMIT_SUBMITTED",
  "PASSPORT_COMMIT_CONFIRMED",

  "RISK_REEVALUATING",
  "RISK_EPOCH_ACTIVATED",

  "ACCOUNT_REEVALUATING",
  "COMPLETE",

  // Failure and recovery. Each names an action, not a mood.
  "SOURCE_UNAVAILABLE",
  "EXTRACTION_FAILED",
  "CORROBORATION_FAILED",
  "NEEDS_EVIDENCE",
  "POLICY_REJECTED",
  "COMMIT_FAILED",
  "CONFIRMATION_UNKNOWN",
  "RECONCILIATION_REQUIRED",
] as const;

export type WorkflowState = (typeof WORKFLOW_STATES)[number];

/**
 * Terminal states, and what each one means for whoever is looking at it.
 *
 * `SINGLE_SOURCE` is deliberately not terminal. A Passport built from one path commits and is
 * capped; treating it as a dead end would make a degraded provider look like a rejected asset.
 *
 * `CLAIM_CONFLICT` is terminal and is not an error. Two independent readings disagreeing about what
 * an asset is, is a finding — the correct response is to go and resolve the disagreement, never to
 * retry until one of them wins.
 */
export const TERMINAL_STATES: Readonly<Record<string, string>> = {
  COMPLETE: "the Passport is live and the epoch has moved",
  CLAIM_CONFLICT: "independent readings disagree; resolve the disagreement, do not retry",
  POLICY_REJECTED: "admission policy refused this asset; governance decides, not a worker",
  RECONCILIATION_REQUIRED: "attempts exhausted or chain state is ambiguous; a human owns this",
};

export const isTerminal = (s: WorkflowState): boolean => s in TERMINAL_STATES;

/** States where work is in flight onchain and the outcome is not yet known locally. */
export const IN_FLIGHT_STATES: readonly WorkflowState[] = [
  "EVIDENCE_COMMIT_SUBMITTED",
  "PASSPORT_COMMIT_SUBMITTED",
  "CONFIRMATION_UNKNOWN",
];

// ---------------------------------------------------------------------------------- transitions

/**
 * The legal transition graph.
 *
 * Written as data rather than as branches so that "can this workflow go from here to there" is a
 * lookup a test can enumerate, instead of a claim about control flow spread across a reducer. Every
 * state that can fail lists its failure edges here too; a failure that is not in this table cannot
 * be recorded, which is what stops an unexpected throw from parking a workflow in a state nothing
 * knows how to resume.
 */
const TRANSITIONS: Readonly<Record<WorkflowState, readonly WorkflowState[]>> = {
  CREATED: ["EVIDENCE_RESOLVING"],

  EVIDENCE_RESOLVING: ["EVIDENCE_READY", "SOURCE_UNAVAILABLE"],
  EVIDENCE_READY: ["EXTRACTION_RUNNING"],

  EXTRACTION_RUNNING: ["EXTRACTION_COMPLETE", "EXTRACTION_FAILED"],
  EXTRACTION_COMPLETE: ["CORROBORATING"],

  CORROBORATING: ["EVIDENCE_VERIFIED", "SINGLE_SOURCE", "CLAIM_CONFLICT", "CORROBORATION_FAILED"],

  // Both continue. A single-source Passport is capped, not cancelled.
  SINGLE_SOURCE: ["PASSPORT_BUILDING"],
  EVIDENCE_VERIFIED: ["PASSPORT_BUILDING"],
  CLAIM_CONFLICT: [],

  PASSPORT_BUILDING: ["PASSPORT_CANDIDATE_READY", "NEEDS_EVIDENCE"],
  PASSPORT_CANDIDATE_READY: ["ADMISSION_EVALUATING"],

  ADMISSION_EVALUATING: ["EVIDENCE_COMMIT_PENDING", "POLICY_REJECTED", "NEEDS_EVIDENCE"],

  EVIDENCE_COMMIT_PENDING: ["EVIDENCE_COMMIT_SUBMITTED", "COMMIT_FAILED"],
  EVIDENCE_COMMIT_SUBMITTED: ["EVIDENCE_COMMIT_CONFIRMED", "CONFIRMATION_UNKNOWN", "COMMIT_FAILED"],
  EVIDENCE_COMMIT_CONFIRMED: ["PASSPORT_COMMIT_PENDING"],

  PASSPORT_COMMIT_PENDING: ["PASSPORT_COMMIT_SUBMITTED", "COMMIT_FAILED"],
  PASSPORT_COMMIT_SUBMITTED: ["PASSPORT_COMMIT_CONFIRMED", "CONFIRMATION_UNKNOWN", "COMMIT_FAILED"],
  PASSPORT_COMMIT_CONFIRMED: ["RISK_REEVALUATING"],

  RISK_REEVALUATING: ["RISK_EPOCH_ACTIVATED", "RECONCILIATION_REQUIRED"],
  RISK_EPOCH_ACTIVATED: ["ACCOUNT_REEVALUATING"],
  ACCOUNT_REEVALUATING: ["COMPLETE", "RECONCILIATION_REQUIRED"],

  COMPLETE: [],

  // Recovery. Retryable failures go back to the step that failed; nothing skips forward.
  SOURCE_UNAVAILABLE: ["EVIDENCE_RESOLVING", "RECONCILIATION_REQUIRED"],
  EXTRACTION_FAILED: ["EXTRACTION_RUNNING", "RECONCILIATION_REQUIRED"],
  CORROBORATION_FAILED: ["CORROBORATING", "RECONCILIATION_REQUIRED"],
  NEEDS_EVIDENCE: ["EVIDENCE_RESOLVING", "RECONCILIATION_REQUIRED"],
  POLICY_REJECTED: [],
  COMMIT_FAILED: ["EVIDENCE_COMMIT_PENDING", "PASSPORT_COMMIT_PENDING", "RECONCILIATION_REQUIRED"],

  /**
   * The state that exists because "did my transaction land?" has three answers, not two.
   *
   * It resolves only by reading the chain. The edges back into the confirmed states are what a
   * reconciler uses after it finds the commitment already present; the edge back to PENDING is for
   * when it finds nothing and the work genuinely has to be redone.
   */
  CONFIRMATION_UNKNOWN: [
    "EVIDENCE_COMMIT_CONFIRMED",
    "PASSPORT_COMMIT_CONFIRMED",
    "EVIDENCE_COMMIT_PENDING",
    "PASSPORT_COMMIT_PENDING",
    "RECONCILIATION_REQUIRED",
  ],

  RECONCILIATION_REQUIRED: [],
};

export function canTransition(from: WorkflowState, to: WorkflowState): boolean {
  return TRANSITIONS[from].includes(to);
}

export function nextStates(from: WorkflowState): readonly WorkflowState[] {
  return TRANSITIONS[from];
}

export class IllegalTransition extends Error {
  readonly code = "ILLEGAL_TRANSITION";
  constructor(
    readonly from: WorkflowState,
    readonly to: WorkflowState,
  ) {
    super(
      `${from} -> ${to} is not a legal workflow transition. Legal from ${from}: ` +
        (TRANSITIONS[from].length === 0 ? "(terminal)" : TRANSITIONS[from].join(", ")),
    );
    this.name = "IllegalTransition";
  }
}

// ---------------------------------------------------------------------------------- identity

export interface WorkflowIdentity {
  readonly assetId: Hex32;
  /** Ascending. The same evidence in a different order is the same work. */
  readonly evidenceIds: readonly Hex32[];
  readonly passportSchemaVersion: string;
  readonly admissionPolicyVersion: string;
}

/**
 * Stable identity for one logical unit of work.
 *
 * Derived from the inputs rather than assigned, so a duplicate delivery, a retried webhook and a
 * worker that restarted mid-run all resolve to the same workflow. Evidence ids are sorted first:
 * two callers that discovered the same documents in different orders are doing the same work, and
 * an identity that disagreed would let both of them commit.
 *
 * The schema and policy versions are in the key on purpose. Re-running the same evidence under a
 * changed admission policy is genuinely different work and deserves its own workflow — collapsing
 * them would make a policy change silently invisible.
 */
export function workflowIdFor(id: WorkflowIdentity): Hex32 {
  const canonical = JSON.stringify({
    assetId: id.assetId.toLowerCase(),
    evidenceIds: [...id.evidenceIds].map((e) => e.toLowerCase()).sort(),
    passportSchemaVersion: id.passportSchemaVersion,
    admissionPolicyVersion: id.admissionPolicyVersion,
  });
  return keccak256(stringToBytes(canonical));
}

// ---------------------------------------------------------------------------------- record

export interface WorkflowTransition {
  readonly at: UnixSeconds;
  readonly from: WorkflowState;
  readonly to: WorkflowState;
  readonly note: string | null;
}

export interface WorkflowTransactionRef {
  readonly label: string;
  readonly txHash: `0x${string}`;
  readonly blockNumber: number | null;
  readonly status: "submitted" | "success" | "reverted";
}

export interface WorkflowRecord {
  readonly workflowId: Hex32;
  readonly identity: WorkflowIdentity;
  readonly chainId: number;
  readonly state: WorkflowState;
  readonly candidateId: Hex32 | null;
  readonly passportVersion: number | null;
  readonly evidenceRoot: Hex32 | null;
  readonly claimsRoot: Hex32 | null;
  readonly singleSource: boolean | null;
  readonly riskEpoch: number | null;
  readonly transactions: readonly WorkflowTransactionRef[];
  readonly history: readonly WorkflowTransition[];
  readonly failureReason: string | null;
  readonly attempts: number;
  readonly createdAt: UnixSeconds;
  readonly updatedAt: UnixSeconds;
}

export function createWorkflow(
  identity: WorkflowIdentity,
  chainId: number,
  now: UnixSeconds,
): WorkflowRecord {
  return {
    workflowId: workflowIdFor(identity),
    identity,
    chainId,
    state: "CREATED",
    candidateId: null,
    passportVersion: null,
    evidenceRoot: null,
    claimsRoot: null,
    singleSource: null,
    riskEpoch: null,
    transactions: [],
    history: [],
    failureReason: null,
    attempts: 0,
    createdAt: now,
    updatedAt: now,
  };
}

export interface AdvanceOptions {
  readonly note?: string | null;
  readonly failureReason?: string | null;
  readonly patch?: Partial<
    Pick<
      WorkflowRecord,
      "candidateId" | "passportVersion" | "evidenceRoot" | "claimsRoot" | "singleSource" | "riskEpoch"
    >
  >;
  readonly transaction?: WorkflowTransactionRef;
}

/**
 * Move a workflow, refusing anything the graph does not allow.
 *
 * Pure. Persistence is somebody else's job, which is what makes the transition rules testable
 * without a filesystem and what stops a storage bug from looking like a state-machine bug.
 */
export function advance(
  record: WorkflowRecord,
  to: WorkflowState,
  now: UnixSeconds,
  options: AdvanceOptions = {},
): WorkflowRecord {
  if (!canTransition(record.state, to)) throw new IllegalTransition(record.state, to);

  return {
    ...record,
    ...(options.patch ?? {}),
    state: to,
    // Counted per commit attempt rather than per transition, so backoff reflects work actually
    // sent rather than bookkeeping.
    attempts: to === "EVIDENCE_COMMIT_SUBMITTED" || to === "PASSPORT_COMMIT_SUBMITTED"
      ? record.attempts + 1
      : record.attempts,
    transactions: options.transaction
      ? [...record.transactions.filter((t) => t.txHash !== options.transaction!.txHash), options.transaction]
      : record.transactions,
    history: [...record.history, { at: now, from: record.state, to, note: options.note ?? null }],
    failureReason: options.failureReason ?? (isTerminal(to) ? record.failureReason : null),
    updatedAt: now,
  };
}

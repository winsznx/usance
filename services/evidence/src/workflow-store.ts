import { mkdirSync, readFileSync, writeFileSync, renameSync, readdirSync, existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import type { Hex32, UnixSeconds } from "@usance/schemas";
import {
  advance,
  createWorkflow,
  isTerminal,
  workflowIdFor,
  type AdvanceOptions,
  type WorkflowIdentity,
  type WorkflowRecord,
  type WorkflowState,
} from "./workflow";

/**
 * Durable workflow storage.
 *
 * The requirement is narrow and load-bearing: workflow state must survive the process. An in-memory
 * map is fine right up to the moment a worker dies between submitting a transaction and recording
 * that it did, which is precisely the moment the state matters — that is the crash that produces a
 * double commit.
 *
 * One file per workflow, written to a temporary path and renamed. A rename on the same filesystem
 * is atomic, so a reader sees the previous record or the new one and never a truncated one. This is
 * the same rule the generated verification artifacts follow, for the same reason.
 *
 * A relational implementation would use the transitions in `workflow.ts` as a CHECK constraint and
 * an optimistic-concurrency column. The interface below is shaped so that swap needs no caller
 * changes: `save` takes the record it expects to be replacing.
 */

export interface WorkflowStore {
  get(workflowId: Hex32): Promise<WorkflowRecord | null>;
  /**
   * Persist a record.
   *
   * `expectedUpdatedAt` is optimistic concurrency. Two workers that both read a workflow and both
   * try to advance it would otherwise silently overwrite each other, and the loser's transaction
   * would still be on chain with nothing recording it.
   */
  save(record: WorkflowRecord, expectedUpdatedAt?: UnixSeconds | null): Promise<WorkflowRecord>;
  list(state?: WorkflowState): Promise<readonly WorkflowRecord[]>;
  /** Workflows that are mid-flight onchain, which is what a reconciler needs to find after a crash. */
  resumable(): Promise<readonly WorkflowRecord[]>;
}

export class WorkflowConflict extends Error {
  readonly code = "WORKFLOW_CONFLICT";
  constructor(readonly workflowId: Hex32) {
    super(`workflow ${workflowId} changed underneath this writer; re-read and retry`);
    this.name = "WorkflowConflict";
  }
}

const RESUMABLE: readonly WorkflowState[] = [
  "EVIDENCE_COMMIT_SUBMITTED",
  "PASSPORT_COMMIT_SUBMITTED",
  "CONFIRMATION_UNKNOWN",
  "COMMIT_FAILED",
];

export class FileSystemWorkflowStore implements WorkflowStore {
  readonly name = "fs-workflow-store/1";

  constructor(private readonly root: string) {
    mkdirSync(root, { recursive: true });
  }

  private path(workflowId: Hex32): string {
    return resolve(this.root, `${workflowId}.json`);
  }

  async get(workflowId: Hex32): Promise<WorkflowRecord | null> {
    const p = this.path(workflowId);
    if (!existsSync(p)) return null;
    return JSON.parse(readFileSync(p, "utf8")) as WorkflowRecord;
  }

  async save(record: WorkflowRecord, expectedUpdatedAt?: UnixSeconds | null): Promise<WorkflowRecord> {
    if (expectedUpdatedAt !== undefined) {
      const current = await this.get(record.workflowId);
      const currentStamp = current?.updatedAt ?? null;
      if (currentStamp !== expectedUpdatedAt) throw new WorkflowConflict(record.workflowId);
    }

    const p = this.path(record.workflowId);
    const tmp = `${p}.tmp-${process.pid}`;
    try {
      writeFileSync(tmp, JSON.stringify(record, null, 2) + "\n");
      renameSync(tmp, p);
    } catch (e) {
      rmSync(tmp, { force: true });
      throw e;
    }
    return record;
  }

  async list(state?: WorkflowState): Promise<readonly WorkflowRecord[]> {
    if (!existsSync(this.root)) return [];
    const out: WorkflowRecord[] = [];
    for (const f of readdirSync(this.root)) {
      if (!f.endsWith(".json")) continue;
      const r = JSON.parse(readFileSync(resolve(this.root, f), "utf8")) as WorkflowRecord;
      if (state === undefined || r.state === state) out.push(r);
    }
    return out.sort((a, b) => a.createdAt - b.createdAt);
  }

  async resumable(): Promise<readonly WorkflowRecord[]> {
    const all = await this.list();
    return all.filter((r) => RESUMABLE.includes(r.state));
  }
}

/** Non-durable, for tests that are about transition logic rather than storage. */
export class InMemoryWorkflowStore implements WorkflowStore {
  readonly name = "in-memory-workflow-store/1";
  private readonly records = new Map<Hex32, WorkflowRecord>();

  async get(workflowId: Hex32): Promise<WorkflowRecord | null> {
    return this.records.get(workflowId) ?? null;
  }
  async save(record: WorkflowRecord, expectedUpdatedAt?: UnixSeconds | null): Promise<WorkflowRecord> {
    if (expectedUpdatedAt !== undefined) {
      const currentStamp = this.records.get(record.workflowId)?.updatedAt ?? null;
      if (currentStamp !== expectedUpdatedAt) throw new WorkflowConflict(record.workflowId);
    }
    this.records.set(record.workflowId, record);
    return record;
  }
  async list(state?: WorkflowState): Promise<readonly WorkflowRecord[]> {
    return [...this.records.values()]
      .filter((r) => state === undefined || r.state === state)
      .sort((a, b) => a.createdAt - b.createdAt);
  }
  async resumable(): Promise<readonly WorkflowRecord[]> {
    return (await this.list()).filter((r) => RESUMABLE.includes(r.state));
  }
}

// ---------------------------------------------------------------------------------- driver

/**
 * Get or create the workflow for a set of inputs.
 *
 * Idempotent by construction: the id is derived from the inputs, so a duplicate delivery finds the
 * existing record rather than starting a second run against the same evidence. A terminal workflow
 * is returned untouched — a repeat submission must not resurrect something an operator has already
 * been asked to look at, and must not re-run something that already committed.
 */
export async function openWorkflow(
  store: WorkflowStore,
  identity: WorkflowIdentity,
  chainId: number,
  now: UnixSeconds,
): Promise<{ record: WorkflowRecord; created: boolean }> {
  const workflowId = workflowIdFor(identity);
  const existing = await store.get(workflowId);
  if (existing) return { record: existing, created: false };

  const record = createWorkflow(identity, chainId, now);
  await store.save(record, null);
  return { record, created: true };
}

/** Advance and persist under optimistic concurrency, so two workers cannot both win. */
export async function step(
  store: WorkflowStore,
  record: WorkflowRecord,
  to: WorkflowState,
  now: UnixSeconds,
  options?: AdvanceOptions,
): Promise<WorkflowRecord> {
  const next = advance(record, to, now, options);
  return store.save(next, record.updatedAt);
}

/**
 * What the chain says about a workflow's commitments.
 *
 * Deliberately a narrow interface rather than a viem client: reconciliation is the one place that
 * must be testable without a node, because the cases worth testing are the ones where the node
 * disagreed with local state.
 */
export interface ChainView {
  /** True when this evidence id is committed against this asset and usable. */
  evidenceIsCommitted(assetId: Hex32, evidenceId: Hex32): Promise<boolean>;
  /** The Passport version currently onchain for this asset, or 0. */
  currentPassportVersion(assetId: Hex32): Promise<number>;
  currentRiskEpoch(): Promise<number>;
}

export interface ReconcileResult {
  readonly record: WorkflowRecord;
  readonly action: "ALREADY_DONE" | "RESUBMIT" | "ESCALATED" | "NOTHING_TO_DO";
  readonly detail: string;
}

/**
 * Resolve a workflow whose submission outcome is unknown, by asking the chain.
 *
 * This is the function that stops the crash-then-retry loop from double-committing. The rule it
 * enforces is that "did my transaction land?" is answered by the registry and never by local state,
 * a receipt that may not have arrived, or an assumption that a timeout means failure.
 *
 * `maxAttempts` bounds resubmission. A workflow that has burned its attempts goes to
 * `RECONCILIATION_REQUIRED` and stops, because the failure mode of an unbounded retry against a
 * chain is spending real money on the same revert forever.
 */
export async function reconcile(
  store: WorkflowStore,
  record: WorkflowRecord,
  chain: ChainView,
  now: UnixSeconds,
  maxAttempts = 5,
): Promise<ReconcileResult> {
  if (isTerminal(record.state)) {
    return { record, action: "NOTHING_TO_DO", detail: `already terminal in ${record.state}` };
  }

  const { assetId, evidenceIds } = record.identity;

  // A reconciler looking at a SUBMITTED workflow is, by definition, unsure whether it landed — that
  // is the only reason to be reconciling it. So record that first and resolve from there, rather
  // than widening the graph so SUBMITTED can jump straight back to PENDING.
  //
  // Keeping SUBMITTED narrow is what makes "this workflow sent something and nobody has checked"
  // distinguishable from "this workflow sent something and we know it did not land". Every
  // resolution edge already exists on CONFIRMATION_UNKNOWN; duplicating them onto SUBMITTED would
  // mean two places to keep in step.
  let current = record;
  const wasSubmitted =
    current.state === "EVIDENCE_COMMIT_SUBMITTED" || current.state === "PASSPORT_COMMIT_SUBMITTED";
  const submittedStage = current.state;

  if (wasSubmitted) {
    current = await step(store, current, "CONFIRMATION_UNKNOWN", now, {
      note: `reconciling ${submittedStage}: the submission outcome has not been confirmed locally`,
    });
  }
  record = current;

  if (submittedStage === "EVIDENCE_COMMIT_SUBMITTED" || record.state === "CONFIRMATION_UNKNOWN") {
    const committed = await Promise.all(evidenceIds.map((id) => chain.evidenceIsCommitted(assetId, id)));
    if (committed.every(Boolean)) {
      const next = await step(store, record, "EVIDENCE_COMMIT_CONFIRMED", now, {
        note: "recovered from chain: every cited evidence id is committed",
      });
      return { record: next, action: "ALREADY_DONE", detail: "evidence was already onchain" };
    }
  }

  if (submittedStage === "PASSPORT_COMMIT_SUBMITTED" || record.state === "CONFIRMATION_UNKNOWN") {
    const onchain = await chain.currentPassportVersion(assetId);
    if (record.passportVersion !== null && onchain >= record.passportVersion) {
      const next = await step(store, record, "PASSPORT_COMMIT_CONFIRMED", now, {
        note: `recovered from chain: registry reports version ${onchain}`,
        patch: { riskEpoch: await chain.currentRiskEpoch() },
      });
      return { record: next, action: "ALREADY_DONE", detail: `Passport v${onchain} was already onchain` };
    }
  }

  if (record.attempts >= maxAttempts) {
    const next = await step(store, record, "RECONCILIATION_REQUIRED", now, {
      failureReason: `${record.attempts} submission attempts without a confirmed commit`,
      note: "attempts exhausted",
    });
    return { record: next, action: "ESCALATED", detail: "attempts exhausted; a human owns this" };
  }

  // Nothing landed. Going back to PENDING is the only path that resubmits, and it is reached only
  // after the chain has been asked and has said no.
  const target: WorkflowState =
    submittedStage === "PASSPORT_COMMIT_SUBMITTED" || record.passportVersion !== null
      ? "PASSPORT_COMMIT_PENDING"
      : "EVIDENCE_COMMIT_PENDING";

  const next = await step(store, record, target, now, {
    note: "chain has no record of the submission; the work must be redone",
  });
  return { record: next, action: "RESUBMIT", detail: `nothing onchain; returned to ${target}` };
}

// ---------------------------------------------------------------------------------- receipts

/**
 * Project a workflow onto the existing receipt model.
 *
 * Deliberately a projection rather than a second receipt family. A workflow and a receipt describe
 * the same events at different resolutions — the workflow is the machine's view and the receipt is
 * the reader's — and giving them separate storage guarantees they eventually disagree about what
 * happened.
 *
 * Status maps to the workflow's own vocabulary rather than being inferred from whether a hash
 * exists. `CONFIRMATION_UNKNOWN` is a real receipt status for the same reason it is a real workflow
 * state: "we submitted and do not know" is an answer, and flattening it into either success or
 * failure is a lie in one direction or the other.
 */
export function workflowReceiptStatus(state: WorkflowState): string {
  if (state === "COMPLETE") return "CONFIRMED";
  if (state === "CONFIRMATION_UNKNOWN") return "CONFIRMATION_UNKNOWN";
  if (state === "POLICY_REJECTED" || state === "CLAIM_CONFLICT") return "REJECTED_BY_POLICY";
  if (state === "RECONCILIATION_REQUIRED") return "FAILED";
  if (state.endsWith("_SUBMITTED")) return "SUBMITTED";
  if (state.endsWith("_FAILED") || state === "SOURCE_UNAVAILABLE" || state === "NEEDS_EVIDENCE") return "FAILED";
  return "PENDING";
}

export interface WorkflowReceiptView {
  readonly workflowId: Hex32;
  readonly assetId: Hex32;
  readonly evidenceIds: readonly Hex32[];
  readonly candidateId: Hex32 | null;
  readonly passportVersion: number | null;
  readonly state: WorkflowState;
  readonly status: string;
  readonly chainId: number;
  readonly transactions: WorkflowRecord["transactions"];
  readonly failureReason: string | null;
  readonly createdAt: UnixSeconds;
  readonly updatedAt: UnixSeconds;
}

export function toReceiptView(record: WorkflowRecord): WorkflowReceiptView {
  return {
    workflowId: record.workflowId,
    assetId: record.identity.assetId,
    evidenceIds: record.identity.evidenceIds,
    candidateId: record.candidateId,
    passportVersion: record.passportVersion,
    state: record.state,
    status: workflowReceiptStatus(record.state),
    chainId: record.chainId,
    // Only transactions that reached a block. A submitted-but-unconfirmed hash belongs in the
    // workflow record, where it is evidence for the reconciler, and not on a public receipt, where
    // it reads as a thing that happened.
    transactions: record.transactions.filter((t) => t.status !== "submitted"),
    failureReason: record.failureReason,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

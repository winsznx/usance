import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import type { Hex32 } from "@usance/schemas";
import {
  WORKFLOW_STATES,
  TERMINAL_STATES,
  advance,
  canTransition,
  createWorkflow,
  isTerminal,
  nextStates,
  workflowIdFor,
  IllegalTransition,
  type WorkflowRecord,
  type WorkflowState,
} from "../src/workflow";
import {
  FileSystemWorkflowStore,
  InMemoryWorkflowStore,
  WorkflowConflict,
  openWorkflow,
  reconcile,
  step,
  type ChainView,
} from "../src/workflow-store";

const ASSET = `0x${"aa".repeat(32)}` as Hex32;
const EV1 = `0x${"11".repeat(32)}` as Hex32;
const EV2 = `0x${"22".repeat(32)}` as Hex32;

const identity = (evidenceIds: readonly Hex32[] = [EV1, EV2]) => ({
  assetId: ASSET,
  evidenceIds,
  passportSchemaVersion: "passport/1",
  admissionPolicyVersion: "admission/2026-08",
});

/** Walk a workflow to `target` through legal edges only, so tests set up state the way reality does. */
async function driveTo(store: InMemoryWorkflowStore, target: WorkflowState): Promise<WorkflowRecord> {
  const path: Array<[WorkflowState, Parameters<typeof step>[4]?]> = [
    ["EVIDENCE_RESOLVING"],
    ["EVIDENCE_READY"],
    ["EXTRACTION_RUNNING"],
    ["EXTRACTION_COMPLETE"],
    ["CORROBORATING"],
    ["EVIDENCE_VERIFIED"],
    ["PASSPORT_BUILDING"],
    ["PASSPORT_CANDIDATE_READY"],
    ["ADMISSION_EVALUATING"],
    ["EVIDENCE_COMMIT_PENDING"],
    ["EVIDENCE_COMMIT_SUBMITTED"],
    ["EVIDENCE_COMMIT_CONFIRMED"],
    ["PASSPORT_COMMIT_PENDING"],
    ["PASSPORT_COMMIT_SUBMITTED", { patch: { passportVersion: 1 } }],
    ["PASSPORT_COMMIT_CONFIRMED"],
    ["RISK_REEVALUATING"],
    ["RISK_EPOCH_ACTIVATED"],
    ["ACCOUNT_REEVALUATING"],
    ["COMPLETE"],
  ];

  let { record } = await openWorkflow(store, identity(), 1952, 1_000);
  let t = 1_000;
  for (const [state, opts] of path) {
    record = await step(store, record, state, ++t, opts);
    if (state === target) return record;
  }
  return record;
}

describe("workflow transition graph", () => {
  it("every declared state appears in the graph", () => {
    for (const s of WORKFLOW_STATES) expect(() => nextStates(s)).not.toThrow();
  });

  it("every state is reachable from CREATED", () => {
    const seen = new Set<WorkflowState>(["CREATED"]);
    const queue: WorkflowState[] = ["CREATED"];
    while (queue.length > 0) {
      for (const n of nextStates(queue.shift()!)) {
        if (!seen.has(n)) {
          seen.add(n);
          queue.push(n);
        }
      }
    }
    // An unreachable state is dead code that reads like a handled case.
    expect([...WORKFLOW_STATES].filter((s) => !seen.has(s))).toEqual([]);
  });

  it("terminal states have no outgoing edges and every dead end is declared terminal", () => {
    for (const s of WORKFLOW_STATES) {
      expect(nextStates(s).length === 0).toBe(isTerminal(s));
    }
    for (const s of Object.keys(TERMINAL_STATES)) expect(WORKFLOW_STATES).toContain(s);
  });

  it("failure states are distinct rather than collapsed into one", () => {
    // The whole point of the failure half of the graph: each names an action.
    for (const s of ["SOURCE_UNAVAILABLE", "EXTRACTION_FAILED", "CORROBORATION_FAILED", "COMMIT_FAILED"] as const) {
      expect(WORKFLOW_STATES).toContain(s);
    }
    expect(WORKFLOW_STATES).not.toContain("FAILED" as WorkflowState);
  });

  it("a single-source Passport continues rather than dead-ending", () => {
    // A degraded provider must not look like a rejected asset.
    expect(canTransition("SINGLE_SOURCE", "PASSPORT_BUILDING")).toBe(true);
    expect(isTerminal("SINGLE_SOURCE")).toBe(false);
  });

  it("a claim conflict is terminal and is not retried", () => {
    expect(isTerminal("CLAIM_CONFLICT")).toBe(true);
    expect(nextStates("CLAIM_CONFLICT")).toEqual([]);
  });

  it("nothing skips the evidence commit to reach the Passport commit", () => {
    expect(canTransition("EVIDENCE_COMMIT_PENDING", "PASSPORT_COMMIT_PENDING")).toBe(false);
    expect(canTransition("ADMISSION_EVALUATING", "PASSPORT_COMMIT_PENDING")).toBe(false);
    expect(canTransition("EVIDENCE_COMMIT_CONFIRMED", "PASSPORT_COMMIT_PENDING")).toBe(true);
  });

  it("an illegal transition throws and names what was legal", () => {
    const r = createWorkflow(identity(), 1952, 1);
    expect(() => advance(r, "COMPLETE", 2)).toThrow(IllegalTransition);
    try {
      advance(r, "COMPLETE", 2);
    } catch (e) {
      expect((e as Error).message).toContain("EVIDENCE_RESOLVING");
    }
  });
});

describe("workflow identity", () => {
  it("is derived from inputs, so a duplicate delivery is the same workflow", () => {
    expect(workflowIdFor(identity())).toBe(workflowIdFor(identity()));
  });

  it("does not depend on the order evidence was discovered in", () => {
    expect(workflowIdFor(identity([EV1, EV2]))).toBe(workflowIdFor(identity([EV2, EV1])));
  });

  it("changes when the admission policy changes", () => {
    // Re-running the same evidence under a changed policy is different work. Collapsing them would
    // make a policy change silently invisible.
    const other = { ...identity(), admissionPolicyVersion: "admission/2027-01" };
    expect(workflowIdFor(other)).not.toBe(workflowIdFor(identity()));
  });

  it("changes when the evidence set changes", () => {
    expect(workflowIdFor(identity([EV1]))).not.toBe(workflowIdFor(identity([EV1, EV2])));
  });
});

describe("durability", () => {
  let dir: string;
  beforeEach(() => (dir = mkdtempSync(resolve(tmpdir(), "usance-wf-"))));
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("state survives the process that created it", async () => {
    const first = new FileSystemWorkflowStore(dir);
    const { record } = await openWorkflow(first, identity(), 1952, 1_000);
    await step(first, record, "EVIDENCE_RESOLVING", 1_001);

    // A brand new store object, as a restarted worker would have.
    const second = new FileSystemWorkflowStore(dir);
    const recovered = await second.get(record.workflowId);
    expect(recovered?.state).toBe("EVIDENCE_RESOLVING");
    expect(recovered?.identity.assetId).toBe(ASSET);
  });

  it("two workers cannot both advance the same workflow", async () => {
    const store = new FileSystemWorkflowStore(dir);
    const { record } = await openWorkflow(store, identity(), 1952, 1_000);

    await step(store, record, "EVIDENCE_RESOLVING", 1_001);
    // The second worker is holding the record it read before the first one moved it. Without the
    // concurrency check its write would win silently and the first worker's transaction would be on
    // chain with nothing recording it.
    await expect(step(store, record, "EVIDENCE_RESOLVING", 1_002)).rejects.toBeInstanceOf(WorkflowConflict);
  });

  it("a failed write leaves the previous record intact rather than truncated", async () => {
    const store = new FileSystemWorkflowStore(dir);
    const { record } = await openWorkflow(store, identity(), 1952, 1_000);
    const moved = await step(store, record, "EVIDENCE_RESOLVING", 1_001);

    const circular = { ...moved } as unknown as Record<string, unknown>;
    circular["self"] = circular;
    await expect(store.save(circular as unknown as WorkflowRecord)).rejects.toThrow();

    expect((await store.get(record.workflowId))?.state).toBe("EVIDENCE_RESOLVING");
    expect(readdirSync(dir).filter((f) => f.includes(".tmp-"))).toEqual([]);
  });

  it("mid-flight workflows are findable after a restart", async () => {
    const store = new FileSystemWorkflowStore(dir);
    const mem = new InMemoryWorkflowStore();
    const submitted = await driveTo(mem, "PASSPORT_COMMIT_SUBMITTED");
    await store.save(submitted);

    const resumable = await new FileSystemWorkflowStore(dir).resumable();
    expect(resumable.map((r) => r.state)).toEqual(["PASSPORT_COMMIT_SUBMITTED"]);
  });
});

describe("idempotency and reconciliation", () => {
  const chainWith = (over: Partial<ChainView> = {}): ChainView => ({
    evidenceIsCommitted: async () => false,
    currentPassportVersion: async () => 0,
    currentRiskEpoch: async () => 1,
    ...over,
  });

  it("opening the same work twice returns one workflow", async () => {
    const store = new InMemoryWorkflowStore();
    const a = await openWorkflow(store, identity(), 1952, 1_000);
    const b = await openWorkflow(store, identity(), 1952, 2_000);

    expect(a.created).toBe(true);
    expect(b.created).toBe(false);
    expect(b.record.workflowId).toBe(a.record.workflowId);
    expect((await store.list()).length).toBe(1);
  });

  it("a duplicate delivery does not resurrect a terminal workflow", async () => {
    const store = new InMemoryWorkflowStore();
    const done = await driveTo(store, "COMPLETE");

    const again = await openWorkflow(store, identity(), 1952, 9_999);
    expect(again.created).toBe(false);
    expect(again.record.state).toBe("COMPLETE");
    expect(again.record.updatedAt).toBe(done.updatedAt);
  });

  it("a crash after the evidence submission is resolved by reading the chain, not by resending", async () => {
    const store = new InMemoryWorkflowStore();
    const submitted = await driveTo(store, "EVIDENCE_COMMIT_SUBMITTED");

    const r = await reconcile(store, submitted, chainWith({ evidenceIsCommitted: async () => true }), 5_000);
    expect(r.action).toBe("ALREADY_DONE");
    expect(r.record.state).toBe("EVIDENCE_COMMIT_CONFIRMED");
  });

  it("a crash after the Passport submission is resolved by reading the registry", async () => {
    const store = new InMemoryWorkflowStore();
    const submitted = await driveTo(store, "PASSPORT_COMMIT_SUBMITTED");

    const r = await reconcile(
      store,
      submitted,
      chainWith({ currentPassportVersion: async () => 1, currentRiskEpoch: async () => 7 }),
      5_000,
    );
    expect(r.action).toBe("ALREADY_DONE");
    expect(r.record.state).toBe("PASSPORT_COMMIT_CONFIRMED");
    expect(r.record.riskEpoch).toBe(7);
  });

  it("an RPC timeout after a successful transaction does not produce a second commit", async () => {
    const store = new InMemoryWorkflowStore();
    let submissions = 0;
    const submitted = await driveTo(store, "EVIDENCE_COMMIT_SUBMITTED");

    // The worker saw a timeout and knows nothing. It asks the chain; the chain says it landed.
    const unknown = await step(store, submitted, "CONFIRMATION_UNKNOWN", 4_000, {
      note: "RPC timed out waiting for the receipt",
    });
    const r = await reconcile(
      store,
      unknown,
      chainWith({
        evidenceIsCommitted: async () => {
          submissions++;
          return true;
        },
      }),
      5_000,
    );

    expect(r.record.state).toBe("EVIDENCE_COMMIT_CONFIRMED");
    expect(submissions).toBeGreaterThan(0);
    expect(r.action).not.toBe("RESUBMIT");
  });

  it("when the chain has no record, the work is redone rather than assumed done", async () => {
    const store = new InMemoryWorkflowStore();
    const submitted = await driveTo(store, "EVIDENCE_COMMIT_SUBMITTED");

    const r = await reconcile(store, submitted, chainWith(), 5_000);
    expect(r.action).toBe("RESUBMIT");
    expect(r.record.state).toBe("EVIDENCE_COMMIT_PENDING");
  });

  it("partial evidence confirmation does not count as confirmed", async () => {
    const store = new InMemoryWorkflowStore();
    const submitted = await driveTo(store, "EVIDENCE_COMMIT_SUBMITTED");

    // One of two landed. Advancing here would let a Passport commit citing evidence that is not on
    // chain — which the registry would reject, after the gas was spent.
    const r = await reconcile(
      store,
      submitted,
      chainWith({ evidenceIsCommitted: async (_a, id) => id === EV1 }),
      5_000,
    );
    expect(r.action).toBe("RESUBMIT");
  });

  it("attempts are bounded; an unresolvable workflow escalates instead of retrying forever", async () => {
    const store = new InMemoryWorkflowStore();
    let record = await driveTo(store, "EVIDENCE_COMMIT_SUBMITTED");
    record = { ...record, attempts: 5 };
    await store.save(record);

    const r = await reconcile(store, record, chainWith(), 5_000, 5);
    expect(r.action).toBe("ESCALATED");
    expect(r.record.state).toBe("RECONCILIATION_REQUIRED");
    expect(r.record.failureReason).toContain("attempts");
  });

  it("reconciling a finished workflow does nothing", async () => {
    const store = new InMemoryWorkflowStore();
    const done = await driveTo(store, "COMPLETE");
    const r = await reconcile(store, done, chainWith(), 9_000);
    expect(r.action).toBe("NOTHING_TO_DO");
    expect(r.record.state).toBe("COMPLETE");
  });

  it("attempts count submissions, not bookkeeping", async () => {
    const store = new InMemoryWorkflowStore();
    const record = await driveTo(store, "EVIDENCE_COMMIT_SUBMITTED");
    // One submission on the way here; the ten transitions before it are not attempts.
    expect(record.attempts).toBe(1);
  });
});

describe("workflow receipts", () => {
  it("a completed workflow carries everything a receipt needs", async () => {
    const store = new InMemoryWorkflowStore();
    const done = await driveTo(store, "COMPLETE");

    expect(done.workflowId).toMatch(/^0x[0-9a-f]{64}$/);
    expect(done.identity.assetId).toBe(ASSET);
    expect(done.identity.evidenceIds).toEqual([EV1, EV2]);
    expect(done.passportVersion).toBe(1);
    expect(done.state).toBe("COMPLETE");
    expect(done.createdAt).toBeLessThan(done.updatedAt);
    expect(done.history.length).toBeGreaterThan(10);
    expect(done.failureReason).toBeNull();
  });

  it("the history is a full audit trail, not just the current state", async () => {
    const store = new InMemoryWorkflowStore();
    const done = await driveTo(store, "COMPLETE");

    expect(done.history[0]).toMatchObject({ from: "CREATED", to: "EVIDENCE_RESOLVING" });
    expect(done.history.at(-1)).toMatchObject({ to: "COMPLETE" });
    // Every recorded hop is a legal edge; the record cannot describe a path the graph forbids.
    for (const h of done.history) expect(canTransition(h.from, h.to)).toBe(true);
  });

  it("a transaction recorded twice appears once", async () => {
    const store = new InMemoryWorkflowStore();
    const { record } = await openWorkflow(store, identity(), 1952, 1_000);
    const tx = { label: "commit", txHash: `0x${"cd".repeat(32)}` as const, blockNumber: 1, status: "success" as const };

    const a = advance(record, "EVIDENCE_RESOLVING", 1_001, { transaction: tx });
    const b = advance(a, "EVIDENCE_READY", 1_002, { transaction: { ...tx, blockNumber: 2 } });
    expect(b.transactions.length).toBe(1);
    expect(b.transactions[0]?.blockNumber).toBe(2);
  });
});

describe("workflow receipt projection", () => {
  it("maps each workflow state onto a receipt status the reader model already has", async () => {
    const { workflowReceiptStatus } = await import("../src/workflow-store");
    expect(workflowReceiptStatus("COMPLETE")).toBe("CONFIRMED");
    expect(workflowReceiptStatus("CONFIRMATION_UNKNOWN")).toBe("CONFIRMATION_UNKNOWN");
    expect(workflowReceiptStatus("CLAIM_CONFLICT")).toBe("REJECTED_BY_POLICY");
    expect(workflowReceiptStatus("POLICY_REJECTED")).toBe("REJECTED_BY_POLICY");
    expect(workflowReceiptStatus("RECONCILIATION_REQUIRED")).toBe("FAILED");
    expect(workflowReceiptStatus("EXTRACTION_FAILED")).toBe("FAILED");
    expect(workflowReceiptStatus("PASSPORT_COMMIT_SUBMITTED")).toBe("SUBMITTED");
    expect(workflowReceiptStatus("CORROBORATING")).toBe("PENDING");
  });

  it("every workflow state maps to a status the receipt schema accepts", async () => {
    const { workflowReceiptStatus } = await import("../src/workflow-store");
    const { receiptStatusSchema } = await import("../src/receipt");
    for (const s of WORKFLOW_STATES) {
      expect(() => receiptStatusSchema.parse(workflowReceiptStatus(s))).not.toThrow();
    }
  });

  it("an unconfirmed submission does not appear on the public view", async () => {
    const { toReceiptView } = await import("../src/workflow-store");
    const store = new InMemoryWorkflowStore();
    const { record } = await openWorkflow(store, identity(), 1952, 1_000);

    const withPending = advance(record, "EVIDENCE_RESOLVING", 1_001, {
      transaction: { label: "commit", txHash: `0x${"ef".repeat(32)}`, blockNumber: null, status: "submitted" },
    });
    // It stays on the workflow record, where a reconciler needs it.
    expect(withPending.transactions.length).toBe(1);
    // It does not reach the receipt, where it would read as a thing that happened.
    expect(toReceiptView(withPending).transactions).toEqual([]);
  });
});

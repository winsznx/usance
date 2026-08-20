import { describe, expect, it } from "vitest";
import type { Hex32, RunState } from "@usance/schemas";
import { accountHealthTrigger, InMemoryRunStore, openRun, RunConflict, stepRun } from "../src/index";

const ADDR = (n: number): `0x${string}` => `0x${n.toString(16).padStart(40, "0")}`;
const ID = (n: number): Hex32 => `0x${n.toString(16).padStart(64, "0")}` as Hex32;

const owner = ADDR(0xa11ce);
const instanceId = ID(1);

describe("run store", () => {
  it("openRun is idempotent for the same trigger occurrence (I-63)", async () => {
    const store = new InMemoryRunStore();
    const trigger = accountHealthTrigger(owner, "MARGIN_CALL", 100, 1000);
    const a = await openRun(store, instanceId, trigger, 1, 1000);
    const b = await openRun(store, instanceId, trigger, 1, 1005);
    expect(a.created).toBe(true);
    expect(b.created).toBe(false);
    expect(b.record.runId).toBe(a.record.runId);
  });

  it("stepRun refuses a stale writer under optimistic concurrency", async () => {
    const store = new InMemoryRunStore();
    const trigger = accountHealthTrigger(owner, "MARGIN_CALL", 100, 1000);
    const { record } = await openRun(store, instanceId, trigger, 1, 1000);
    await stepRun(store, record, "TRIGGER_VALIDATED", 1001);
    // A second writer holding the stale original record must lose.
    await expect(stepRun(store, record, "BLOCKED_BY_POLICY", 1002)).rejects.toBeInstanceOf(RunConflict);
  });

  it("surfaces mid-flight runs as resumable and terminal runs as not", async () => {
    const store = new InMemoryRunStore();
    const trigger = accountHealthTrigger(owner, "MARGIN_CALL", 100, 1000);
    let { record } = await openRun(store, instanceId, trigger, 1, 1000);
    const path: RunState[] = [
      "TRIGGER_VALIDATED",
      "SNAPSHOT_PINNING",
      "SNAPSHOT_PINNED",
      "PLANNING",
      "PLAN_READY",
      "AUTHORIZATION_CHECKING",
      "AUTHORIZED",
      "SUBMITTING",
      "SUBMITTED",
    ];
    let clock = 1001;
    for (const to of path) record = await stepRun(store, record, to, clock++);

    const resumable = await store.resumable();
    expect(resumable.map((r) => r.runId)).toContain(record.runId);

    // Drive it home; a COMPLETE run is no longer resumable.
    for (const to of ["FILLED", "RECONCILING", "RECONCILED", "COMPLETE"] as RunState[]) {
      record = await stepRun(store, record, to, clock++);
    }
    expect((await store.resumable()).map((r) => r.runId)).not.toContain(record.runId);
  });
});

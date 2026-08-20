import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  advanceRun,
  createRun,
  isRunTerminal,
  RUN_RESUMABLE_STATES,
  runIdFor,
  triggerIdFor,
  type AdvanceRunOptions,
  type Hex32,
  type RunState,
  type SentinelRun,
  type TriggerEvent,
  type UnixSeconds,
} from "@usance/schemas";

/**
 * Durable run storage — the Sentinel counterpart of the evidence `WorkflowStore`, and deliberately
 * the same shape so the two never grow into two persistence models. State must survive the process,
 * because the crash that matters is the one between submitting a transaction and recording that it
 * happened, which is exactly the crash that would otherwise double-execute.
 *
 * One file per run, written to a temp path and renamed (atomic on the same filesystem). A
 * relational implementation would use `RUN_TRANSITIONS` as a CHECK constraint and `updatedAt` as an
 * optimistic-concurrency column; `save` takes the record it expects to replace so that swap needs
 * no caller change.
 */
export interface RunStore {
  get(runId: Hex32): Promise<SentinelRun | null>;
  save(record: SentinelRun, expectedUpdatedAt?: UnixSeconds | null): Promise<SentinelRun>;
  list(state?: RunState): Promise<readonly SentinelRun[]>;
  /** Runs mid-flight onchain or awaiting a read — what a supervisor picks back up after a crash. */
  resumable(): Promise<readonly SentinelRun[]>;
  /** Runs for one instance, newest first, for the run-history surface. */
  forInstance(instanceId: Hex32): Promise<readonly SentinelRun[]>;
}

export class RunConflict extends Error {
  readonly code = "RUN_CONFLICT";
  constructor(readonly runId: Hex32) {
    super(`run ${runId} changed underneath this writer; re-read and retry`);
    this.name = "RunConflict";
  }
}

export class FileSystemRunStore implements RunStore {
  readonly name = "fs-run-store/1";

  constructor(private readonly root: string) {
    mkdirSync(root, { recursive: true });
  }

  private path(runId: Hex32): string {
    return resolve(this.root, `${runId}.json`);
  }

  async get(runId: Hex32): Promise<SentinelRun | null> {
    const p = this.path(runId);
    if (!existsSync(p)) return null;
    return JSON.parse(readFileSync(p, "utf8")) as SentinelRun;
  }

  async save(record: SentinelRun, expectedUpdatedAt?: UnixSeconds | null): Promise<SentinelRun> {
    if (expectedUpdatedAt !== undefined) {
      const current = await this.get(record.runId);
      if ((current?.updatedAt ?? null) !== expectedUpdatedAt) throw new RunConflict(record.runId);
    }
    const p = this.path(record.runId);
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

  async list(state?: RunState): Promise<readonly SentinelRun[]> {
    if (!existsSync(this.root)) return [];
    const out: SentinelRun[] = [];
    for (const f of readdirSync(this.root)) {
      if (!f.endsWith(".json")) continue;
      const r = JSON.parse(readFileSync(resolve(this.root, f), "utf8")) as SentinelRun;
      if (state === undefined || r.state === state) out.push(r);
    }
    return out.sort((a, b) => a.createdAt - b.createdAt);
  }

  async resumable(): Promise<readonly SentinelRun[]> {
    return (await this.list()).filter((r) => (RUN_RESUMABLE_STATES as readonly RunState[]).includes(r.state));
  }

  async forInstance(instanceId: Hex32): Promise<readonly SentinelRun[]> {
    return (await this.list()).filter((r) => r.instanceId === instanceId).sort((a, b) => b.createdAt - a.createdAt);
  }
}

/** Non-durable, for tests about transition logic rather than storage. */
export class InMemoryRunStore implements RunStore {
  readonly name = "in-memory-run-store/1";
  private readonly records = new Map<Hex32, SentinelRun>();

  async get(runId: Hex32): Promise<SentinelRun | null> {
    return this.records.get(runId) ?? null;
  }
  async save(record: SentinelRun, expectedUpdatedAt?: UnixSeconds | null): Promise<SentinelRun> {
    if (expectedUpdatedAt !== undefined) {
      if ((this.records.get(record.runId)?.updatedAt ?? null) !== expectedUpdatedAt) throw new RunConflict(record.runId);
    }
    this.records.set(record.runId, record);
    return record;
  }
  async list(state?: RunState): Promise<readonly SentinelRun[]> {
    return [...this.records.values()]
      .filter((r) => state === undefined || r.state === state)
      .sort((a, b) => a.createdAt - b.createdAt);
  }
  async resumable(): Promise<readonly SentinelRun[]> {
    return (await this.list()).filter((r) => (RUN_RESUMABLE_STATES as readonly RunState[]).includes(r.state));
  }
  async forInstance(instanceId: Hex32): Promise<readonly SentinelRun[]> {
    return (await this.list()).filter((r) => r.instanceId === instanceId).sort((a, b) => b.createdAt - a.createdAt);
  }
}

/**
 * Get or create the run for a trigger occurrence. Idempotent by construction (I-63): the runId is
 * derived from `(instanceId, triggerId, triggerVersion)`, so a duplicate delivery finds the existing
 * record instead of starting a second run — and a terminal run is returned untouched, never
 * resurrected, because a new trigger occurrence is a new run.
 */
export async function openRun(
  store: RunStore,
  instanceId: Hex32,
  trigger: TriggerEvent,
  triggerVersion: number,
  now: UnixSeconds,
): Promise<{ record: SentinelRun; created: boolean }> {
  const triggerId = triggerIdFor(trigger);
  const runId = runIdFor(instanceId, triggerId, triggerVersion);
  const existing = await store.get(runId);
  if (existing) return { record: existing, created: false };
  const record = createRun(runId, instanceId, trigger, triggerId, triggerVersion, now);
  await store.save(record, null);
  return { record, created: true };
}

/** Advance and persist under optimistic concurrency, so two workers cannot both win. */
export async function stepRun(
  store: RunStore,
  record: SentinelRun,
  to: RunState,
  now: UnixSeconds,
  options?: AdvanceRunOptions,
): Promise<SentinelRun> {
  const next = advanceRun(record, to, now, options);
  return store.save(next, record.updatedAt);
}

export { isRunTerminal };

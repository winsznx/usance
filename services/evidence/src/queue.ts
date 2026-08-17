import { keccak256, stringToBytes } from "viem";
import type { Hex32, UnixSeconds } from "@usance/schemas";

/**
 * The durable work queue behind every stage of the pipeline.
 *
 * Ingesting a document, calling a model and producing calldata are all operations that can fail
 * halfway and must not be silently abandoned or silently repeated. Two rules follow, and they are the
 * whole design:
 *
 *  1. **Retry is driven by stored state, never by a timer.** There is no `setTimeout` and no
 *     `setInterval` anywhere in this file. A job carries `nextAttemptAt`; a worker loop passes `now`
 *     and gets back whatever is due. A retry that lives in a timer lives in one process's heap, so a
 *     deploy, a crash or an OOM kill during backoff loses it — and a financial operation that
 *     disappears when a pod restarts is not retried, it is dropped.
 *
 *  2. **Exhaustion is a terminal state a human owns.** After `maxAttempts` a job becomes
 *     `RECONCILIATION_REQUIRED` and is never picked up again. It does not fail open, it does not fail
 *     closed, it stops and says so. `spec/interfaces.md §7.7` names the same state for execution, for
 *     the same reason: "we do not know what happened" must be representable, because the alternative
 *     is code that assumes nothing happened.
 *
 * ## Deviation, recorded
 *
 * Postgres is the production target. `InProcessWorkQueue` below implements the exact semantics of this
 * interface — idempotency, leasing, bounded jittered backoff, terminal exhaustion — in a `Map`. What
 * it does **not** have is durability across a process restart, or lease atomicity across processes.
 * Two workers in one process are safe because JavaScript's event loop makes `claim` indivisible; two
 * workers in two processes are not, because `Map` is not shared. Use it for tests, for a single-process
 * operator tool, and for nothing that must survive a deploy.
 *
 * The Postgres implementation is a schema and one query. Both are written out so that the port is
 * mechanical rather than a design exercise:
 *
 * ```sql
 * CREATE TABLE evidence_job (
 *   job_id            bytea PRIMARY KEY,
 *   idempotency_key   text NOT NULL UNIQUE,   -- the whole idempotency guarantee, enforced by the db
 *   kind              text NOT NULL,
 *   payload           jsonb NOT NULL,
 *   state             text NOT NULL,
 *   attempts          int  NOT NULL DEFAULT 0,
 *   max_attempts      int  NOT NULL,
 *   next_attempt_at   bigint NOT NULL,
 *   lease_expires_at  bigint,
 *   last_error        text,
 *   created_at        bigint NOT NULL,
 *   updated_at        bigint NOT NULL
 * );
 * CREATE INDEX ON evidence_job (state, next_attempt_at);
 *
 * -- claim(): one statement, so a crash between selecting and leasing is impossible.
 * UPDATE evidence_job SET state = 'LEASED', lease_expires_at = $now + $lease, updated_at = $now
 * WHERE job_id = (
 *   SELECT job_id FROM evidence_job
 *   WHERE kind = ANY($kinds)
 *     AND next_attempt_at <= $now
 *     AND (state = 'PENDING'
 *          OR (state = 'LEASED' AND lease_expires_at <= $now))  -- a dead worker's lease expires
 *   ORDER BY next_attempt_at
 *   FOR UPDATE SKIP LOCKED
 *   LIMIT 1
 * )
 * RETURNING *;
 * ```
 *
 * The expired-lease clause is why a crashed worker does not wedge a job forever, and `SKIP LOCKED` is
 * why N workers do not serialise behind each other.
 */

export type JobState =
  | "PENDING"
  | "LEASED"
  | "SUCCEEDED"
  /** Attempts exhausted. Terminal, and owned by a human. Never retried automatically. */
  | "RECONCILIATION_REQUIRED"
  /** Terminal by nature: a forged source hash or an invalid schema will fail identically forever. */
  | "REJECTED";

export interface JobRecord<P = unknown> {
  readonly jobId: Hex32;
  readonly idempotencyKey: string;
  readonly kind: string;
  readonly payload: P;
  readonly state: JobState;
  readonly attempts: number;
  readonly maxAttempts: number;
  readonly nextAttemptAt: UnixSeconds;
  readonly leaseExpiresAt: UnixSeconds | null;
  readonly lastError: string | null;
  readonly createdAt: UnixSeconds;
  readonly updatedAt: UnixSeconds;
}

export interface EnqueueRequest<P = unknown> {
  /**
   * The caller's identity for this unit of work, e.g. `extract:<evidenceId>`.
   *
   * Enqueuing twice with the same key returns the existing job untouched. It does not reset attempts,
   * does not clear a terminal state and does not create a second job. An idempotency key that could be
   * re-armed by a duplicate submission is not an idempotency key.
   */
  readonly idempotencyKey: string;
  readonly kind: string;
  readonly payload: P;
  readonly maxAttempts?: number | undefined;
  /** Earliest attempt time. Defaults to now. */
  readonly notBefore?: UnixSeconds | undefined;
}

export interface WorkQueue {
  readonly name: string;
  enqueue<P>(req: EnqueueRequest<P>): Promise<JobRecord<P>>;
  /** Lease one due job of any of `kinds`, or `null`. Never blocks and never waits. */
  claim(kinds: readonly string[], now: UnixSeconds, leaseSeconds: number): Promise<JobRecord | null>;
  succeed(jobId: Hex32, now: UnixSeconds): Promise<JobRecord>;
  /**
   * Record a failed attempt.
   *
   * `terminal` distinguishes "this will never work" from "this might work later". A forged source hash
   * is terminal; a 503 from a model provider is not. Retrying a terminal failure burns credits and
   * delays the real error reaching an operator.
   */
  fail(jobId: Hex32, now: UnixSeconds, error: string, terminal?: boolean): Promise<JobRecord>;
  get(jobId: Hex32): Promise<JobRecord | null>;
  byIdempotencyKey(key: string): Promise<JobRecord | null>;
  list(state?: JobState): Promise<readonly JobRecord[]>;
}

export const DEFAULT_MAX_ATTEMPTS = 5;
export const DEFAULT_BACKOFF_BASE_SECONDS = 2;
export const DEFAULT_BACKOFF_CAP_SECONDS = 900;

/** Derived, so the same logical unit of work has the same id in every process and every language. */
export function jobIdFor(idempotencyKey: string): Hex32 {
  return keccak256(stringToBytes(idempotencyKey));
}

/**
 * Bounded exponential backoff with full jitter.
 *
 * Full jitter — uniform over `[0, backoff]` rather than `backoff ± something` — because several assets
 * ingesting at once would otherwise retry in lockstep and rebuild the burst that caused the failure.
 * The cap matters as much: unbounded doubling produces a job whose next attempt is in eleven hours,
 * which is indistinguishable from a lost job to everyone except the queue.
 *
 * Returns whole seconds, and at least one, so a "retry" can never be scheduled for the instant it
 * failed and spin.
 */
export function backoffSeconds(
  attempt: number,
  random: () => number = Math.random,
  baseSeconds: number = DEFAULT_BACKOFF_BASE_SECONDS,
  capSeconds: number = DEFAULT_BACKOFF_CAP_SECONDS,
): number {
  const exponential = Math.min(baseSeconds * 2 ** Math.max(0, attempt - 1), capSeconds);
  return Math.max(1, Math.floor(exponential * random()));
}

export class UnknownJob extends Error {
  constructor(readonly jobId: Hex32) {
    super(`no job ${jobId}`);
    this.name = "UnknownJob";
  }
}

/**
 * In-process implementation. Semantics are exact; durability is not. See the deviation note above.
 */
export class InProcessWorkQueue implements WorkQueue {
  readonly name = "in-process-work-queue/1";

  private readonly jobs = new Map<Hex32, JobRecord>();
  private readonly byKey = new Map<string, Hex32>();

  constructor(
    private readonly now: () => UnixSeconds = () => Math.floor(Date.now() / 1000),
    private readonly random: () => number = Math.random,
  ) {}

  async enqueue<P>(req: EnqueueRequest<P>): Promise<JobRecord<P>> {
    const jobId = jobIdFor(req.idempotencyKey);
    const existing = this.jobs.get(jobId);
    // Returned untouched, including when it is terminal. A duplicate submission must not resurrect a
    // job an operator has already been asked to reconcile.
    if (existing) return existing as JobRecord<P>;

    const t = this.now();
    const record: JobRecord<P> = {
      jobId,
      idempotencyKey: req.idempotencyKey,
      kind: req.kind,
      payload: req.payload,
      state: "PENDING",
      attempts: 0,
      maxAttempts: req.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
      nextAttemptAt: req.notBefore ?? t,
      leaseExpiresAt: null,
      lastError: null,
      createdAt: t,
      updatedAt: t,
    };
    this.jobs.set(jobId, record as JobRecord);
    this.byKey.set(req.idempotencyKey, jobId);
    return record;
  }

  async claim(kinds: readonly string[], now: UnixSeconds, leaseSeconds: number): Promise<JobRecord | null> {
    const due = [...this.jobs.values()]
      .filter((j) => kinds.includes(j.kind))
      .filter((j) => j.nextAttemptAt <= now)
      .filter(
        (j) =>
          j.state === "PENDING" ||
          // A worker that died mid-attempt leaves a lease behind. Reclaiming it on expiry is what
          // stops one crash from parking a job forever.
          (j.state === "LEASED" && j.leaseExpiresAt !== null && j.leaseExpiresAt <= now),
      )
      .sort((a, b) => a.nextAttemptAt - b.nextAttemptAt || compare(a.jobId, b.jobId));

    const job = due[0];
    if (!job) return null;

    const leased: JobRecord = {
      ...job,
      state: "LEASED",
      leaseExpiresAt: now + leaseSeconds,
      updatedAt: now,
    };
    this.jobs.set(job.jobId, leased);
    return leased;
  }

  async succeed(jobId: Hex32, now: UnixSeconds): Promise<JobRecord> {
    const job = this.require(jobId);
    const next: JobRecord = { ...job, state: "SUCCEEDED", leaseExpiresAt: null, updatedAt: now };
    this.jobs.set(jobId, next);
    return next;
  }

  async fail(jobId: Hex32, now: UnixSeconds, error: string, terminal = false): Promise<JobRecord> {
    const job = this.require(jobId);
    const attempts = job.attempts + 1;

    // Exhaustion is checked against the incremented count, so `maxAttempts: 1` means exactly one
    // attempt. Off by one here would silently double every retry budget in the system.
    const state: JobState = terminal
      ? "REJECTED"
      : attempts >= job.maxAttempts
        ? "RECONCILIATION_REQUIRED"
        : "PENDING";

    const next: JobRecord = {
      ...job,
      state,
      attempts,
      lastError: error,
      leaseExpiresAt: null,
      // A terminal or exhausted job is never due again. Leaving `nextAttemptAt` in the past would make
      // it look claimable to a future reader of the table.
      nextAttemptAt: state === "PENDING" ? now + backoffSeconds(attempts, this.random) : job.nextAttemptAt,
      updatedAt: now,
    };
    this.jobs.set(jobId, next);
    return next;
  }

  async get(jobId: Hex32): Promise<JobRecord | null> {
    return this.jobs.get(jobId) ?? null;
  }

  async byIdempotencyKey(key: string): Promise<JobRecord | null> {
    const id = this.byKey.get(key);
    return id ? (this.jobs.get(id) ?? null) : null;
  }

  async list(state?: JobState): Promise<readonly JobRecord[]> {
    const all = [...this.jobs.values()];
    return state ? all.filter((j) => j.state === state) : all;
  }

  private require(jobId: Hex32): JobRecord {
    const job = this.jobs.get(jobId);
    if (!job) throw new UnknownJob(jobId);
    return job;
  }
}

function compare(a: Hex32, b: Hex32): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Run one due job to completion.
 *
 * Deliberately does one job and returns. The loop, the sleep and the concurrency belong to the caller
 * — a cron tick, a worker process, a test — because those are the parts a deployment needs to control
 * and the parts that must not be hidden inside a timer.
 */
export async function runOne<P>(
  queue: WorkQueue,
  kinds: readonly string[],
  now: UnixSeconds,
  leaseSeconds: number,
  handler: (job: JobRecord<P>) => Promise<void>,
  isTerminal: (e: unknown) => boolean = () => false,
): Promise<JobRecord | null> {
  const job = await queue.claim(kinds, now, leaseSeconds);
  if (!job) return null;
  try {
    await handler(job as JobRecord<P>);
    return await queue.succeed(job.jobId, now);
  } catch (e) {
    return await queue.fail(job.jobId, now, e instanceof Error ? e.message : String(e), isTerminal(e));
  }
}

import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  backoffSeconds,
  DEFAULT_BACKOFF_CAP_SECONDS,
  InProcessWorkQueue,
  jobIdFor,
  runOne,
  type JobRecord,
} from "../src/queue";
import { seededRandom } from "./support";

const T0 = 1_786_987_500;

describe("work queue", () => {
  it("enqueuing the same idempotency key twice returns the same job", async () => {
    const q = new InProcessWorkQueue(() => T0);
    const a = await q.enqueue({ idempotencyKey: "extract:0xabc", kind: "extract", payload: { n: 1 } });
    const b = await q.enqueue({ idempotencyKey: "extract:0xabc", kind: "extract", payload: { n: 2 } });

    expect(b.jobId).toBe(a.jobId);
    expect(b.jobId).toBe(jobIdFor("extract:0xabc"));
    // The payload from the first submission wins. A duplicate submission is a duplicate, not an edit.
    expect(b.payload).toEqual({ n: 1 });
    expect(await q.list()).toHaveLength(1);
  });

  it("a duplicate submission cannot resurrect a terminal job", async () => {
    const q = new InProcessWorkQueue(() => T0);
    const job = await q.enqueue({ idempotencyKey: "k", kind: "extract", payload: {}, maxAttempts: 1 });
    await q.claim(["extract"], T0, 60);
    await q.fail(job.jobId, T0, "boom");

    const again = await q.enqueue({ idempotencyKey: "k", kind: "extract", payload: {} });
    expect(again.state).toBe("RECONCILIATION_REQUIRED");
    expect(again.attempts).toBe(1);
  });

  it("retry exhaustion lands in RECONCILIATION_REQUIRED and is never claimed again", async () => {
    const q = new InProcessWorkQueue(() => T0, seededRandom(1));
    const job = await q.enqueue({ idempotencyKey: "commit:0x1", kind: "commit", payload: {}, maxAttempts: 3 });

    let now = T0;
    let record: JobRecord = job;
    for (let i = 0; i < 3; i++) {
      const claimed = await q.claim(["commit"], now, 30);
      expect(claimed).not.toBeNull();
      record = await q.fail(claimed!.jobId, now, `attempt ${i + 1} failed`);
      now = Math.max(now, record.nextAttemptAt);
    }

    expect(record.state).toBe("RECONCILIATION_REQUIRED");
    expect(record.attempts).toBe(3);
    expect(record.lastError).toBe("attempt 3 failed");

    // Terminal means terminal. Even far in the future the job is not due.
    expect(await q.claim(["commit"], now + 10 * 365 * 86_400, 30)).toBeNull();
    expect(await q.list("RECONCILIATION_REQUIRED")).toHaveLength(1);
  });

  it("a terminal failure is REJECTED immediately, without burning the retry budget", async () => {
    const q = new InProcessWorkQueue(() => T0);
    const job = await q.enqueue({ idempotencyKey: "ingest:0x2", kind: "ingest", payload: {}, maxAttempts: 5 });
    await q.claim(["ingest"], T0, 30);

    const failed = await q.fail(job.jobId, T0, "SourceHashMismatch: forged origin", true);
    expect(failed.state).toBe("REJECTED");
    expect(failed.attempts).toBe(1);
    expect(await q.claim(["ingest"], T0 + 86_400, 30)).toBeNull();
  });

  it("a job is not due again until its backoff has elapsed", async () => {
    const q = new InProcessWorkQueue(() => T0, seededRandom(7));
    const job = await q.enqueue({ idempotencyKey: "x", kind: "extract", payload: {}, maxAttempts: 4 });

    await q.claim(["extract"], T0, 30);
    const failed = await q.fail(job.jobId, T0, "503 from provider");

    expect(failed.state).toBe("PENDING");
    expect(failed.nextAttemptAt).toBeGreaterThan(T0);
    expect(await q.claim(["extract"], failed.nextAttemptAt - 1, 30)).toBeNull();
    expect(await q.claim(["extract"], failed.nextAttemptAt, 30)).not.toBeNull();
  });

  it("a crashed worker's lease expires so one crash cannot park a job forever", async () => {
    const q = new InProcessWorkQueue(() => T0);
    await q.enqueue({ idempotencyKey: "y", kind: "extract", payload: {} });

    const first = await q.claim(["extract"], T0, 60);
    expect(first?.state).toBe("LEASED");
    // A second worker arriving inside the lease window gets nothing.
    expect(await q.claim(["extract"], T0 + 30, 60)).toBeNull();
    // After the lease expires the job is reclaimable.
    expect(await q.claim(["extract"], T0 + 61, 60)).not.toBeNull();
  });

  it("only claims the kinds a worker asked for", async () => {
    const q = new InProcessWorkQueue(() => T0);
    await q.enqueue({ idempotencyKey: "a", kind: "ingest", payload: {} });
    await q.enqueue({ idempotencyKey: "b", kind: "extract", payload: {} });

    expect((await q.claim(["extract"], T0, 30))?.kind).toBe("extract");
    expect(await q.claim(["extract"], T0, 30)).toBeNull();
    expect((await q.claim(["ingest"], T0, 30))?.kind).toBe("ingest");
  });

  it("respects notBefore", async () => {
    const q = new InProcessWorkQueue(() => T0);
    await q.enqueue({ idempotencyKey: "later", kind: "extract", payload: {}, notBefore: T0 + 600 });
    expect(await q.claim(["extract"], T0, 30)).toBeNull();
    expect(await q.claim(["extract"], T0 + 600, 30)).not.toBeNull();
  });

  describe("backoff", () => {
    it("is bounded, jittered and never zero", () => {
      const rnd = seededRandom(42);
      for (let attempt = 1; attempt <= 20; attempt++) {
        const s = backoffSeconds(attempt, rnd);
        expect(s).toBeGreaterThanOrEqual(1);
        expect(s).toBeLessThanOrEqual(DEFAULT_BACKOFF_CAP_SECONDS);
        expect(Number.isInteger(s)).toBe(true);
      }
    });

    it("grows with the attempt number under a fixed random draw", () => {
      const always = () => 1;
      expect(backoffSeconds(1, always)).toBe(2);
      expect(backoffSeconds(2, always)).toBe(4);
      expect(backoffSeconds(3, always)).toBe(8);
      // Capped, so a retry is never scheduled hours out where it is indistinguishable from lost.
      expect(backoffSeconds(30, always)).toBe(DEFAULT_BACKOFF_CAP_SECONDS);
    });

    it("uses full jitter, so simultaneous failures do not retry in lockstep", () => {
      const rnd = seededRandom(3);
      const draws = new Set(Array.from({ length: 50 }, () => backoffSeconds(6, rnd)));
      // Full jitter spreads uniformly over [0, backoff]. A fixed or symmetric jitter would cluster.
      expect(draws.size).toBeGreaterThan(20);
    });
  });

  it("runOne leases, runs and settles exactly one job", async () => {
    const q = new InProcessWorkQueue(() => T0);
    await q.enqueue({ idempotencyKey: "run-1", kind: "extract", payload: { v: 1 } });

    const seen: unknown[] = [];
    const done = await runOne(q, ["extract"], T0, 30, async (job) => {
      seen.push(job.payload);
    });

    expect(seen).toEqual([{ v: 1 }]);
    expect(done?.state).toBe("SUCCEEDED");
    expect(await runOne(q, ["extract"], T0, 30, async () => undefined)).toBeNull();
  });

  it("runOne records a handler throw as a retryable failure unless told otherwise", async () => {
    const q = new InProcessWorkQueue(() => T0, seededRandom(11));
    await q.enqueue({ idempotencyKey: "run-2", kind: "extract", payload: {}, maxAttempts: 4 });

    const retryable = await runOne(q, ["extract"], T0, 30, async () => {
      throw new Error("provider timeout");
    });
    expect(retryable?.state).toBe("PENDING");
    expect(retryable?.lastError).toBe("provider timeout");

    const terminal = await runOne(
      q,
      ["extract"],
      retryable!.nextAttemptAt,
      30,
      async () => {
        throw new Error("SourceHashMismatch");
      },
      (e) => e instanceof Error && e.message.includes("SourceHashMismatch"),
    );
    expect(terminal?.state).toBe("REJECTED");
  });

  it("drives retries from stored state, never from a timer", async () => {
    // The property the whole module exists for. A retry scheduled with setTimeout lives in one
    // process's heap, so a deploy or an OOM kill during backoff drops a financial operation silently.
    const source = await readFile(
      resolve(dirname(fileURLToPath(import.meta.url)), "..", "src", "queue.ts"),
      "utf8",
    );
    // Matches a call, not the prose: the module's own documentation names these functions to explain
    // why they are absent, and a check that failed on its own comment would be deleted rather than fixed.
    expect(source).not.toMatch(/\b(?:setTimeout|setInterval|setImmediate)\s*\(/);
  });
});

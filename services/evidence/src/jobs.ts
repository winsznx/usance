import type { Hex32, SourceClass, UnixSeconds } from "@usance/schemas";
import { runPipeline, isTerminalPipelineError, type PipelineDeps, type PipelineOutcome } from "./pipeline";
import type { ObjectStore } from "./store";
import type { JobRecord, WorkQueue } from "./queue";

/**
 * The pipeline as a unit of durable work.
 *
 * The payload is the reason the object store exists. It carries the *digest* of the fetched bytes and
 * not the bytes, so a job row is small, serialises to `jsonb` unchanged, and survives a restart with
 * its input intact. A queue that carried document bodies would be a second, worse copy of the store —
 * one with no content addressing, no deduplication and no way to tell whether two rows hold the same
 * document.
 */

export const PIPELINE_JOB_KIND = "evidence.pipeline" as const;

export interface PipelineJobPayload {
  readonly assetId: Hex32;
  readonly version: number;
  readonly expiresAt: UnixSeconds;
  readonly uri: string;
  readonly issuerId: Hex32;
  readonly sourceClass: SourceClass;
  readonly mediaType: string;
  readonly retrievedAt: UnixSeconds;
  readonly effectiveAt: UnixSeconds;
  readonly assertedSourceHash: Hex32;
  /** Object-store key of the raw bytes. The worker reads them back; the queue never holds them. */
  readonly rawDigest: Hex32;
}

export class ObjectMissingFromStore extends Error {
  constructor(readonly digest: Hex32) {
    super(
      `object ${digest} is not in the store, so the job cannot run. ` +
        "Treated as retryable: a content-addressed object that is absent now may be a transient " +
        "storage failure, and the retry budget ending in RECONCILIATION_REQUIRED is the right place " +
        "for a human to find out which.",
    );
    this.name = "ObjectMissingFromStore";
  }
}

/**
 * Idempotency key for one unit of pipeline work.
 *
 * Keyed on `(assetId, version, rawDigest)`. Two submissions of the same document for the same asset
 * version are one job; the same document for a *different* version is a different job, because that is
 * a genuinely different commit. Deriving the key rather than accepting one means a caller cannot
 * accidentally run the same extraction twice by generating a fresh uuid per request, which is the way
 * "idempotent" usually fails in practice.
 */
export function pipelineJobKey(p: Pick<PipelineJobPayload, "assetId" | "version" | "rawDigest">): string {
  return `${PIPELINE_JOB_KIND}:${p.assetId.toLowerCase()}:${p.version}:${p.rawDigest.toLowerCase()}`;
}

export async function enqueuePipelineJob(
  queue: WorkQueue,
  payload: PipelineJobPayload,
  maxAttempts?: number,
): Promise<JobRecord<PipelineJobPayload>> {
  return queue.enqueue<PipelineJobPayload>({
    idempotencyKey: pipelineJobKey(payload),
    kind: PIPELINE_JOB_KIND,
    payload,
    ...(maxAttempts === undefined ? {} : { maxAttempts }),
  });
}

/**
 * Claim and run at most one pipeline job.
 *
 * All three pipeline outcomes are a *successful* job. `CLAIM_CONFLICT` is a conclusion, not a failure:
 * the pipeline established that two paths disagree, which is exactly what it exists to establish, and
 * retrying it would produce the same disagreement more slowly. A job fails only when the pipeline
 * could not reach a conclusion at all.
 *
 * `SCHEMA_INVALID` splits on `terminal`. A forged source hash will be forged on every retry, so it is
 * `REJECTED` immediately rather than after five attempts; a transient provider failure retries with
 * backoff and ends in `RECONCILIATION_REQUIRED` if it never recovers.
 */
export async function runPipelineJobOnce(
  queue: WorkQueue,
  store: ObjectStore,
  deps: Omit<PipelineDeps, "store">,
  now: UnixSeconds,
  leaseSeconds: number,
  onOutcome: (outcome: PipelineOutcome, job: JobRecord<PipelineJobPayload>) => Promise<void> | void,
  signal?: AbortSignal,
): Promise<JobRecord | null> {
  const job = (await queue.claim([PIPELINE_JOB_KIND], now, leaseSeconds)) as JobRecord<PipelineJobPayload> | null;
  if (!job) return null;

  try {
    const p = job.payload;
    const bytes = await store.get(p.rawDigest, signal);
    if (bytes === null) throw new ObjectMissingFromStore(p.rawDigest);

    const outcome = await runPipeline(
      {
        assetId: p.assetId,
        version: p.version,
        expiresAt: p.expiresAt,
        document: {
          uri: p.uri,
          issuerId: p.issuerId,
          sourceClass: p.sourceClass,
          bytes,
          mediaType: p.mediaType,
          retrievedAt: p.retrievedAt,
          effectiveAt: p.effectiveAt,
          assertedSourceHash: p.assertedSourceHash,
        },
      },
      { ...deps, store },
      signal,
    );

    if (outcome.kind === "SCHEMA_INVALID") {
      return await queue.fail(job.jobId, now, outcome.reason, outcome.terminal);
    }

    await onOutcome(outcome, job);
    return await queue.succeed(job.jobId, now);
  } catch (e) {
    return await queue.fail(
      job.jobId,
      now,
      e instanceof Error ? `${e.name}: ${e.message}` : String(e),
      isTerminalPipelineError(e),
    );
  }
}

import { describe, expect, it } from "vitest";
import { DeterministicParserExtractor } from "@usance/chaingpt";
import { loadFixture } from "../src/fixtures";
import {
  enqueuePipelineJob,
  pipelineJobKey,
  runPipelineJobOnce,
  type PipelineJobPayload,
} from "../src/jobs";
import { InProcessWorkQueue } from "../src/queue";
import { InMemoryObjectStore } from "../src/store";
import type { PipelineOutcome } from "../src/pipeline";
import { StubExtractor, seededRandom } from "./support";

const ASSET_ID = `0x${"9d".repeat(32)}` as const;
const T0 = 1_786_987_500;

async function payloadFor(id: string, store: InMemoryObjectStore): Promise<PipelineJobPayload> {
  const { entry, bytes } = await loadFixture(id);
  // The bytes go to the store; the job carries only the digest.
  const stored = await store.put(bytes, entry.mediaType);
  return {
    assetId: ASSET_ID,
    version: 1,
    expiresAt: 0,
    uri: entry.uri,
    issuerId: entry.issuer.issuerId,
    sourceClass: entry.sourceClass,
    mediaType: entry.mediaType,
    retrievedAt: entry.retrievedAt,
    effectiveAt: entry.effectiveAt,
    assertedSourceHash: entry.sourceHash,
    rawDigest: stored.digest,
  };
}

describe("pipeline jobs", () => {
  it("keys work by (asset, version, document) so a resubmission is not a second run", async () => {
    const store = new InMemoryObjectStore();
    const queue = new InProcessWorkQueue(() => T0);
    const payload = await payloadFor("franklin-fobxx-2025", store);

    const a = await enqueuePipelineJob(queue, payload);
    const b = await enqueuePipelineJob(queue, payload);
    expect(b.jobId).toBe(a.jobId);
    expect(await queue.list()).toHaveLength(1);

    // A different Passport version over the same document is genuinely different work.
    const next = await enqueuePipelineJob(queue, { ...payload, version: 2 });
    expect(next.jobId).not.toBe(a.jobId);
    expect(pipelineJobKey({ ...payload, version: 2 })).not.toBe(pipelineJobKey(payload));
  });

  it("carries a digest rather than the document body", async () => {
    const store = new InMemoryObjectStore();
    const payload = await payloadFor("franklin-fobxx-2025", store);

    // The whole payload must survive a JSON round trip into a Postgres jsonb column.
    const roundTripped = JSON.parse(JSON.stringify(payload)) as PipelineJobPayload;
    expect(roundTripped).toEqual(payload);
    expect(JSON.stringify(payload).length).toBeLessThan(1_000);
  });

  it("runs a job to a committable outcome and marks it SUCCEEDED", async () => {
    const store = new InMemoryObjectStore();
    const queue = new InProcessWorkQueue(() => T0);
    await enqueuePipelineJob(queue, await payloadFor("franklin-fobxx-2025", store));

    const outcomes: PipelineOutcome[] = [];
    const done = await runPipelineJobOnce(
      queue,
      store,
      { extractors: [new DeterministicParserExtractor()], now: () => T0 },
      T0,
      60,
      (o) => {
        outcomes.push(o);
      },
    );

    expect(done?.state).toBe("SUCCEEDED");
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]!.kind).toBe("READY_TO_COMMIT");
    // Nothing left to claim: exactly one run happened.
    expect(await runPipelineJobOnce(queue, store, { extractors: [] }, T0, 60, () => undefined)).toBeNull();
  });

  it("treats CLAIM_CONFLICT as a conclusion, not a failure to retry", async () => {
    const store = new InMemoryObjectStore();
    const queue = new InProcessWorkQueue(() => T0);
    await enqueuePipelineJob(queue, await payloadFor("franklin-fobxx-2025", store));

    const disagreeing = new StubExtractor("disagreeing@test", "chaingpt", {
      "transfer.permissionModel": { kind: "enum", ordinal: 0, name: "OPEN" },
    });

    let observed: PipelineOutcome | null = null;
    const done = await runPipelineJobOnce(
      queue,
      store,
      { extractors: [new DeterministicParserExtractor(), disagreeing], now: () => T0 },
      T0,
      60,
      (o) => {
        observed = o;
      },
    );

    // Retrying would produce the same disagreement more slowly. The pipeline established what it
    // exists to establish.
    expect(done?.state).toBe("SUCCEEDED");
    expect(observed).not.toBeNull();
    expect(observed!.kind).toBe("CLAIM_CONFLICT");
  });

  it("rejects a forged source immediately instead of burning the retry budget", async () => {
    const store = new InMemoryObjectStore();
    const queue = new InProcessWorkQueue(() => T0, seededRandom(5));
    const payload = await payloadFor("franklin-fobxx-2025", store);
    await enqueuePipelineJob(queue, { ...payload, assertedSourceHash: `0x${"ff".repeat(32)}` }, 5);

    const done = await runPipelineJobOnce(
      queue,
      store,
      { extractors: [new DeterministicParserExtractor()], now: () => T0 },
      T0,
      60,
      () => undefined,
    );

    expect(done?.state).toBe("REJECTED");
    expect(done?.attempts).toBe(1);
    expect(done?.lastError).toMatch(/SourceHashMismatch/);
  });

  it("a missing object is retryable and ends in RECONCILIATION_REQUIRED, never in silence", async () => {
    const store = new InMemoryObjectStore();
    const queue = new InProcessWorkQueue(() => T0, seededRandom(9));
    const payload = await payloadFor("franklin-fobxx-2025", store);

    // Point the job at a digest the store does not hold.
    await enqueuePipelineJob(queue, { ...payload, rawDigest: `0x${"01".repeat(32)}` }, 2);

    let now = T0;
    let state = "";
    for (let i = 0; i < 2; i++) {
      const r = await runPipelineJobOnce(
        queue,
        store,
        { extractors: [new DeterministicParserExtractor()] },
        now,
        60,
        () => undefined,
      );
      state = r!.state;
      now = Math.max(now, r!.nextAttemptAt);
    }

    expect(state).toBe("RECONCILIATION_REQUIRED");
    expect(await queue.list("RECONCILIATION_REQUIRED")).toHaveLength(1);
  });
});

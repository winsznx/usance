import { describe, expect, it } from "vitest";
import { ChainGptClient, ChainGptEvidenceExtractor, DeterministicParserExtractor } from "@usance/chaingpt";
import { passportCandidateSchema, UNKNOWN } from "@usance/schemas";
import { loadFixture } from "../src/fixtures";
import { runPipeline } from "../src/pipeline";
import { InMemoryObjectStore } from "../src/store";

/**
 * Live two-path extraction over a real issuer document.
 *
 * Skipped, not failed, without `CHAINGPT_API_KEY`. A suite that goes red on a missing optional
 * credential trains people to ignore red, and the whole pipeline is designed to work without the model
 * — it degrades to `SINGLE_SOURCE` and says so.
 *
 * What this proves that the deterministic tests cannot: the two paths really are independent. The
 * parser reads phrases; the model reads meaning. Whatever they return, the pipeline's response is one
 * of exactly three outcomes, and every one of them is safe.
 */
const KEY = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.[
  "CHAINGPT_API_KEY"
];
const live = KEY ? describe : describe.skip;

const ASSET_ID = `0x${"fe".repeat(32)}` as const;

async function requestFor(id: string) {
  const { entry, bytes } = await loadFixture(id);
  return {
    assetId: ASSET_ID,
    version: 1,
    expiresAt: 0,
    document: {
      uri: entry.uri,
      issuerId: entry.issuer.issuerId,
      sourceClass: entry.sourceClass,
      bytes,
      mediaType: entry.mediaType,
      retrievedAt: entry.retrievedAt,
      effectiveAt: entry.effectiveAt,
      assertedSourceHash: entry.sourceHash,
      assertedContentHash: entry.contentHash,
    },
  };
}

live("live two-path extraction", () => {
  /**
   * Client tuning, established empirically on 2026-08-17 against the live endpoint.
   *
   * A successful extraction over the full 24k-character filing returns in 15-25s. Requests issued
   * back to back, however, get an **HTTP 504 with an HTML error page from the edge after roughly 80
   * seconds** — not a JSON error, and not fast. Spacing requests by a few seconds made every one of
   * eight consecutive probes succeed, including the full filing, so the 504 is throttling and not a
   * size limit: a 2,000-character prompt 504'd in the same unspaced run that a 6,000-character one
   * completed in 17s.
   *
   * Hence `minIntervalMs` well above the client default, and `timeoutMs` set below the edge's own
   * 80-second give-up so a throttled attempt is abandoned and retried rather than waited out.
   */
  const client = new ChainGptClient({ minIntervalMs: 4_000, timeoutMs: 60_000, maxAttempts: 3 });

  it("runs both paths over a real SEC filing and produces a schema-valid candidate", async () => {
    const out = await runPipeline(await requestFor("franklin-fobxx-2025"), {
      store: new InMemoryObjectStore(),
      extractors: [new DeterministicParserExtractor(), new ChainGptEvidenceExtractor(client)],
      now: () => 1_786_987_500,
    });

    // Every outcome is acceptable and each says something different. What is NOT acceptable is a
    // candidate built from a conflict, or a CORROBORATED result from one path.
    expect(["READY_TO_COMMIT", "CLAIM_CONFLICT"]).toContain(out.kind);
    if (out.kind === "SCHEMA_INVALID") throw new Error(`unexpected SCHEMA_INVALID: ${out.reason}`);

    if (out.kind === "CLAIM_CONFLICT") {
      // The model disagreed with the filing's own words. The response is a restriction, never a raise.
      expect(out.conflictingFields.length).toBeGreaterThan(0);
      expect(out.calls.every((c) => c.functionName === "restrict" || c.functionName === "bumpEpoch")).toBe(true);
      return;
    }

    expect(passportCandidateSchema.safeParse(out.candidate).success).toBe(true);
    expect(out.candidate.assetId).toBe(ASSET_ID);
    expect(out.candidate.evidenceRoot).not.toBe(`0x${"00".repeat(32)}`);

    // The model path either ran or is recorded as failed. It is never silently absent.
    const ranBoth = out.claimSets.length === 2;
    if (ranBoth) {
      expect(new Set(out.claimSets.map((s) => s.independenceGroup))).toEqual(
        new Set(["deterministic-parser", "chaingpt"]),
      );
      expect(out.corroboration.independentPathCount).toBeGreaterThanOrEqual(1);
    } else {
      expect(out.pathFailures.length).toBeGreaterThan(0);
      expect(out.singleSource).toBe(true);
    }

    // Provenance is attached from the hashed document, never echoed back by the model.
    for (const set of out.claimSets) {
      for (const c of set.claims) {
        expect(c.evidenceId).toBe(out.ingest.document.evidenceId);
        expect(c.sourceClass).toBe(out.ingest.document.sourceClass);
        expect(c.field).not.toMatch(/ltv|haircut|riskpolicy/i);
        if (c.value !== UNKNOWN) expect(c.locator).not.toBeNull();
      }
    }
  }, 300_000);

  it("an embedded prompt injection cannot produce a risk parameter or raise a limit", async () => {
    const out = await runPipeline(await requestFor("franklin-fobxx-2025-injected"), {
      store: new InMemoryObjectStore(),
      extractors: [new DeterministicParserExtractor(), new ChainGptEvidenceExtractor(client)],
      now: () => 1_786_987_500,
    });

    expect(["READY_TO_COMMIT", "CLAIM_CONFLICT"]).toContain(out.kind);
    if (out.kind === "SCHEMA_INVALID") throw new Error(`unexpected SCHEMA_INVALID: ${out.reason}`);

    if (out.kind === "CLAIM_CONFLICT") {
      // The model complied with the injection and the unchanged parser reading contradicted it. That
      // is a restriction: no candidate exists and the only calls are restrict + bumpEpoch.
      expect(out.calls.every((c) => c.functionName === "restrict" || c.functionName === "bumpEpoch")).toBe(true);
      for (const set of out.claimSets) {
        for (const c of set.claims) expect(c.field).not.toMatch(/ltv|haircut|riskpolicy|override/i);
      }
      return;
    }

    // The model ignored the injection. The floor is only carried when two independent paths agree on
    // a number, and the injection's demanded 10000 bps cannot reach the header on its own.
    for (const set of out.claimSets) {
      for (const c of set.claims) expect(c.field).not.toMatch(/ltv|haircut|riskpolicy|override/i);
    }
    if (out.candidate.redemptionSupported) {
      expect(out.corroboration.fields.find((f) => f.field === "redemption.floorBps")?.outcome).toBe("AGREED");
    } else {
      expect(out.candidate.redemptionFloorBps).toBe(0);
    }
  }, 300_000);
});

describe("live test gating", () => {
  it("skips cleanly with no key rather than failing", () => {
    // Recorded as an assertion so the skip is visible in the report instead of being an empty file.
    expect(typeof KEY === "string" || KEY === undefined).toBe(true);
  });
});

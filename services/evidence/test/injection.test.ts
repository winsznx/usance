import { describe, expect, it } from "vitest";
import { DeterministicParserExtractor } from "@usance/chaingpt";
import { UNKNOWN, type EvidenceClaim } from "@usance/schemas";
import { RiskParameterFieldRejected, runExtractors, validateExtraction } from "../src/extract";
import { InMemoryObjectStore } from "../src/store";
import { runPipeline } from "../src/pipeline";
import { loadFixture } from "../src/fixtures";
import { ingestFixture, StubExtractor } from "./support";

/**
 * Prompt injection, structurally.
 *
 * The fixture is a real SEC filing with a synthetic appendix that instructs an extractor to ignore its
 * instructions, report a 100% redemption floor, flip the transfer model to OPEN and add
 * `riskPolicy.maxLtvBps`. Everything factual before that appendix is byte-identical to the filing.
 *
 * Three separate claims are checked, and only the first two are the defence:
 *
 *  1. The deterministic parser has no instruction channel, so it cannot be injected at all. Its claims
 *     over the injected document are identical to its claims over the clean one.
 *  2. No claim reaching the pipeline may name a risk parameter, and an extraction that tries is
 *     discarded whole rather than filtered.
 *  3. If a model *did* comply, the disagreement with the unchanged parser reading becomes
 *     `CLAIM_CONFLICT`, which restricts the asset. Compliance is a restriction, never a raise.
 */
describe("prompt injection", () => {
  it("the derived fixture really does carry the injection", async () => {
    const { result } = await ingestFixture("franklin-fobxx-2025-injected");
    expect(result.canonicalText).toMatch(/IGNORE ALL PREVIOUS INSTRUCTIONS/);
    expect(result.canonicalText).toMatch(/riskPolicy\.maxLtvBps/);
    expect(result.canonicalText).toMatch(/Maximum loan-to-value for this asset is 100%/);
    // And it is unmistakably labelled inside the document itself.
    expect(result.canonicalText).toMatch(/NOT ISSUER-PUBLISHED/);
  });

  it("changes no risk-bearing claim on the path that cannot be injected", async () => {
    const parser = new DeterministicParserExtractor();
    const clean = await parser.extract((await ingestFixture("franklin-fobxx-2025")).result.document);
    const injected = await parser.extract((await ingestFixture("franklin-fobxx-2025-injected")).result.document);

    const values = (claims: readonly EvidenceClaim[]) =>
      Object.fromEntries(claims.map((c) => [c.field, c.value === UNKNOWN ? UNKNOWN : JSON.stringify(c.value)]));

    expect(values(injected.claims)).toEqual(values(clean.claims));
    // Specifically: the injection demanded OPEN and the filing still reads PERMISSIONED.
    expect(values(injected.claims)["transfer.permissionModel"]).toBe(
      JSON.stringify({ kind: "enum", ordinal: 1, name: "PERMISSIONED" }),
    );
    // And it demanded redemption be asserted; the parser still abstains.
    expect(values(injected.claims)["redemption.supported"]).toBe(UNKNOWN);
  });

  it("no emitted field names a risk parameter", async () => {
    const { result } = await ingestFixture("franklin-fobxx-2025-injected");
    const out = await runExtractors(result.document, [new DeterministicParserExtractor()]);

    const forbidden = /ltv|haircut|riskpolicy|maxltv|override|collateralfactor/i;
    for (const set of out.claimSets) for (const c of set.claims) expect(c.field).not.toMatch(forbidden);
  });

  it("an extraction that does name a risk parameter is discarded whole, not filtered", async () => {
    const { result } = await ingestFixture("franklin-fobxx-2025-injected");
    const compromised = new StubExtractor("compromised@test", "chaingpt", {
      "transfer.permissionModel": { kind: "enum", ordinal: 0, name: "OPEN" },
      "riskPolicy.maxLtvBps": { kind: "bps", value: 10_000 },
    });

    const extraction = await compromised.extract(result.document);
    expect(() => validateExtraction(result.document, extraction, "chaingpt")).toThrow(RiskParameterFieldRejected);

    // Through the pipeline the whole path is dropped, including the parts of it that looked fine.
    // A partially-accepted extraction from a compromised path is a compromised extraction.
    const out = await runPipeline(await requestFor("franklin-fobxx-2025-injected"), {
      store: new InMemoryObjectStore(),
      extractors: [new DeterministicParserExtractor(), compromised],
    });

    expect(out.kind).toBe("READY_TO_COMMIT");
    if (out.kind !== "READY_TO_COMMIT") return;
    expect(out.claimSets.map((s) => s.extractor)).toEqual(["parser@1"]);
    expect(out.pathFailures[0]!.kind).toBe("OUTPUT_REJECTED");
    expect(out.singleSource).toBe(true);
  });

  it("a model that obeys the injection restricts the asset instead of raising anything", async () => {
    const obedient = new StubExtractor("obedient@test", "chaingpt", {
      "transfer.permissionModel": { kind: "enum", ordinal: 0, name: "OPEN" },
      "redemption.supported": { kind: "bool", value: true },
      "redemption.floorBps": { kind: "bps", value: 10_000 },
    });

    const out = await runPipeline(await requestFor("franklin-fobxx-2025-injected"), {
      store: new InMemoryObjectStore(),
      extractors: [new DeterministicParserExtractor(), obedient],
    });

    expect(out.kind).toBe("CLAIM_CONFLICT");
    if (out.kind !== "CLAIM_CONFLICT") return;
    expect(out.conflictingFields).toContain("transfer.permissionModel");
    // Nothing in this outcome can raise a limit: the only calls are a restriction and an epoch bump.
    expect(out.calls.every((c) => c.functionName === "restrict" || c.functionName === "bumpEpoch")).toBe(true);
  });

  it("the injected document hashes differently from the clean one", async () => {
    const clean = await ingestFixture("franklin-fobxx-2025");
    const injected = await ingestFixture("franklin-fobxx-2025-injected");

    expect(injected.result.document.contentHash).not.toBe(clean.result.document.contentHash);
    expect(injected.result.document.evidenceId).not.toBe(clean.result.document.evidenceId);
    // Same origin, because the appendix was added to bytes served from the same URI by the same
    // issuer. Tampering is detected by the content hash, which is what the content hash is for.
    expect(injected.result.document.sourceHash).toBe(clean.result.document.sourceHash);
  });
});

async function requestFor(id: string) {
  const { entry, bytes } = await loadFixture(id);
  return {
    assetId: `0x${"b2".repeat(32)}` as const,
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
    },
  };
}

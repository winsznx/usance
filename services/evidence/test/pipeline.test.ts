import { describe, expect, it } from "vitest";
import { decodeFunctionData } from "viem";
import { DeterministicParserExtractor } from "@usance/chaingpt";
import { merkleRoot, passportCandidateSchema, SourceClass, UNKNOWN } from "@usance/schemas";
import { loadFixture } from "../src/fixtures";
import { InMemoryObjectStore } from "../src/store";
import { buildFromDocuments, runPipeline } from "../src/pipeline";
import { PASSPORT_REGISTRY_ABI } from "../src/commit";
import { ingestFixture, StubExtractor, UnavailableExtractor } from "./support";

const ASSET_ID = `0x${"a1".repeat(32)}` as const;

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

describe("pipeline", () => {
  it("walks FETCHED -> ... -> CORROBORATED over a real SEC filing", async () => {
    const out = await runPipeline(await requestFor("franklin-fobxx-2025"), {
      store: new InMemoryObjectStore(),
      extractors: [new DeterministicParserExtractor()],
      now: () => 1_786_987_500,
    });

    expect(out.kind).toBe("READY_TO_COMMIT");
    if (out.kind !== "READY_TO_COMMIT") return;

    expect(out.trace.stages).toEqual([
      "FETCHED",
      "HASHED",
      "CANONICALIZED",
      "EXTRACTED",
      "VALIDATED",
      "CORROBORATED",
    ]);
    // COMMITTED is never emitted here. The pipeline produces calldata and holds no key.
    expect(out.trace.stages).not.toContain("COMMITTED");

    expect(passportCandidateSchema.safeParse(out.candidate).success).toBe(true);
    expect(out.candidate.strongestSourceClass).toBe(SourceClass.REGULATORY_FILING);
    expect(out.candidate.evidenceRoot).not.toBe(`0x${"00".repeat(32)}`);
  });

  it("one extraction path yields singleSource, never CORROBORATED", async () => {
    const out = await runPipeline(await requestFor("franklin-fobxx-2025"), {
      store: new InMemoryObjectStore(),
      extractors: [new DeterministicParserExtractor()],
    });

    expect(out.kind).toBe("READY_TO_COMMIT");
    if (out.kind !== "READY_TO_COMMIT") return;

    expect(out.corroboration.outcome).toBe("SINGLE_SOURCE");
    expect(out.corroboration.independentPathCount).toBe(1);
    expect(out.singleSource).toBe(true);
    expect(out.candidate.singleSource).toBe(true);
    expect(out.trace.branch).toBe("SINGLE_SOURCE");
  });

  it("a model path that cannot run degrades to one path instead of fabricating a second", async () => {
    const out = await runPipeline(await requestFor("franklin-fobxx-2025"), {
      store: new InMemoryObjectStore(),
      extractors: [new DeterministicParserExtractor(), new UnavailableExtractor()],
    });

    expect(out.kind).toBe("READY_TO_COMMIT");
    if (out.kind !== "READY_TO_COMMIT") return;

    expect(out.pathFailures).toHaveLength(1);
    expect(out.pathFailures[0]!.kind).toBe("UNAVAILABLE");
    expect(out.claimSets).toHaveLength(1);
    expect(out.singleSource).toBe(true);
  });

  it("two independent paths that agree yield CORROBORATED and singleSource false", async () => {
    const agreeing = new StubExtractor("agreeing-model@test", "chaingpt", {
      "transfer.permissionModel": { kind: "enum", ordinal: 1, name: "PERMISSIONED" },
      "redemption.supported": UNKNOWN,
    });

    const out = await runPipeline(await requestFor("franklin-fobxx-2025"), {
      store: new InMemoryObjectStore(),
      extractors: [new DeterministicParserExtractor(), agreeing],
    });

    expect(out.kind).toBe("READY_TO_COMMIT");
    if (out.kind !== "READY_TO_COMMIT") return;

    expect(out.corroboration.outcome).toBe("CORROBORATED");
    expect(out.corroboration.independentPathCount).toBe(2);
    expect(out.singleSource).toBe(false);
    expect(out.trace.branch).toBeNull();
  });

  it("two disagreeing paths produce CLAIM_CONFLICT and no candidate at all", async () => {
    // The deterministic parser reads PERMISSIONED from the filing's own words. This path claims the
    // opposite. There is no vote and no tie-break.
    const disagreeing = new StubExtractor("disagreeing-model@test", "chaingpt", {
      "transfer.permissionModel": { kind: "enum", ordinal: 0, name: "OPEN" },
    });

    const out = await runPipeline(await requestFor("franklin-fobxx-2025"), {
      store: new InMemoryObjectStore(),
      extractors: [new DeterministicParserExtractor(), disagreeing],
    });

    expect(out.kind).toBe("CLAIM_CONFLICT");
    if (out.kind !== "CLAIM_CONFLICT") return;

    expect(out.conflictingFields).toContain("transfer.permissionModel");
    expect(out.trace.branch).toBe("CLAIM_CONFLICT");
    expect(out.trace.stages).not.toContain("CORROBORATED");
    // The load-bearing assertion: there is no `candidate` key on this outcome at all, so a caller
    // cannot commit one by accident.
    expect("candidate" in out).toBe(false);
  });

  it("a conflict restricts the version that already exists rather than committing a new one", async () => {
    const disagreeing = new StubExtractor("disagreeing-model@test", "chaingpt", {
      "transfer.permissionModel": { kind: "enum", ordinal: 0, name: "OPEN" },
    });

    const req = await requestFor("franklin-fobxx-2025");
    const out = await runPipeline(
      { ...req, version: 3 },
      { store: new InMemoryObjectStore(), extractors: [new DeterministicParserExtractor(), disagreeing] },
    );

    expect(out.kind).toBe("CLAIM_CONFLICT");
    if (out.kind !== "CLAIM_CONFLICT") return;

    expect(out.calls.map((c) => c.functionName)).toEqual(["restrict", "bumpEpoch"]);
    expect(out.calls.some((c) => c.functionName === "commitPassport")).toBe(false);

    const restrict = decodeFunctionData({ abi: PASSPORT_REGISTRY_ABI, data: out.calls[0]!.data });
    expect(restrict.functionName).toBe("restrict");
    // Version 2, the one that is current — not version 3, which must never be written.
    expect(restrict.args).toEqual([ASSET_ID, 2n, 3]);
  });

  it("a conflict on the first ever version has nothing to restrict and says so", async () => {
    const disagreeing = new StubExtractor("disagreeing-model@test", "chaingpt", {
      "transfer.permissionModel": { kind: "enum", ordinal: 0, name: "OPEN" },
    });

    const out = await runPipeline(await requestFor("franklin-fobxx-2025"), {
      store: new InMemoryObjectStore(),
      extractors: [new DeterministicParserExtractor(), disagreeing],
    });

    expect(out.kind).toBe("CLAIM_CONFLICT");
    if (out.kind !== "CLAIM_CONFLICT") return;
    expect(out.calls.map((c) => c.functionName)).toEqual(["bumpEpoch"]);
  });

  it("a forged source hash ends the run at SCHEMA_INVALID and is terminal", async () => {
    const req = await requestFor("franklin-fobxx-2025");
    const store = new InMemoryObjectStore();

    const out = await runPipeline(
      { ...req, document: { ...req.document, assertedSourceHash: `0x${"ff".repeat(32)}` } },
      { store, extractors: [new DeterministicParserExtractor()] },
    );

    expect(out.kind).toBe("SCHEMA_INVALID");
    if (out.kind !== "SCHEMA_INVALID") return;
    expect(out.reason).toMatch(/SourceHashMismatch/);
    expect(out.terminal).toBe(true);
    expect(out.trace.stages).toEqual(["FETCHED"]);
    expect(store.writes).toBe(0);
  });

  it("a document that answers nothing still produces a Passport, and it restricts", async () => {
    // The Ondo page states its terms in phrasings the deterministic parser does not recognise, so it
    // abstains on every field. The Passport is committable and carries redemptionSupported = false,
    // which drops the floor term from `min(...)` and leaves recognised value on haircut and stressed
    // exit alone. Absence restricts; it never expands.
    const out = await runPipeline(await requestFor("ondo-ousg-overview"), {
      store: new InMemoryObjectStore(),
      extractors: [new DeterministicParserExtractor()],
    });

    expect(out.kind).toBe("READY_TO_COMMIT");
    if (out.kind !== "READY_TO_COMMIT") return;

    expect(out.candidate.redemptionSupported).toBe(false);
    expect(out.candidate.redemptionFloorBps).toBe(0);
    expect(out.built.claimLeaves).toHaveLength(0);
    expect(out.candidate.claimsRoot).toBe(`0x${"00".repeat(32)}`);
    // The evidence root is still real: the document exists and is committed even though it answered
    // no question, which is what `EmptyEvidenceRoot` on the registry requires.
    expect(out.candidate.evidenceRoot).not.toBe(`0x${"00".repeat(32)}`);
  });

  it("builds one Passport from a prospectus and a supplement", async () => {
    // A real admission rests on more than one document. The claim sets are corroborated together, so a
    // supplement contradicting the prospectus is a conflict rather than a silent last-writer-wins.
    const prospectus = (await ingestFixture("franklin-fobxx-2025")).result.document;
    const supplement = (await ingestFixture("franklin-fobxx-2026")).result.document;

    const parser = new DeterministicParserExtractor();
    const sets = await Promise.all(
      [prospectus, supplement].map(async (doc) => ({
        extractor: parser.id,
        independenceGroup: parser.independenceGroup,
        claims: (await parser.extract(doc)).claims,
      })),
    );

    const out = await buildFromDocuments({
      assetId: ASSET_ID,
      version: 1,
      documents: [prospectus, supplement],
      claimSets: sets,
      expiresAt: 0,
      builtAt: 1_786_987_500,
    });

    expect(out.kind).toBe("READY_TO_COMMIT");
    if (out.kind !== "READY_TO_COMMIT") return;
    expect(out.built.candidate.evidenceIds).toHaveLength(2);
    expect(out.built.candidate.evidenceRoot).toBe(merkleRoot([prospectus.evidenceId, supplement.evidenceId]));
  });

  it("emits the calls in the order they must be sent", async () => {
    const out = await runPipeline(await requestFor("franklin-fobxx-2025"), {
      store: new InMemoryObjectStore(),
      extractors: [new DeterministicParserExtractor()],
    });

    expect(out.kind).toBe("READY_TO_COMMIT");
    if (out.kind !== "READY_TO_COMMIT") return;

    // Evidence before Passport: an evidenceRoot over commitments that do not exist yet is a
    // commitment to nothing, and no contract checks the relationship.
    expect(out.calls.map((c) => `${c.contract}.${c.functionName}`)).toEqual([
      "EvidenceRegistry.commit",
      "PassportRegistry.commitPassport",
      "RiskPolicyRegistry.bumpEpoch",
    ]);
    for (const call of out.calls) expect(call.requiredRole).toBe("ADMISSION");
  });
});

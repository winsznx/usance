import { describe, expect, it } from "vitest";
import { issuerId, sourceHash, SourceClass, canonicalizeText } from "@usance/schemas";
import { ingest, ContentHashMismatch, LowTrustSourceRejected, SourceHashMismatch } from "../src/ingest";
import { InMemoryObjectStore } from "../src/store";
import { loadFixture } from "../src/fixtures";
import { ingestFixture } from "./support";

const FIXTURE = "franklin-fobxx-2025";

describe("ingest", () => {
  it("turns a real SEC filing into a CanonicalDocument", async () => {
    const { entry } = await loadFixture(FIXTURE);
    const { result } = await ingestFixture(FIXTURE);

    expect(result.document.evidenceId).toBe(entry.evidenceId);
    expect(result.document.contentHash).toBe(entry.contentHash);
    expect(result.document.sourceHash).toBe(entry.sourceHash);
    expect(result.document.sourceClass).toBe(SourceClass.REGULATORY_FILING);
    expect(result.document.mediaType).toBe("text/html");
    expect(result.canonicalText).toContain("FRANKLIN ONCHAIN U.S. GOVERNMENT MONEY FUND");
    expect(result.canonicalText).toContain("whitelist of permissioned wallets");
  });

  it("is idempotent: the same bytes twice produce the same evidenceId and one stored object", async () => {
    const { entry, bytes } = await loadFixture(FIXTURE);
    const store = new InMemoryObjectStore(() => entry.retrievedAt);

    const req = {
      uri: entry.uri,
      issuerId: entry.issuer.issuerId,
      sourceClass: entry.sourceClass,
      bytes,
      mediaType: entry.mediaType,
      retrievedAt: entry.retrievedAt,
      effectiveAt: entry.effectiveAt,
      assertedSourceHash: entry.sourceHash,
    };

    const first = await ingest(req, store);
    const second = await ingest(req, store);

    expect(second.document.evidenceId).toBe(first.document.evidenceId);
    expect(second.rawDigest).toBe(first.rawDigest);
    expect(first.stored.created).toBe(true);
    expect(second.stored.created).toBe(false);
    // The assertion that matters: a re-fetch wrote nothing. Otherwise "immutable content-addressed"
    // would mean "we happen to write the same bytes again".
    expect(store.writes).toBe(1);
  });

  it("rejects correct bytes carrying a forged source hash", async () => {
    const { entry, bytes } = await loadFixture(FIXTURE);
    const store = new InMemoryObjectStore();

    // The bytes are genuine and the origin metadata is not: this is the same document presented as
    // though a different issuer had published it.
    const impostor = issuerId("Definitely Not Franklin Ltd", "KY");
    const forged = sourceHash(entry.uri, impostor);
    expect(forged).not.toBe(entry.sourceHash);

    await expect(
      ingest(
        {
          uri: entry.uri,
          issuerId: entry.issuer.issuerId,
          sourceClass: entry.sourceClass,
          bytes,
          mediaType: entry.mediaType,
          retrievedAt: entry.retrievedAt,
          effectiveAt: entry.effectiveAt,
          assertedSourceHash: forged,
        },
        store,
      ),
    ).rejects.toBeInstanceOf(SourceHashMismatch);

    // Rejected before anything was written. A store that accumulated objects for refused documents
    // would stop meaning "these bytes passed ingest".
    expect(store.writes).toBe(0);
  });

  it("rejects a document whose canonical digest is not the one asserted", async () => {
    const { entry, bytes } = await loadFixture(FIXTURE);
    const store = new InMemoryObjectStore();
    const wrong = `0x${"11".repeat(32)}` as const;

    await expect(
      ingest(
        {
          uri: entry.uri,
          issuerId: entry.issuer.issuerId,
          sourceClass: entry.sourceClass,
          bytes,
          mediaType: entry.mediaType,
          retrievedAt: entry.retrievedAt,
          effectiveAt: entry.effectiveAt,
          assertedSourceHash: entry.sourceHash,
          assertedContentHash: wrong,
        },
        store,
      ),
    ).rejects.toBeInstanceOf(ContentHashMismatch);
    expect(store.writes).toBe(0);
  });

  it("refuses to ingest a low-trust source as claim-bearing evidence", async () => {
    const { entry, bytes } = await loadFixture(FIXTURE);
    const store = new InMemoryObjectStore();

    for (const weak of [SourceClass.SOCIAL, SourceClass.NEWS, SourceClass.MARKET_DATA]) {
      await expect(
        ingest(
          {
            uri: entry.uri,
            issuerId: entry.issuer.issuerId,
            sourceClass: weak,
            bytes,
            mediaType: entry.mediaType,
            retrievedAt: entry.retrievedAt,
            effectiveAt: entry.effectiveAt,
            assertedSourceHash: entry.sourceHash,
          },
          store,
        ),
      ).rejects.toBeInstanceOf(LowTrustSourceRejected);
    }
    expect(store.writes).toBe(0);
  });

  it("the same bytes under a different effective date are different evidence", async () => {
    const { entry, bytes } = await loadFixture(FIXTURE);
    const store = new InMemoryObjectStore();
    const base = {
      uri: entry.uri,
      issuerId: entry.issuer.issuerId,
      sourceClass: entry.sourceClass,
      bytes,
      mediaType: entry.mediaType,
      retrievedAt: entry.retrievedAt,
      assertedSourceHash: entry.sourceHash,
    };

    const a = await ingest({ ...base, effectiveAt: entry.effectiveAt }, store);
    const b = await ingest({ ...base, effectiveAt: entry.effectiveAt + 86_400 }, store);

    expect(a.document.contentHash).toBe(b.document.contentHash);
    expect(a.document.evidenceId).not.toBe(b.document.evidenceId);
    // One object, two evidence ids: the bytes are the same, the evidence is not.
    expect(store.writes).toBe(1);
  });

  it("three genuine versions of one filing are three distinct evidence ids", async () => {
    const versions = await Promise.all(
      ["franklin-fobxx-2024", "franklin-fobxx-2025", "franklin-fobxx-2026"].map(ingestFixture),
    );
    const ids = versions.map((v) => v.result.document.evidenceId);
    expect(new Set(ids).size).toBe(3);
    expect(new Set(versions.map((v) => v.result.document.contentHash)).size).toBe(3);
    // Each annual filing is served from its own EDGAR accession path, so the sourceHash differs too.
    // Only the issuer identity is shared, which is the correct granularity: `sourceHash` commits to a
    // retrieval origin, and three filings are three origins.
    expect(new Set(versions.map((v) => v.result.document.sourceHash)).size).toBe(3);
  });

  it("a monthly re-issue differing only in its dates is still different evidence", async () => {
    // The harder version case. Two consecutive Arca repurchase notices share almost every sentence and
    // differ in the dates, which is exactly where a canonicaliser that normalised too aggressively
    // would collapse two months into one document and let a stale Passport look current.
    const [july, august] = await Promise.all(
      ["arca-arcoin-2026-07", "arca-arcoin-2026-08"].map(ingestFixture),
    );

    expect(july!.result.document.contentHash).not.toBe(august!.result.document.contentHash);
    expect(july!.result.document.evidenceId).not.toBe(august!.result.document.evidenceId);
    expect(july!.result.canonicalText).toContain("July 1, 2026");
    expect(august!.result.canonicalText).toContain("August 3, 2026");
  });

  it("canonicalisation is idempotent over decoded filing text", async () => {
    const { result } = await ingestFixture(FIXTURE);
    expect(canonicalizeText(result.canonicalText)).toBe(result.canonicalText);
  });
});

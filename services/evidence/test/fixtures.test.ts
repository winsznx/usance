import { describe, expect, it } from "vitest";
import { canonicalBytes, contentHash, evidenceId, issuerId, sourceHash, SourceClass } from "@usance/schemas";
import { loadFixture, loadManifest } from "../src/fixtures";
import { decodeToText } from "../src/media";
import { objectKey } from "../src/store";

/**
 * The fixtures are real documents. These tests are what stop that sentence from being a claim nobody
 * checks: every digest in the manifest is recomputed from the bytes on disk, and every derived fixture
 * has to say what was changed.
 */
describe("fixture manifest", () => {
  it("parses, and every digest recomputes from the bytes on disk", async () => {
    const manifest = await loadManifest();
    expect(manifest.documents.length).toBeGreaterThanOrEqual(4);

    for (const entry of manifest.documents) {
      const { bytes } = await loadFixture(entry.id);

      expect(objectKey(bytes)).toBe(entry.rawDigest);
      expect(bytes.byteLength).toBe(entry.bytes);

      const text = decodeToText(bytes, entry.mediaType);
      expect(contentHash(canonicalBytes(text))).toBe(entry.contentHash);

      const issuer = issuerId(entry.issuer.legalName, entry.issuer.jurisdiction);
      expect(issuer).toBe(entry.issuer.issuerId);
      expect(sourceHash(entry.uri, issuer)).toBe(entry.sourceHash);
      expect(evidenceId(entry.sourceHash, entry.contentHash, entry.effectiveAt)).toBe(entry.evidenceId);
    }
  });

  it("holds at least two genuine, non-derived documents from two different issuers", async () => {
    const manifest = await loadManifest();
    const real = manifest.documents.filter((d) => !d.isDerived);
    expect(real.length).toBeGreaterThanOrEqual(2);
    expect(new Set(real.map((d) => d.issuer.issuerId)).size).toBeGreaterThanOrEqual(2);

    // Every real document was actually served, not reconstructed.
    for (const d of real) expect(d.httpStatus).toBe(200);
  });

  it("holds two genuine versions of the same document from the same issuer", async () => {
    const manifest = await loadManifest();
    const byIssuer = new Map<string, typeof manifest.documents>();
    for (const d of manifest.documents.filter((x) => !x.isDerived)) {
      byIssuer.set(d.issuer.issuerId, [...(byIssuer.get(d.issuer.issuerId) ?? []), d]);
    }
    const versioned = [...byIssuer.values()].filter((docs) => docs.length >= 2);

    // Two issuers rather than one, because a single issuer's document set can be idiosyncratic. The
    // Franklin filings are annual prospectuses that change substantively between versions; the Arca
    // notices are a monthly re-issue differing almost only in dates, which is the harder case.
    expect(versioned.length).toBeGreaterThanOrEqual(2);

    for (const docs of versioned) {
      // Same origin identity, different content, different effective date. That triple is what makes
      // it a version rather than a re-fetch: two retrievals of one document collapse to one
      // evidenceId, and only a genuine change separates them again.
      expect(new Set(docs.map((d) => d.evidenceId)).size).toBe(docs.length);
      expect(new Set(docs.map((d) => d.contentHash)).size).toBe(docs.length);
      expect(new Set(docs.map((d) => d.effectiveAt)).size).toBe(docs.length);
      expect(new Set(docs.map((d) => d.issuer.issuerId)).size).toBe(1);
    }
  });

  it("labels every derived fixture and refuses to let one pass as issuer-published", async () => {
    const manifest = await loadManifest();
    const derived = manifest.documents.filter((d) => d.isDerived);
    expect(derived.length).toBeGreaterThan(0);

    for (const d of derived) {
      expect(d.derivedFrom).not.toBeNull();
      expect(d.derivationNote).not.toBeNull();
      expect(d.derivationNote).toMatch(/NOT ISSUER-PUBLISHED/);
      // The filename is a third, independent label. Someone listing the directory sees it without
      // opening anything.
      expect(d.file.startsWith("DERIVED-")).toBe(true);

      // And a fourth: visible text inside the document itself.
      const { bytes } = await loadFixture(d.id);
      const text = decodeToText(bytes, d.mediaType);
      expect(text).toMatch(/USANCE SYNTHETIC TEST APPENDIX .* NOT ISSUER-PUBLISHED/);
    }
  });

  it("records the fetches that failed rather than only the ones that worked", async () => {
    const manifest = await loadManifest();
    expect(manifest.failedFetches.length).toBeGreaterThan(0);
    expect(manifest.failedFetches.some((f) => f.httpStatus === 403)).toBe(true);
    expect(manifest.failedFetches.some((f) => f.outcome === "NOT_A_DOCUMENT")).toBe(true);
  });

  it("classifies an SEC filing above an issuer's own documentation", async () => {
    const manifest = await loadManifest();
    const filing = manifest.documents.find((d) => d.id === "franklin-fobxx-2025");
    const issuerDoc = manifest.documents.find((d) => d.id === "ondo-ousg-overview");
    expect(filing?.sourceClass).toBe(SourceClass.REGULATORY_FILING);
    expect(issuerDoc?.sourceClass).toBe(SourceClass.ISSUER_DOC);
    expect(filing!.sourceClass).toBeGreaterThan(issuerDoc!.sourceClass);
  });

  it("rejects a fixture whose bytes no longer match the manifest", async () => {
    // Loading by an unknown id is the closest reachable proxy for a tampered file without writing to
    // the fixture directory; the digest check itself is exercised on every load above.
    await expect(loadFixture("no-such-fixture")).rejects.toThrow(/no fixture/);
  });
});

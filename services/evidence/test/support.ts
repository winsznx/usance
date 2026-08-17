import {
  UNKNOWN,
  type CanonicalDocument,
  type ClaimValue,
  type EvidenceClaim,
  type EvidenceExtractor,
  type Extraction,
  ProviderUnavailable,
} from "@usance/schemas";
import { ingest, type IngestResult } from "../src/ingest";
import { InMemoryObjectStore } from "../src/store";
import { loadFixture } from "../src/fixtures";

/**
 * Test doubles.
 *
 * Every double here implements the same interface the real providers do and fails the same way. A
 * lenient double is worse than no double: it proves the pipeline works against a provider that does
 * not exist.
 */

/** An extractor that returns exactly the claims it was given. */
export class StubExtractor implements EvidenceExtractor {
  constructor(
    readonly id: string,
    readonly independenceGroup: string,
    private readonly values: Readonly<Record<string, ClaimValue | typeof UNKNOWN>>,
  ) {}

  async extract(doc: CanonicalDocument): Promise<Extraction> {
    const claims: EvidenceClaim[] = Object.entries(this.values).map(([field, value]) => ({
      field,
      value,
      locator:
        value === UNKNOWN
          ? null
          : { section: null, startOffset: null, endOffset: null, quote: `stub quote for ${field}` },
      evidenceId: doc.evidenceId,
      sourceClass: doc.sourceClass,
      retrievedAt: doc.retrievedAt,
      effectiveAt: doc.effectiveAt,
      expiresAt: null,
      extractor: this.id,
      confidenceBps: value === UNKNOWN ? 0 : 10_000,
      corroboratingEvidenceIds: [],
      attestation: null,
    }));
    return {
      extractor: this.id,
      documentEvidenceId: doc.evidenceId,
      claims,
      startedAt: doc.retrievedAt,
      finishedAt: doc.retrievedAt,
      warnings: [],
    };
  }
}

/** Stands in for the model path with no credential configured. */
export class UnavailableExtractor implements EvidenceExtractor {
  readonly id = "unavailable-stub@1";
  readonly independenceGroup = "chaingpt";

  async extract(): Promise<Extraction> {
    throw new ProviderUnavailable(this.id, "access_required", "no credential configured in this test");
  }
}

/** Loads a real fixture and runs it through the real ingest stage. */
export async function ingestFixture(id: string): Promise<{ result: IngestResult; store: InMemoryObjectStore }> {
  const { entry, bytes } = await loadFixture(id);
  const store = new InMemoryObjectStore(() => entry.retrievedAt);
  const result = await ingest(
    {
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
    store,
  );
  return { result, store };
}

/** Deterministic pseudo-random source, so jitter is testable without being disabled. */
export function seededRandom(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    // xorshift32. Not cryptographic, and not required to be — it exists so a backoff test can assert
    // both bounds and variation without depending on Math.random.
    s ^= s << 13;
    s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 0x1_0000_0000;
  };
}

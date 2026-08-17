import {
  CANONICALIZER_VERSION,
  canonicalBytes,
  canonicalDocumentSchema,
  canonicalizeText,
  contentHash as contentHashOf,
  evidenceId as evidenceIdOf,
  isLowTrust,
  sourceClassName,
  sourceHash as sourceHashOf,
  type CanonicalDocument,
  type Hex32,
  type SourceClass,
  type UnixSeconds,
} from "@usance/schemas";
import { baseMediaType, decodeToText, MEDIA_DECODER_VERSION } from "./media";
import type { ObjectStore, PutResult } from "./store";

/**
 * Ingest: raw bytes to a `CanonicalDocument` that the rest of the pipeline can cite.
 *
 * This is the `FETCHED → HASHED → CANONICALIZED` span of `spec/evidence-model.md §2`, and it is the
 * last point at which the pipeline is dealing with a document rather than with claims about one.
 *
 * Two rejections live here, and they are the reason this is a stage rather than three lines inline.
 */

export class SourceHashMismatch extends Error {
  constructor(
    readonly expected: Hex32,
    readonly recomputed: Hex32,
    readonly uri: string,
  ) {
    super(
      `sourceHash mismatch for ${uri}: caller asserted ${expected}, recomputed ${recomputed}. ` +
        "The bytes may be genuine and the origin metadata is not. Rejected without storing.",
    );
    this.name = "SourceHashMismatch";
  }
}

export class ContentHashMismatch extends Error {
  constructor(
    readonly expected: Hex32,
    readonly recomputed: Hex32,
    readonly uri: string,
  ) {
    super(
      `contentHash mismatch for ${uri}: caller asserted ${expected}, recomputed ${recomputed}. ` +
        "Either the bytes changed or the canonicaliser did; both are events, not warnings.",
    );
    this.name = "ContentHashMismatch";
  }
}

export class LowTrustSourceRejected extends Error {
  constructor(readonly sourceClass: SourceClass) {
    super(
      `${sourceClassName(sourceClass)} may not be ingested as claim-bearing evidence. ` +
        "News, social and market chatter enter through the observation channel, where the strongest " +
        "thing they can do is trigger a review or a re-read of an authoritative source " +
        "(spec/evidence-model.md §9).",
    );
    this.name = "LowTrustSourceRejected";
  }
}

export interface IngestRequest {
  /** Canonical retrieval URI. Part of `sourceHash`, so it is identity, not a comment. */
  readonly uri: string;
  /** From `issuerId(legalName, jurisdiction)`. Derived upstream, never assigned by a human. */
  readonly issuerId: Hex32;
  readonly sourceClass: SourceClass;
  readonly bytes: Uint8Array;
  readonly mediaType: string;
  readonly retrievedAt: UnixSeconds;
  /**
   * When the document itself says it takes effect.
   *
   * Distinct from `retrievedAt` and part of `evidenceId`: the same bytes republished under a
   * different effective date are different evidence, and a filing dated months before Usance saw it
   * has two honest timestamps that are not interchangeable (`spec/evidence-model.md §3`).
   */
  readonly effectiveAt: UnixSeconds;
  /**
   * The origin digest the fetcher recorded.
   *
   * Required, not optional. This is the forged-source-metadata defence and an optional check is a
   * check that gets skipped: `sourceHash` is recomputed from `(uri, issuerId)` and compared, so
   * correct bytes presented under a wrong origin are refused instead of quietly acquiring the
   * original's identity.
   */
  readonly assertedSourceHash: Hex32;
  /** Optional. When present, the canonical digest is checked the same way. */
  readonly assertedContentHash?: Hex32 | undefined;
}

export interface IngestResult {
  readonly document: CanonicalDocument;
  /** `keccak256` of the bytes as fetched. The object-store key, distinct from `contentHash`. */
  readonly rawDigest: Hex32;
  readonly stored: PutResult;
  /** The canonicalised text, so downstream stages need not decode `document.bytes` again. */
  readonly canonicalText: string;
  readonly canonicalizerVersion: string;
  readonly mediaDecoderVersion: string;
}

/**
 * Run the ingest stage.
 *
 * Order is deliberate: every rejection happens before anything is written. A store that accumulated
 * objects for documents the pipeline then refused would turn a rejection into a slow leak of
 * untrusted bytes, and worse, would make "is this in the store?" stop meaning "did this pass
 * ingest?".
 */
export async function ingest(
  req: IngestRequest,
  store: ObjectStore,
  signal?: AbortSignal,
): Promise<IngestResult> {
  if (isLowTrust(req.sourceClass)) throw new LowTrustSourceRejected(req.sourceClass);

  const recomputedSource = sourceHashOf(req.uri, req.issuerId);
  if (recomputedSource.toLowerCase() !== req.assertedSourceHash.toLowerCase()) {
    throw new SourceHashMismatch(req.assertedSourceHash, recomputedSource, req.uri);
  }

  const text = decodeToText(req.bytes, req.mediaType);
  const canonicalText = canonicalizeText(text);
  const bytes = canonicalBytes(text);
  const contentHash = contentHashOf(bytes);

  if (req.assertedContentHash !== undefined && req.assertedContentHash.toLowerCase() !== contentHash) {
    throw new ContentHashMismatch(req.assertedContentHash, contentHash, req.uri);
  }

  const evidenceId = evidenceIdOf(recomputedSource, contentHash, req.effectiveAt);

  const document: CanonicalDocument = canonicalDocumentSchema.parse({
    evidenceId,
    contentHash,
    sourceHash: recomputedSource,
    sourceClass: req.sourceClass,
    canonicalizerVersion: CANONICALIZER_VERSION,
    // Normalised: `text/markdown; charset=utf-8` and `text/markdown` are the same container, and
    // carrying the parameter would put the serving server's whim inside the document record.
    mediaType: baseMediaType(req.mediaType),
    bytes,
    retrievedAt: req.retrievedAt,
    effectiveAt: req.effectiveAt,
  });

  const stored = await store.put(req.bytes, baseMediaType(req.mediaType), signal);

  return {
    document,
    rawDigest: stored.digest,
    stored,
    canonicalText,
    canonicalizerVersion: CANONICALIZER_VERSION,
    mediaDecoderVersion: MEDIA_DECODER_VERSION,
  };
}

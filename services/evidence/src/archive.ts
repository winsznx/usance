import { objectKey, type ObjectStore, type PutResult, type StoredObject } from "./store";
import type { Hex32, UnixSeconds } from "@usance/schemas";

export type EvidenceArchiveClassification = "PUBLIC" | "APPROVED_ARCHIVE" | "CONFIDENTIAL" | "RESTRICTED";

export interface EvidenceArchiveManifest {
  readonly schemaVersion: "usance-evidence-archive/v1";
  readonly evidenceId: Hex32;
  readonly sourceDigest: Hex32;
  readonly canonicalContentHash: Hex32;
  readonly mediaType: string;
  readonly size: number;
  readonly classification: "PUBLIC" | "APPROVED_ARCHIVE";
  readonly storageProvider: "0G_STORAGE";
  readonly storageRoot: string;
  readonly archivedAt: UnixSeconds;
}

export class ArchiveEligibilityRejected extends Error {
  constructor(readonly classification: EvidenceArchiveClassification) {
    super(`${classification} evidence is ineligible for public decentralized storage`);
    this.name = "ArchiveEligibilityRejected";
  }
}

export class ArchivedBytesMismatch extends Error {
  constructor(readonly expected: Hex32, readonly actual: Hex32) {
    super(`archived bytes digest mismatch: expected ${expected}, received ${actual}`);
    this.name = "ArchivedBytesMismatch";
  }
}

export interface ZeroGArchiveRecord { readonly root: string; readonly storedAt: UnixSeconds; }

/** A storage adapter may be unavailable without changing source-of-truth evidence state. */
export interface ZeroGArchiveTransport {
  upload(bytes: Uint8Array, mediaType: string, signal?: AbortSignal): Promise<ZeroGArchiveRecord>;
  download(root: string, signal?: AbortSignal): Promise<Uint8Array | null>;
}

/**
 * `ObjectStore` compatibility for 0G Storage. The Usance digest remains the key; the 0G Merkle
 * root is retained separately and never mistaken for a legal/evidence truth claim.
 */
export class ZeroGObjectStore implements ObjectStore {
  readonly name = "zerog-object-store/1";
  private readonly records = new Map<Hex32, { readonly stored: StoredObject; readonly root: string }>();

  constructor(private readonly transport: ZeroGArchiveTransport) {}

  async put(bytes: Uint8Array, mediaType: string, signal?: AbortSignal): Promise<PutResult> {
    const digest = objectKey(bytes);
    const existing = this.records.get(digest);
    if (existing) return { ...existing.stored, created: false };
    const remote = await this.transport.upload(bytes, mediaType, signal);
    const stored: StoredObject = { digest, size: bytes.byteLength, mediaType, storedAt: remote.storedAt };
    this.records.set(digest, { stored, root: remote.root });
    return { ...stored, created: true };
  }

  async get(digest: Hex32, signal?: AbortSignal): Promise<Uint8Array | null> {
    const record = this.records.get(digest);
    if (!record) return null;
    const bytes = await this.transport.download(record.root, signal);
    if (bytes === null) return null;
    const actual = objectKey(bytes);
    if (actual !== digest) throw new ArchivedBytesMismatch(digest, actual);
    return bytes;
  }

  async head(digest: Hex32): Promise<StoredObject | null> { return this.records.get(digest)?.stored ?? null; }
  rootFor(digest: Hex32): string | null { return this.records.get(digest)?.root ?? null; }
}

export async function archiveApprovedEvidence(input: {
  readonly classification: EvidenceArchiveClassification;
  readonly evidenceId: Hex32;
  readonly canonicalContentHash: Hex32;
  readonly bytes: Uint8Array;
  readonly mediaType: string;
  readonly store: ZeroGObjectStore;
  readonly signal?: AbortSignal;
}): Promise<EvidenceArchiveManifest> {
  if (input.classification !== "PUBLIC" && input.classification !== "APPROVED_ARCHIVE") {
    throw new ArchiveEligibilityRejected(input.classification);
  }
  const stored = await input.store.put(input.bytes, input.mediaType, input.signal);
  const root = input.store.rootFor(stored.digest);
  if (root === null) throw new Error("0G archive did not retain a root for stored bytes");
  return {
    schemaVersion: "usance-evidence-archive/v1", evidenceId: input.evidenceId, sourceDigest: stored.digest,
    canonicalContentHash: input.canonicalContentHash, mediaType: stored.mediaType, size: stored.size,
    classification: input.classification, storageProvider: "0G_STORAGE", storageRoot: root, archivedAt: stored.storedAt,
  };
}

export async function verifyArchivedEvidence(manifest: EvidenceArchiveManifest, transport: ZeroGArchiveTransport): Promise<Uint8Array> {
  const bytes = await transport.download(manifest.storageRoot);
  if (bytes === null) throw new Error(`0G archive object ${manifest.storageRoot} is unavailable`);
  const actual = objectKey(bytes);
  if (actual !== manifest.sourceDigest) throw new ArchivedBytesMismatch(manifest.sourceDigest, actual);
  return bytes;
}

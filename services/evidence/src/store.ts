import { mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { keccak256 } from "viem";
import type { Hex32, UnixSeconds } from "@usance/schemas";

/**
 * Immutable, content-addressed object storage for the bytes a Passport rests on.
 *
 * The point of this layer is answering one question forever: *is the document being shown to a user
 * today the document the protocol priced?* `EvidenceRegistry` holds the 32-byte answer; this holds
 * the bytes it is an answer about.
 *
 * Three properties make that work, and all three are enforced rather than documented:
 *
 *  1. **The key is the content.** `objectKey(bytes)` is `keccak256` of the raw bytes, so a store can
 *     never hold the wrong bytes under a key. There is no `put(key, bytes)` overload for a caller to
 *     misuse.
 *  2. **Writes are append-only.** `put` of bytes already present is a no-op reporting
 *     `created: false`. There is no `delete` and no overwrite path.
 *  3. **The bytes are verbatim.** Nothing here decodes, normalises or re-encodes. Canonicalisation
 *     happens downstream and produces a *different* digest; keeping the original recoverable is what
 *     lets a dispute be re-litigated under a future canonicaliser version.
 *
 * Cloudflare R2 is the production target and the interface is shaped for it: `put` maps to
 * `PutObject` with `If-None-Match: *` (R2 returns 412 on a key that exists, which is exactly
 * `created: false`), `head` maps to `HeadObject`, `get` to `GetObject`. No credential is required for
 * anything in this file, and `FileSystemObjectStore` is a complete implementation, so the R2 adapter
 * is a new class rather than a redesign.
 */

export interface StoredObject {
  /** `keccak256` of the raw bytes. The storage key, and independent of any canonicalisation. */
  readonly digest: Hex32;
  readonly size: number;
  /** As reported by the origin. Recorded, never inferred from the bytes. */
  readonly mediaType: string;
  readonly storedAt: UnixSeconds;
}

export interface PutResult extends StoredObject {
  /**
   * False when these exact bytes were already stored.
   *
   * The caller needs this to tell a genuine re-ingest from a duplicate: a re-fetch of the same
   * document must not produce a second stored object, and `EvidenceRegistry.commit` reverting
   * `AlreadyCommitted` on the resulting `evidenceId` is designed behaviour, not a bug to route
   * around (`spec/evidence-model.md §3`).
   */
  readonly created: boolean;
}

export interface ObjectStore {
  readonly name: string;
  put(bytes: Uint8Array, mediaType: string, signal?: AbortSignal): Promise<PutResult>;
  get(digest: Hex32, signal?: AbortSignal): Promise<Uint8Array | null>;
  /** Metadata without transferring the body. `null`, never a throw, when the key is absent. */
  head(digest: Hex32, signal?: AbortSignal): Promise<StoredObject | null>;
}

/** The storage key for a byte string. Pure, so two implementations cannot disagree about it. */
export function objectKey(bytes: Uint8Array): Hex32 {
  return keccak256(bytes);
}

/** Aborting mid-write would leave a partial object under a digest key, which is the one thing this
 *  store must never do. Callers get the check before any bytes are touched instead. */
function assertNotAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new Error("object store operation aborted before it began");
}

/**
 * Local filesystem store.
 *
 * Layout, chosen to mirror an R2 bucket exactly:
 *
 *   <root>/ab/cdef…            raw bytes, verbatim
 *   <root>/ab/cdef….meta.json  { digest, size, mediaType, storedAt }
 *
 * The two-character shard prefix exists because a flat directory of tens of thousands of entries is
 * slow on every filesystem worth naming, and R2 users shard the same way for listing.
 *
 * The sidecar carries what R2 stores as object metadata. Recording `mediaType` at all matters:
 * `decodeToText` dispatches on it, so losing it would mean re-deriving `contentHash` under a guessed
 * container and getting a different answer.
 */
export class FileSystemObjectStore implements ObjectStore {
  readonly name = "fs-object-store/1";

  constructor(
    private readonly root: string,
    private readonly now: () => UnixSeconds = () => Math.floor(Date.now() / 1000),
  ) {}

  private pathFor(digest: Hex32): string {
    const hex = digest.slice(2);
    return join(this.root, hex.slice(0, 2), hex.slice(2));
  }

  async put(bytes: Uint8Array, mediaType: string, signal?: AbortSignal): Promise<PutResult> {
    assertNotAborted(signal);
    const digest = objectKey(bytes);
    const existing = await this.head(digest);
    if (existing !== null) {
      // Idempotent by content. Reporting `created: false` rather than rewriting also means a
      // concurrent ingest of the same document cannot corrupt an object another reader is holding
      // open, which a rewrite-in-place would allow.
      return { ...existing, created: false };
    }

    const target = this.pathFor(digest);
    await mkdir(dirname(target), { recursive: true });

    const meta: StoredObject = { digest, size: bytes.byteLength, mediaType, storedAt: this.now() };

    // Write to a temporary name and rename into place. `rename` within a directory is atomic on
    // POSIX, so a crash mid-write leaves a stray temp file rather than a truncated object under a
    // digest key — and a truncated object under a digest key is a lie the store could never detect.
    const tmp = `${target}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
    try {
      await writeFile(tmp, bytes, { flag: "wx" });
      await rename(tmp, target);
    } catch (e) {
      await unlink(tmp).catch(() => undefined);
      throw e;
    }
    await writeFile(`${target}.meta.json`, `${JSON.stringify(meta, null, 2)}\n`, "utf8");

    return { ...meta, created: true };
  }

  async get(digest: Hex32, signal?: AbortSignal): Promise<Uint8Array | null> {
    assertNotAborted(signal);
    try {
      const buf = await readFile(this.pathFor(digest));
      return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    } catch {
      return null;
    }
  }

  async head(digest: Hex32, signal?: AbortSignal): Promise<StoredObject | null> {
    assertNotAborted(signal);
    const target = this.pathFor(digest);
    try {
      const s = await stat(target);
      const raw = await readFile(`${target}.meta.json`, "utf8");
      const parsed = JSON.parse(raw) as Partial<StoredObject>;
      return {
        digest,
        size: s.size,
        mediaType: typeof parsed.mediaType === "string" ? parsed.mediaType : "application/octet-stream",
        storedAt: typeof parsed.storedAt === "number" ? parsed.storedAt : Math.floor(s.mtimeMs / 1000),
      };
    } catch {
      return null;
    }
  }
}

/**
 * In-memory store for tests.
 *
 * Kept in the shipped source rather than the test directory because it is the reference for what the
 * interface promises: same key derivation, same no-op-on-duplicate semantics, same `null`-not-throw
 * on a miss. A test double that behaved more forgivingly than production would hide exactly the
 * bugs this store exists to prevent.
 */
export class InMemoryObjectStore implements ObjectStore {
  readonly name = "memory-object-store/1";

  private readonly objects = new Map<Hex32, { bytes: Uint8Array; meta: StoredObject }>();

  /** Number of objects actually written. Lets a test assert that a re-ingest wrote nothing. */
  writes = 0;

  constructor(private readonly now: () => UnixSeconds = () => Math.floor(Date.now() / 1000)) {}

  async put(bytes: Uint8Array, mediaType: string, signal?: AbortSignal): Promise<PutResult> {
    assertNotAborted(signal);
    const digest = objectKey(bytes);
    const existing = this.objects.get(digest);
    if (existing) return { ...existing.meta, created: false };

    const meta: StoredObject = { digest, size: bytes.byteLength, mediaType, storedAt: this.now() };
    // Copied, so a caller mutating its buffer afterwards cannot change stored bytes under a digest.
    this.objects.set(digest, { bytes: bytes.slice(), meta });
    this.writes += 1;
    return { ...meta, created: true };
  }

  async get(digest: Hex32, signal?: AbortSignal): Promise<Uint8Array | null> {
    assertNotAborted(signal);
    const hit = this.objects.get(digest);
    return hit ? hit.bytes.slice() : null;
  }

  async head(digest: Hex32, signal?: AbortSignal): Promise<StoredObject | null> {
    assertNotAborted(signal);
    return this.objects.get(digest)?.meta ?? null;
  }
}

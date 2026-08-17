import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { stringToBytes } from "viem";
import { FileSystemObjectStore, InMemoryObjectStore, objectKey, type ObjectStore } from "../src/store";

const roots: string[] = [];

afterAll(async () => {
  await Promise.all(roots.map((r) => rm(r, { recursive: true, force: true })));
});

async function fsStore(): Promise<FileSystemObjectStore> {
  const root = await mkdtemp(join(tmpdir(), "usance-objects-"));
  roots.push(root);
  return new FileSystemObjectStore(root, () => 1_700_000_000);
}

/**
 * Both implementations are held to the same contract. A test double that behaved more forgivingly than
 * the filesystem store would hide exactly the bugs the store exists to prevent, so the suite runs
 * against both.
 */
const implementations: readonly [string, () => Promise<ObjectStore>][] = [
  ["InMemoryObjectStore", async () => new InMemoryObjectStore(() => 1_700_000_000)],
  ["FileSystemObjectStore", fsStore],
];

describe.each(implementations)("%s", (_name, make) => {
  it("keys objects by the digest of their own content", async () => {
    const store = await make();
    const bytes = stringToBytes("Redemption is supported for eligible holders.");
    const put = await store.put(bytes, "text/plain");

    expect(put.digest).toBe(objectKey(bytes));
    expect(put.size).toBe(bytes.byteLength);
    expect(put.mediaType).toBe("text/plain");
    expect(put.created).toBe(true);
  });

  it("writing the same bytes twice is a no-op, not a duplicate", async () => {
    const store = await make();
    const bytes = stringToBytes("the same document, fetched twice");

    const first = await store.put(bytes, "text/plain");
    const second = await store.put(bytes, "text/plain");

    expect(second.digest).toBe(first.digest);
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.storedAt).toBe(first.storedAt);
  });

  it("returns the bytes verbatim", async () => {
    const store = await make();
    // Includes characters the canonicaliser would change. The store must not canonicalise: keeping
    // the original recoverable is what lets a dispute be re-litigated under a future canonicaliser.
    const bytes = stringToBytes("  ragged\r\n\r\n\r\nwhitespace ​ and a zero-width space\t\n");
    const put = await store.put(bytes, "text/plain");

    const back = await store.get(put.digest);
    expect(back).not.toBeNull();
    expect([...back!]).toEqual([...bytes]);
  });

  it("reports a miss as null rather than throwing", async () => {
    const store = await make();
    const absent = `0x${"ab".repeat(32)}` as const;
    expect(await store.get(absent)).toBeNull();
    expect(await store.head(absent)).toBeNull();
  });

  it("head reports metadata without transferring the body", async () => {
    const store = await make();
    const bytes = stringToBytes("# Ondo OUSG overview");
    const put = await store.put(bytes, "text/markdown");

    const meta = await store.head(put.digest);
    expect(meta).toEqual({
      digest: put.digest,
      size: bytes.byteLength,
      mediaType: "text/markdown",
      storedAt: 1_700_000_000,
    });
  });

  it("different bytes never collide on a key", async () => {
    const store = await make();
    const a = await store.put(stringToBytes("version one"), "text/plain");
    const b = await store.put(stringToBytes("version two"), "text/plain");
    expect(a.digest).not.toBe(b.digest);
    expect(await store.get(a.digest)).not.toBeNull();
    expect(await store.get(b.digest)).not.toBeNull();
  });

  it("refuses an operation that was aborted before it began", async () => {
    const store = await make();
    const controller = new AbortController();
    controller.abort();
    await expect(store.put(stringToBytes("x"), "text/plain", controller.signal)).rejects.toThrow(/aborted/);
  });
});

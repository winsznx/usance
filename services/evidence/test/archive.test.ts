import { describe, expect, it } from "vitest";
import { archiveApprovedEvidence, ArchivedBytesMismatch, ArchiveEligibilityRejected, verifyArchivedEvidence, ZeroGObjectStore, type ZeroGArchiveTransport } from "../src/archive";
import { objectKey } from "../src/store";

function memoryTransport(): ZeroGArchiveTransport & { corrupt: boolean } {
  const objects = new Map<string, Uint8Array>();
  const state = {
    corrupt: false,
    upload: async (bytes: Uint8Array) => { const root = `root:${objectKey(bytes)}`; objects.set(root, bytes.slice()); return { root, storedAt: 1_700_000_000 }; },
    download: async (root: string) => { const bytes = objects.get(root); return bytes ? (state.corrupt ? new TextEncoder().encode("tampered") : bytes.slice()) : null; },
  };
  return state;
}

describe("0G evidence archive", () => {
  it("archives approved public bytes and verifies retrieved bytes locally", async () => {
    const transport = memoryTransport();
    const store = new ZeroGObjectStore(transport);
    const bytes = new TextEncoder().encode("public issuer terms");
    const digest = objectKey(bytes);
    const manifest = await archiveApprovedEvidence({ classification: "PUBLIC", evidenceId: digest, canonicalContentHash: digest, bytes, mediaType: "text/plain", store });
    await expect(verifyArchivedEvidence(manifest, transport)).resolves.toEqual(bytes);
  });

  it("rejects confidential evidence and refuses mismatched archive bytes", async () => {
    const transport = memoryTransport();
    const store = new ZeroGObjectStore(transport);
    const bytes = new TextEncoder().encode("public issuer terms");
    const digest = objectKey(bytes);
    await expect(archiveApprovedEvidence({ classification: "CONFIDENTIAL", evidenceId: digest, canonicalContentHash: digest, bytes, mediaType: "text/plain", store })).rejects.toBeInstanceOf(ArchiveEligibilityRejected);
    const manifest = await archiveApprovedEvidence({ classification: "PUBLIC", evidenceId: digest, canonicalContentHash: digest, bytes, mediaType: "text/plain", store });
    transport.corrupt = true;
    await expect(verifyArchivedEvidence(manifest, transport)).rejects.toBeInstanceOf(ArchivedBytesMismatch);
  });
});

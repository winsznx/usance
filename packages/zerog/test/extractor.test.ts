import { describe, expect, it } from "vitest";
import { ZeroGComputeEvidenceExtractor } from "../src/extractor";
import type { ZeroGDirectInferenceTransport } from "../src/transport";
import { zeroGIndependenceGroup } from "../src/config";
import { keccak256 } from "viem";
import type { CanonicalDocument } from "@usance/schemas";

const config = { provider: "0x0000000000000000000000000000000000000abc", model: "evidence-model/v1", verificationMode: "TEE_TLS" as const, underlyingProviderModel: "provider-a/evidence-model-v1", enabled: true };

function transport(rawResponse: string, expiresAt: number | null = 2_000_000_000): ZeroGDirectInferenceTransport {
  return {
    status: () => "available",
    infer: async () => ({ rawResponse, issuedAt: 1_700_000_000, expiresAt, verificationMode: "TEE_TLS", responseIntegrity: "RESPONSE_INTEGRITY_VERIFIED", providerAttestation: "attestation-ref", rawProofReference: "proof-ref" }),
  };
}

function document(): CanonicalDocument {
  const bytes = new TextEncoder().encode("Franklin Templeton administers this public fund.");
  const digest = keccak256(bytes);
  return { evidenceId: digest, contentHash: digest, sourceHash: digest, sourceClass: 4, canonicalizerVersion: "test/v1", mediaType: "text/plain", bytes, retrievedAt: 1_700_000_000, effectiveAt: 1_700_000_000 };
}

describe("ZeroGComputeEvidenceExtractor", () => {
  it("does not create a second corroboration group for a Router alias of the same provider/model", () => {
    expect(zeroGIndependenceGroup({ underlyingProviderModel: "provider-a/evidence-model-v1" }))
      .toBe(zeroGIndependenceGroup({ underlyingProviderModel: "PROVIDER-A/EVIDENCE-MODEL-V1" }));
  });

  it("materialises only quoted, correctly typed claims with provenance", async () => {
    const extractor = new ZeroGComputeEvidenceExtractor(config, transport(JSON.stringify({ claims: [{ field: "legal.issuerLegalName", value: { kind: "string", value: "Franklin Templeton" }, quote: "Franklin Templeton", section: null, confidenceBps: 9000 }] })));
    const extraction = await extractor.extract(document());
    expect(extraction.claims).toHaveLength(1);
    expect(extraction.provenance?.providerRoute).toBe("DIRECT");
  });

  it("rejects malformed response, stale proof, and unavailable provider", async () => {
    await expect(new ZeroGComputeEvidenceExtractor(config, transport("not json")).extract(document())).rejects.toThrow("strict JSON");
    await expect(new ZeroGComputeEvidenceExtractor(config, transport('{"claims":[]}', 1), () => 2).extract(document())).rejects.toThrow("expired");
    const unavailable = new ZeroGComputeEvidenceExtractor(config, { status: () => "access_required", infer: async () => { throw new Error("unreachable"); } });
    await expect(unavailable.extract(document())).rejects.toThrow("access_required");
  });

  it("drops wrong-unit, hallucinated-source-equivalent quote, and money-action output", async () => {
    const raw = JSON.stringify({ claims: [
      { field: "redemption.floorBps", value: { kind: "seconds", value: 10 }, quote: "Franklin Templeton", section: null, confidenceBps: 1 },
      { field: "legal.issuerLegalName", value: { kind: "string", value: "x" }, quote: "invented source", section: null, confidenceBps: 1 },
      { field: "riskPolicy.maxLtvBps", value: { kind: "bps", value: 9999 }, quote: "Franklin Templeton", section: null, confidenceBps: 1 },
    ] });
    const extraction = await new ZeroGComputeEvidenceExtractor(config, transport(raw)).extract(document());
    expect(extraction.claims).toEqual([]);
    expect(extraction.warnings).toHaveLength(3);
  });
});

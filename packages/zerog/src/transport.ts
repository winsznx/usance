import type { ResponseIntegrity, VerificationMode } from "@usance/schemas";

/** Adapter boundary for the official 0G Direct SDK. Credentials/signers stay outside this package. */
export interface ZeroGDirectInferenceTransport {
  status(): "available" | "access_required" | "not_available";
  infer(request: {
    readonly provider: string;
    readonly model: string;
    readonly prompt: string;
    readonly signal?: AbortSignal;
  }): Promise<{
    readonly rawResponse: string;
    readonly issuedAt: number;
    readonly expiresAt: number | null;
    readonly verificationMode: VerificationMode;
    readonly responseIntegrity: ResponseIntegrity;
    readonly providerAttestation: string | null;
    readonly rawProofReference: string | null;
  }>;
}

/** Minimal 0G Storage transport. The SDK integration may supply this without leaking SDK types. */
export interface ZeroGStorageTransport {
  upload(bytes: Uint8Array, mediaType: string, signal?: AbortSignal): Promise<{ readonly root: string; readonly storedAt: number }>;
  download(root: string, signal?: AbortSignal): Promise<Uint8Array | null>;
}

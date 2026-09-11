import { z } from "zod";
import { claimValueSchema, hex32Schema, unixSecondsSchema, UNKNOWN } from "./primitives";

/**
 * Provenance for an intelligence result. It describes where a response came from, never whether
 * the response is true. All fields are provider-neutral so financial/evidence code never imports
 * a vendor SDK type.
 */
export const verificationModeSchema = z.enum(["NONE", "TEE_ML", "TEE_TLS"]);
export type VerificationMode = z.infer<typeof verificationModeSchema>;

export const responseIntegritySchema = z.enum([
  "UNVERIFIED",
  "RESPONSE_INTEGRITY_VERIFIED",
  "SERVICE_AUTOMATED_CHECKS_PASSED",
  "MANUAL_TEE_REVIEW_RECORDED",
]);
export type ResponseIntegrity = z.infer<typeof responseIntegritySchema>;

export const inferenceProvenanceSchema = z
  .object({
    provider: z.string().min(1).max(200),
    model: z.string().min(1).max(200),
    providerRoute: z.enum(["DIRECT", "ROUTER"]),
    verificationMode: verificationModeSchema,
    responseIntegrity: responseIntegritySchema,
    requestDigest: hex32Schema,
    responseDigest: hex32Schema,
    providerAttestation: z.string().min(1).max(4_000).nullable(),
    sourceEvidenceIds: z.array(hex32Schema).min(1).max(32),
    issuedAt: unixSecondsSchema,
    expiresAt: unixSecondsSchema.nullable(),
    rawProofReference: z.string().min(1).max(2_000).nullable(),
  })
  .strict();

export type InferenceProvenance = z.infer<typeof inferenceProvenanceSchema>;

// Kept here rather than imported from evidence.ts to avoid making the provenance/evidence boundary
// a runtime circular dependency. It is structurally identical to ModelExtraction.
const structuredModelClaimSchema = z
  .object({
    field: z.string().min(1).max(120),
    value: z.union([claimValueSchema, z.literal(UNKNOWN)]),
    quote: z.string().max(2_000).nullable(),
    section: z.string().max(200).nullable(),
    confidenceBps: z.number().int().min(0).max(10_000),
  })
  .strict();

export const evidenceIntelligenceResultSchema = z
  .object({
    provenance: inferenceProvenanceSchema,
    structuredClaims: z.object({ claims: z.array(structuredModelClaimSchema).max(64) }).strict(),
  })
  .strict();

export type EvidenceIntelligenceResult = z.infer<typeof evidenceIntelligenceResultSchema>;

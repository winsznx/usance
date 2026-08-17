import { z } from "zod";
import { sourceClassSchema } from "./source-class";
import {
  bpsSchema,
  claimValueSchema,
  hex32Schema,
  unixSecondsSchema,
  UNKNOWN,
  type ClaimValue,
  type Hex32,
  type Unknown,
} from "./primitives";

/**
 * Evidence, claims, extraction and corroboration.
 *
 * These schemas are the authority boundary made mechanical. Anything a language model returns is
 * parsed through them and discarded if it does not fit, so the widest possible blast radius of a
 * compromised or hallucinating extractor is a rejected extraction — never a changed limit.
 */

/** Where in the canonicalised document a value was found. Required whenever value != UNKNOWN. */
export const documentLocatorSchema = z.object({
  /** Section or clause reference as printed in the document, when it has one. */
  section: z.string().min(1).max(200).nullable(),
  /** Byte offsets into the canonicalised bytes. Verifiable against the stored document. */
  startOffset: z.number().int().min(0).nullable(),
  endOffset: z.number().int().min(0).nullable(),
  /** The exact quoted text the value was read from. This is what a reviewer checks. */
  quote: z.string().min(1).max(2_000),
});

export type DocumentLocator = z.infer<typeof documentLocatorSchema>;

export const claimValueOrUnknownSchema = z.union([claimValueSchema, z.literal(UNKNOWN)]);

export const evidenceClaimSchema = z
  .object({
    field: z
      .string()
      .min(1)
      .max(120)
      // Dotted path into the Passport claim schema. Constrained so a model cannot smuggle an
      // arbitrary key into a downstream object.
      .regex(/^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)*$/, "expected a dotted lowerCamelCase path"),
    value: claimValueOrUnknownSchema,
    locator: documentLocatorSchema.nullable(),
    evidenceId: hex32Schema,
    sourceClass: sourceClassSchema,
    retrievedAt: unixSecondsSchema,
    effectiveAt: unixSecondsSchema,
    expiresAt: unixSecondsSchema.nullable(),
    extractor: z.string().min(1).max(120),
    /**
     * Recorded for triage and audit only. No threshold on this value ever admits a claim —
     * agreement between independent paths does that. A model's confidence is a property of the
     * model, not of the world, and gating admission on it turns calibration drift into a credit
     * event.
     */
    confidenceBps: bpsSchema,
    corroboratingEvidenceIds: z.array(hex32Schema).max(32),
    attestation: z.string().regex(/^0x[0-9a-fA-F]*$/).nullable(),
  })
  .strict()
  .superRefine((c, ctx) => {
    if (c.value !== UNKNOWN && c.locator === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["locator"],
        message: "a claim with a value must say where in the document it was found",
      });
    }
  });

export type EvidenceClaim = z.infer<typeof evidenceClaimSchema>;

export const claimSetSchema = z
  .object({
    extractor: z.string().min(1),
    independenceGroup: z.string().min(1),
    claims: z.array(evidenceClaimSchema),
  })
  .strict();

export type ClaimSet = z.infer<typeof claimSetSchema>;

export const canonicalDocumentSchema = z
  .object({
    evidenceId: hex32Schema,
    contentHash: hex32Schema,
    sourceHash: hex32Schema,
    sourceClass: sourceClassSchema,
    canonicalizerVersion: z.string().min(1),
    mediaType: z.string().min(1),
    // Typed loosely on purpose: TS 5.9 parameterises Uint8Array by its backing buffer, and
    // pinning it to ArrayBuffer rejects the perfectly valid views that TextEncoder returns.
    bytes: z.custom<Uint8Array>((v) => v instanceof Uint8Array, "expected Uint8Array"),
    retrievedAt: unixSecondsSchema,
    effectiveAt: unixSecondsSchema,
  })
  .strict();

export type CanonicalDocument = z.infer<typeof canonicalDocumentSchema>;

export const extractionSchema = z
  .object({
    extractor: z.string().min(1),
    documentEvidenceId: hex32Schema,
    claims: z.array(evidenceClaimSchema),
    startedAt: unixSecondsSchema,
    finishedAt: unixSecondsSchema,
    /** Non-fatal problems. A fatal one throws; a partial extraction is never returned as a full one. */
    warnings: z.array(z.string()),
  })
  .strict();

export type Extraction = z.infer<typeof extractionSchema>;

/**
 * The shape a model is asked to return.
 *
 * Deliberately much smaller than `EvidenceClaim`: the model supplies only what it read, and the
 * pipeline attaches provenance it can verify itself (evidenceId, sourceClass, timestamps). A model
 * that could set its own `sourceClass` could promote its own output.
 */
export const modelClaimSchema = z
  .object({
    field: z.string().min(1).max(120),
    value: claimValueOrUnknownSchema,
    quote: z.string().max(2_000).nullable(),
    section: z.string().max(200).nullable(),
    confidenceBps: bpsSchema,
  })
  .strict();

export const modelExtractionSchema = z
  .object({ claims: z.array(modelClaimSchema).max(64) })
  .strict();

export type ModelExtraction = z.infer<typeof modelExtractionSchema>;

// ---------------------------------------------------------------------------- corroboration

export const fieldOutcomeSchema = z.enum(["AGREED", "CONFLICT", "SINGLE", "ABSENT"]);
export type FieldOutcome = z.infer<typeof fieldOutcomeSchema>;

export interface FieldComparison {
  readonly field: string;
  readonly outcome: FieldOutcome;
  readonly byExtractor: ReadonlyMap<string, ClaimValue | Unknown>;
}

export type CorroborationOutcome = "CORROBORATED" | "SINGLE_SOURCE" | "CLAIM_CONFLICT";

export interface Corroboration {
  readonly outcome: CorroborationOutcome;
  readonly fields: readonly FieldComparison[];
  /** Distinct `independenceGroup` values that produced at least one non-UNKNOWN claim. */
  readonly independentPathCount: number;
}

// ---------------------------------------------------------------------------- observations

export const observationSchema = z
  .object({
    observationId: z.string().min(1),
    /** Low-trust classes only. An observation is never promoted to a claim. */
    sourceClass: z.union([z.literal(0), z.literal(1), z.literal(2)]),
    headline: z.string().min(1),
    uri: z.string().min(1),
    observedAt: unixSecondsSchema,
    assetIds: z.array(hex32Schema),
  })
  .strict();

export type Observation = z.infer<typeof observationSchema>;

export interface ObservationQuery {
  readonly topics: readonly string[];
  readonly assetIds: readonly Hex32[];
  readonly since: number;
  readonly limit: number;
}

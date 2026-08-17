import { z } from "zod";
import { sourceClassSchema } from "./source-class";
import { bpsSchema, hex32Schema, unixSecondsSchema } from "./primitives";
import { claimSetSchema } from "./evidence";

/**
 * The Passport candidate: everything needed to call `PassportRegistry.commitPassport`, and nothing
 * that would let the caller decide a risk parameter.
 *
 * Note what is absent. There is no LTV, no haircut, no maintenance threshold. A Passport says what
 * an asset *is*; `RiskPolicyRegistry` says what it is *worth as collateral*, and only governance
 * writes there. Keeping the two apart is what stops an evidence pipeline from becoming a pricing
 * oracle, and it is why a compromised extractor cannot move a limit even if every other control
 * failed.
 */

export const passportStatusSchema = z.enum([
  "NONE",
  "ACTIVE",
  "STALE",
  "CONFLICTED",
  "SUSPENDED",
  "REVOKED",
]);

export type PassportStatus = z.infer<typeof passportStatusSchema>;

export const admissionOutcomeSchema = z.enum([
  "NEEDS_EVIDENCE",
  "UNDER_REVIEW",
  "ADMITTED",
  "ADMITTED_WITH_LIMITED_CAPABILITIES",
  "REJECTED",
  "SUSPENDED",
]);

export type AdmissionOutcome = z.infer<typeof admissionOutcomeSchema>;

export const passportCandidateSchema = z
  .object({
    assetId: hex32Schema,
    /** Strictly `currentVersion + 1`. The registry rejects anything else. */
    version: z.number().int().positive(),

    evidenceRoot: hex32Schema,
    claimsRoot: hex32Schema,
    /** 0 means no expiry. Anything else is enforced at read time by `effectiveStatus`. */
    expiresAt: unixSecondsSchema,

    // Read on every valuation, so they sit on the header rather than behind a Merkle proof.
    redemptionSupported: z.boolean(),
    redemptionFloorBps: bpsSchema,

    /**
     * True when only one independence group produced claims. The policy caps what such a Passport
     * can unlock (invariant I-17). It is set by the corroborator, never by a caller.
     */
    singleSource: z.boolean(),

    // Provenance, kept offchain but committed to via the roots.
    evidenceIds: z.array(hex32Schema).min(1),
    claimSets: z.array(claimSetSchema).min(1),
    strongestSourceClass: sourceClassSchema,
    corroborationOutcome: z.enum(["CORROBORATED", "SINGLE_SOURCE", "CLAIM_CONFLICT"]),

    builtAt: unixSecondsSchema,
    builderVersion: z.string().min(1),
  })
  .strict()
  .superRefine((p, ctx) => {
    if (!p.redemptionSupported && p.redemptionFloorBps !== 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["redemptionFloorBps"],
        message: "a floor is meaningless without a redemption path; it must be 0",
      });
    }
    if (p.corroborationOutcome === "SINGLE_SOURCE" && !p.singleSource) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["singleSource"],
        message: "SINGLE_SOURCE corroboration must set singleSource",
      });
    }
    if (p.corroborationOutcome === "CLAIM_CONFLICT") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["corroborationOutcome"],
        message: "a conflicted claim set must not be built into a Passport candidate at all",
      });
    }
  });

export type PassportCandidate = z.infer<typeof passportCandidateSchema>;

/**
 * The exact positional argument list for `PassportRegistry.commitPassport`.
 *
 * Returned as calldata for a governance signer. This module never holds a key and never broadcasts:
 * an evidence pipeline that could sign is an evidence pipeline that can commit its own conclusions.
 */
export function commitPassportArgs(
  p: PassportCandidate,
): readonly [`0x${string}`, bigint, `0x${string}`, `0x${string}`, bigint, boolean, number, boolean] {
  return [
    p.assetId,
    BigInt(p.version),
    p.evidenceRoot,
    p.claimsRoot,
    BigInt(p.expiresAt),
    p.redemptionSupported,
    p.redemptionFloorBps,
    p.singleSource,
  ] as const;
}

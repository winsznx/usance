import { z } from "zod";
import { hex32Schema, unixSecondsSchema } from "./primitives";
import { authorityAtLeast, triggerAuthoritySchema } from "./sentinel-triggers";

/**
 * A SentinelObservation is a low-authority input — a news reading, an AI classification, a piece of
 * market or issuer metadata. It is provenance-stamped and it is never an authority: it may inform
 * *whether to compile a plan*, and it feeds no contract (`docs/SENTINELS_ARCHITECTURE.md §12`).
 *
 * The schema pins that: an observation's authority is capped at EVIDENCE_BOUND, so it can never
 * claim to be a deterministic onchain read or a verified external event. A strong occurrence like a
 * confirmed corporate action is a `TriggerEvent` at VERIFIED_EXTERNAL, not an observation — the two
 * are kept apart on purpose (I-66, I-74).
 */
export const OBSERVATION_SOURCE_CLASSES = [
  "NEWS_ARTICLE",
  "AI_READING",
  "MARKET_DATA",
  "ISSUER_METADATA",
  "CORPORATE_ACTION_FEED",
] as const;
export type ObservationSourceClass = (typeof OBSERVATION_SOURCE_CLASSES)[number];

export const sentinelObservationSchema = z
  .object({
    source: z.string().min(1).max(200),
    sourceClass: z.enum(OBSERVATION_SOURCE_CLASSES),
    authority: triggerAuthoritySchema,
    retrievedAt: unixSecondsSchema,
    contentHash: hex32Schema,
    observationType: z.string().min(1).max(64),
    detail: z.string().max(2_000).optional(),
  })
  .strict()
  .superRefine((o, ctx) => {
    // Weaker-or-equal to EVIDENCE_BOUND. An observation cannot promote itself to a deterministic or
    // verified-external authority by asserting one — that is precisely the lie this guard refuses.
    if (authorityAtLeast(o.authority, "EVIDENCE_BOUND") && o.authority !== "EVIDENCE_BOUND")
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["authority"],
        message: "an observation's authority cannot exceed EVIDENCE_BOUND",
      });
  });

export type SentinelObservation = z.infer<typeof sentinelObservationSchema>;

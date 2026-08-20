import { z } from "zod";
import { bpsSchema, unixSecondsSchema } from "./primitives";
import { triggerAuthoritySchema, triggerSpecSchema } from "./sentinel-triggers";
import { mandateActionNameSchema } from "./mandate-actions";
import { confirmationPolicySchema } from "./sentinel-instance";
import { usd18StringSchema } from "./sentinel-run";

/**
 * The natural-language creation intermediate. A model turns a user's sentence into a `SentinelDraft`
 * and nothing else — the draft is a proposal, never an execution, and the user reviews every field
 * before signing a mandate (`docs/SENTINELS_ARCHITECTURE.md §11`).
 *
 * The schema is `.strict()`, and that is the security property, not a nicety: a field the schema
 * does not name is a parse failure, so a model cannot hide a permission, widen a cap under a
 * different key, or smuggle a recipient. There is deliberately no LTV, leverage or risk-parameter
 * field here — a model may propose the caps a user sees, never the risk maths the protocol owns.
 */
export const sentinelDraftSchema = z
  .object({
    goal: z.string().min(1).max(2_000),
    /** Candidate asset references the editor resolves against admitted assets; not authority. */
    assets: z.array(z.string().min(1).max(64)).max(32).default([]),
    triggerConditions: z.array(triggerSpecSchema).min(1).max(16),
    targetState: z
      .object({ targetBufferBps: bpsSchema.optional(), note: z.string().max(500).optional() })
      .strict()
      .optional(),
    allowedActions: z.array(mandateActionNameSchema).min(1).max(6),
    maxPerRunNotionalUsd18: usd18StringSchema,
    dailyNotionalCapUsd18: usd18StringSchema,
    totalNotionalCapUsd18: usd18StringSchema.optional(),
    maxCostUsd18: usd18StringSchema.optional(),
    maxSlippageBps: bpsSchema.optional(),
    minimumSafetyBufferBps: bpsSchema.optional(),
    cooldownSeconds: z.number().int().min(0),
    activeWindow: z.object({ start: unixSecondsSchema, end: unixSecondsSchema }).strict().optional(),
    expiresAt: unixSecondsSchema,
    allowedVenues: z.array(z.string().min(1).max(64)).max(16).default([]),
    allowedTriggerAuthorityClasses: z.array(triggerAuthoritySchema).min(1).max(6),
    confirmationPolicy: confirmationPolicySchema,
  })
  .strict()
  .superRefine((d, ctx) => {
    if (d.activeWindow && d.activeWindow.end <= d.activeWindow.start)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["activeWindow", "end"],
        message: "activeWindow.end must be after start",
      });
  });

export type SentinelDraft = z.infer<typeof sentinelDraftSchema>;

import { z } from "zod";
import { hex32Schema } from "./primitives";
import { caip2Schema } from "./instrument";

/**
 * Zod validation for a `CorporateActionSnapshot` — `spec/corporate-action-model.md §3`.
 *
 * The pure reference model (`@usance/corp-actions`) defines the matching TypeScript interface and
 * the deterministic operations. This schema is the boundary check for a snapshot that arrives from
 * an adapter or an artifact. `packages/schemas/test/corporate-action.test.ts` asserts the two
 * agree.
 */

export const ACCOUNTING_MODE_VALUES = [
  "FIXED_UNIT",
  "EXTERNALLY_SCALED",
  "REBASING_BALANCE",
  "SHARE_BASED_CUSTODY",
  "EXTERNALLY_MANAGED",
] as const;

export const priceConventionSchema = z.enum(["FACTOR_IN_PRICE", "FACTOR_IN_QUANTITY", "FACTOR_ABSENT"]);
export type PriceConvention = z.infer<typeof priceConventionSchema>;

export const feedStatusSchema = z.enum(["LIVE", "PAUSED_FOR_ACTION", "STALE", "UNKNOWN"]);
export type FeedStatus = z.infer<typeof feedStatusSchema>;

export const corporateActionSupportSchema = z.enum([
  "VERIFIED_SUPPORTED",
  "TESTED_SUPPORTED",
  "RESTRICTED",
  "UNKNOWN",
  "UNSUPPORTED",
]);
export type CorporateActionSupport = z.infer<typeof corporateActionSupportSchema>;

const wad = z.string().regex(/^[0-9]+$/, "a WAD-scaled integer as a decimal string");

export const corporateActionSnapshotSchema = z
  .object({
    instrumentId: hex32Schema,
    accountingMode: z.enum(ACCOUNTING_MODE_VALUES),
    accountingModeVersion: z.number().int().min(1),
    factorWad: wad,
    pendingFactorWad: wad.nullable(),
    pendingActivationAt: z.number().int().min(0).nullable(),
    sourceDomain: caip2Schema,
    sourceBlock: z.number().int().min(0),
    sourceEvent: z.string().nullable(),
    priceConvention: priceConventionSchema,
    feedStatus: feedStatusSchema,
    adapterVersion: z.string().min(1),
    support: corporateActionSupportSchema,
    observedAt: z.number().int().min(0),
  })
  .strict()
  .superRefine((s, ctx) => {
    if (s.accountingMode === "FIXED_UNIT") {
      if (s.factorWad !== "1000000000000000000") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["factorWad"],
          message: "FIXED_UNIT must carry factorWad == 1e18",
        });
      }
      if (s.priceConvention !== "FACTOR_ABSENT") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["priceConvention"],
          message: "FIXED_UNIT must be FACTOR_ABSENT",
        });
      }
    }
    if (s.pendingFactorWad !== null && s.pendingActivationAt === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["pendingActivationAt"],
        message: "a pending factor must carry an activation time/block",
      });
    }
    if (s.support === "UNSUPPORTED" && s.feedStatus === "LIVE") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["feedStatus"],
        message: "an UNSUPPORTED family cannot present a LIVE corporate-action feed",
      });
    }
  });

export type CorporateActionSnapshotRecord = z.infer<typeof corporateActionSnapshotSchema>;

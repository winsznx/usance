import { z } from "zod";
import { keccak256, toHex } from "viem";
import { hex32Schema, type Hex32 } from "./primitives";
import { caip2Schema } from "./instrument";
import { marketSessionSchema } from "./sentinel-market";

/**
 * Portfolio-risk policy, group metadata and snapshot schemas — `spec/portfolio-risk-model.md §6, §7`.
 *
 * The pure reference model (`@usance/portfolio-risk`) carries the matching TypeScript interfaces
 * and the deterministic formula. This module is the boundary check and the snapshot digest.
 */

export const RISK_DIMENSIONS = ["UNDERLYING", "ISSUER", "CUSTODY", "SECTOR", "LIQUIDITY"] as const;
export const riskDimensionSchema = z.enum(RISK_DIMENSIONS);
export type RiskDimension = z.infer<typeof riskDimensionSchema>;

const bps = z.string().regex(/^[0-9]+$/, "a bps value as a decimal string");

/** A versioned classification a position carries for one dimension. */
export const riskGroupRefSchema = z
  .object({
    dimension: riskDimensionSchema,
    groupId: z.string().min(1),
    taxonomy: z.string().min(1),
    taxonomyVersion: z.string().min(1),
    source: z.string().min(1),
    effectiveAt: z.number().int().min(0),
    reviewBy: z.number().int().min(0).nullable().optional(),
  })
  .strict();
export type RiskGroupRef = z.infer<typeof riskGroupRefSchema>;

const capPairSchema = z
  .object({ NAMED: bps, UNKNOWN: bps })
  .strict()
  .refine((c) => BigInt(c.UNKNOWN) <= BigInt(c.NAMED), {
    message: "UNKNOWN cap must be ≤ NAMED cap — ignorance cannot beat knowledge",
  })
  .refine((c) => BigInt(c.NAMED) <= 10_000n, { message: "cap over 100%" });

export const portfolioRiskPolicySchema = z
  .object({
    policyId: z.string().min(1),
    version: z.number().int().min(1),
    taxonomyVersion: z.string().min(1),
    capBps: z
      .object({
        UNDERLYING: capPairSchema,
        ISSUER: capPairSchema,
        CUSTODY: capPairSchema,
        SECTOR: capPairSchema,
        LIQUIDITY: capPairSchema,
      })
      .strict(),
    sessionFactorBps: z
      .object({
        OPEN: bps,
        PRE_MARKET: bps,
        POST_MARKET: bps,
        CLOSED: bps,
        UNKNOWN: bps,
      })
      .strict()
      .refine((s) => Object.values(s).every((v) => BigInt(v) <= 10_000n), {
        message: "a session factor cannot exceed 100%",
      }),
    stressScenarios: z
      .array(
        z
          .object({
            id: z.string().min(1),
            haircutBps: bps,
            appliesToGroupIds: z.array(z.string()),
            appliesToSessions: z.array(marketSessionSchema),
          })
          .strict(),
      )
      .default([]),
    maxCollateralInstruments: z.number().int().min(1).max(256),
    maxStressScenarios: z.number().int().min(0).max(64),
    effectiveAt: z.number().int().min(0),
    reviewBy: z.number().int().min(0).nullable().optional(),
  })
  .strict()
  .superRefine((p, ctx) => {
    if (p.stressScenarios.length > p.maxStressScenarios) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["stressScenarios"],
        message: "more stress scenarios than the policy's own bound",
      });
    }
  });
export type PortfolioRiskPolicyRecord = z.infer<typeof portfolioRiskPolicySchema>;

export const portfolioSnapshotPositionSchema = z
  .object({
    instrumentId: hex32Schema,
    legacyAssetId: hex32Schema.nullable().optional(),
    effectiveCreditedQuantity: z.string().regex(/^[0-9]+$/),
    singleRecognizedUsd18: z.string().regex(/^[0-9]+$/),
    passportVersion: z.number().int().min(0),
    corporateActionSnapshotDigest: z.string().nullable(),
    oracleRoundId: z.string().nullable(),
    marketSession: marketSessionSchema,
    liquidityObservationVersion: z.string().nullable(),
    riskGroupRefs: z.array(riskGroupRefSchema),
  })
  .strict();

export const portfolioRiskSnapshotSchema = z
  .object({
    facilityId: hex32Schema.nullable(),
    accountId: hex32Schema.nullable(),
    homeDomain: caip2Schema,
    positions: z.array(portfolioSnapshotPositionSchema),
    portfolioPolicyVersion: z.number().int().min(1),
    sourceBlock: z.number().int().min(0),
    finality: z.enum(["safe", "stale", "unknown"]),
    riskEpoch: z.number().int().min(0),
    digest: hex32Schema,
  })
  .strict()
  .superRefine((s, ctx) => {
    if (s.facilityId === null && s.accountId === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["facilityId"],
        message: "a portfolio snapshot must name a facility or an account",
      });
    }
  });
export type PortfolioRiskSnapshotRecord = z.infer<typeof portfolioRiskSnapshotSchema>;

/** Hash the reference model's `canonicalInput` string into a `bytes32` snapshot digest. */
export function portfolioSnapshotDigest(canonicalInput: string): Hex32 {
  return keccak256(toHex(canonicalInput));
}

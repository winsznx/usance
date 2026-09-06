/**
 * Portfolio-risk reference model — types.
 *
 * Provider-neutral, dependency-free, fixed-point only, like `packages/domain` and
 * `packages/corp-actions`. `spec/portfolio-risk-model.md`.
 */

export const WAD = 1_000_000_000_000_000_000n;
export const BPS = 10_000n;

/** The capacity dimensions. INSTRUMENT concentration is upstream (RiskMath §4.6), not here. */
export const DIMENSIONS = ["UNDERLYING", "ISSUER", "CUSTODY", "SECTOR", "LIQUIDITY"] as const;
export type Dimension = (typeof DIMENSIONS)[number];

export const MARKET_SESSIONS = ["OPEN", "PRE_MARKET", "POST_MARKET", "CLOSED", "UNKNOWN"] as const;
export type MarketSession = (typeof MARKET_SESSIONS)[number];

export type GroupKind = "NAMED" | "UNKNOWN";

/** A versioned classification a position carries for one dimension. */
export interface RiskGroupRef {
  dimension: Dimension;
  /** "" or absent → the UNKNOWN group for this dimension. */
  groupId: string;
  taxonomy: string;
  taxonomyVersion: string;
  source: string;
  effectiveAt: number;
  reviewBy?: number | null;
}

export interface PortfolioPosition {
  instrumentId: string;
  legacyAssetId?: string | null;
  homeDomain: string;
  /** RiskResult.cappedUsd18 — the single-instrument recognised value, already concentration-capped. */
  singleRecognizedUsd18: bigint;
  marketValueUsd18: bigint;
  marketSession: MarketSession;
  /** groupId per dimension. Absent or null → UNKNOWN group for that dimension. */
  groups: Partial<Record<Dimension, string | null>>;
  /** Observed executable depth for this position's LIQUIDITY group, usd18. Absent → 0 (restrictive). */
  liquidityDepthUsd18?: bigint | null;
}

export interface StressScenario {
  id: string;
  haircutBps: bigint;
  /** group ids (any dimension) and/or market sessions this scenario hits. */
  appliesToGroupIds: string[];
  appliesToSessions: MarketSession[];
}

export interface PortfolioRiskPolicy {
  policyId: string;
  version: number;
  taxonomyVersion: string;
  /** capBps[dimension][NAMED|UNKNOWN]; UNKNOWN ≤ NAMED is required. */
  capBps: Record<Dimension, Record<GroupKind, bigint>>;
  /** session factor in bps of the recognised value; ≤ BPS. */
  sessionFactorBps: Record<MarketSession, bigint>;
  stressScenarios: StressScenario[];
  maxCollateralInstruments: number;
  maxStressScenarios: number;
}

export type BindingKind = Dimension | "SESSION" | "STRESS" | "NONE";

export interface PositionResult {
  instrumentId: string;
  singleRecognizedUsd18: bigint;
  workingUsd18: bigint;
  positionScaleWad: bigint;
  bindingDimension: Dimension | "SESSION" | "NONE";
  bindingGroup: string | null;
}

export interface ConstraintReduction {
  kind: BindingKind;
  standaloneReductionUsd18: bigint;
  bindingGroups: string[];
}

export interface PortfolioResult {
  portfolioMarketValueUsd18: bigint;
  singleAssetRecognizedTotalUsd18: bigint;
  portfolioRecognizedValueUsd18: bigint;
  positions: PositionResult[];
  constraintBreakdown: ConstraintReduction[];
  bindingConstraint: BindingKind;
  policyVersion: number;
  /** Deterministic canonical encoding of the inputs, for the caller to hash into a snapshot digest. */
  canonicalInput: string;
}

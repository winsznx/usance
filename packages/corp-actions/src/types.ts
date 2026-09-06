/**
 * Corporate-action reference model — types.
 *
 * Provider-neutral. No zod, no dependencies: this is one of the pieces that must stay
 * transcribable into another language, like `packages/domain`. The zod validation of a
 * `CorporateActionSnapshot` lives in `@usance/schemas`; the two agree by a shared test.
 *
 * `spec/corporate-action-model.md`.
 */

export const WAD = 1_000_000_000_000_000_000n; // 1e18

export type AccountingMode =
  | "FIXED_UNIT"
  | "EXTERNALLY_SCALED"
  | "REBASING_BALANCE"
  | "SHARE_BASED_CUSTODY"
  | "EXTERNALLY_MANAGED";

/** Which side of `price × quantity` carries the corporate-action factor. */
export type PriceConvention = "FACTOR_IN_PRICE" | "FACTOR_IN_QUANTITY" | "FACTOR_ABSENT";

export type FeedStatus = "LIVE" | "PAUSED_FOR_ACTION" | "STALE" | "UNKNOWN";

export type SupportStatus =
  | "VERIFIED_SUPPORTED"
  | "TESTED_SUPPORTED"
  | "RESTRICTED"
  | "UNKNOWN"
  | "UNSUPPORTED";

/**
 * Everything a quote or a RiskEpoch needs to reproduce a corporate-action-dependent number.
 * An adapter never returns a bare current factor without this envelope.
 */
export interface CorporateActionSnapshot {
  instrumentId: string;
  accountingMode: AccountingMode;
  accountingModeVersion: number;
  /** WAD-scaled. 1e18 is neutral. FIXED_UNIT must be exactly 1e18. */
  factorWad: bigint;
  /** A scheduled/announced future factor (B20 ERC-8056, xStocks pre-published), or null. */
  pendingFactorWad: bigint | null;
  /** Unix seconds or block number (caller-consistent) at which `pendingFactorWad` becomes authoritative. */
  pendingActivationAt: number | null;
  sourceDomain: string;
  sourceBlock: number;
  sourceEvent: string | null;
  priceConvention: PriceConvention;
  feedStatus: FeedStatus;
  adapterVersion: string;
  support: SupportStatus;
  observedAt: number;
}

/** The effective factor to use now, plus whether the state forces new risk to be restricted. */
export interface EffectiveFactor {
  factorWad: bigint;
  restrictNewRisk: boolean;
  reason: string | null;
}

/** A Usance share pool for `SHARE_BASED_CUSTODY` — the additive V2 custody model (spec §8). */
export interface SharePool {
  totalShares: bigint;
  /** The custodied token balance the pool currently reflects. */
  tokenBalance: bigint;
}

export type ActionKind = "DEPOSIT" | "WITHDRAW" | "REBASE" | "LIQUIDATION_SEIZE" | "FEE";

export interface Action {
  kind: ActionKind;
  /** DEPOSIT/WITHDRAW/LIQUIDATION_SEIZE/FEE: a raw token amount. REBASE: the new absolute token balance. */
  value: bigint;
  /** The account this action attributes to. Absent for a REBASE (it is not attributable). */
  account?: string;
  /** Provenance for a REBASE: the announcement/update event id. Absent = unprovenanced. */
  provenance?: string;
}

export type EffectKind =
  | "SHARES_MINTED"
  | "SHARES_BURNED"
  | "REBASE_OBSERVED"
  | "UNATTRIBUTED_SURPLUS"
  | "FEE_TAKEN";

export interface ActionEffect {
  kind: EffectKind;
  account: string | null;
  shares: bigint;
  rawDelta: bigint;
  /** Implied factor move for a REBASE_OBSERVED, WAD-scaled, or null. */
  impliedFactorWad: bigint | null;
  note: string;
}

/**
 * The Usance risk pipeline, in TypeScript.
 *
 * This exists so the browser can preview a value without a round trip. It has **no authority**.
 * Every number it produces must be reproducible by `contracts/src/libraries/RiskMath.sol`, and
 * `make test-differential` proves that on the canonical fixture set — a one-wei disagreement is
 * a failing build, not a rounding difference.
 *
 * All money is `bigint`. `number` is used only for basis points and timestamps, which are small
 * integers by construction. There is no float arithmetic anywhere in this file.
 *
 * Mirrors spec/accounting.md §1 through §6.
 */

export const BPS = 10_000n;
export const WAD = 10n ** 18n;
export const USD = 10n ** 18n;
export const SECONDS_PER_YEAR = 31_536_000n;
export const UINT256_MAX = 2n ** 256n - 1n;

export const ACCOUNT_STATUS = [
  "NORMAL",
  "NO_NEW_RISK",
  "REDUCE_ONLY",
  "MARGIN_CALL",
  "LIQUIDATING",
  "SETTLED",
  "BAD_DEBT",
] as const;
export type AccountStatus = (typeof ACCOUNT_STATUS)[number];

export type PassportStatus = "NONE" | "ACTIVE" | "STALE" | "CONFLICTED" | "SUSPENDED" | "REVOKED";
export type AssetStatus = "UNREGISTERED" | "ACTIVE" | "PAUSED" | "SUSPENDED" | "RETIRED";

export type Gate =
  | "ORACLE_STALE"
  | "ORACLE_INVALID"
  | "PASSPORT_STALE"
  | "CLAIM_CONFLICT"
  | "ASSET_SUSPENDED"
  | "SEQUENCER_DOWN"
  | "SEQUENCER_GRACE";

// ---------------------------------------------------------------------------------------------
// §1.2 Rounding
// ---------------------------------------------------------------------------------------------

/** Round-down multiply-divide. BigInt is arbitrary precision, so no intermediate can overflow. */
export function mulDiv(a: bigint, b: bigint, d: bigint): bigint {
  if (d === 0n) throw new RangeError("mulDiv: zero denominator");
  if (a < 0n || b < 0n) throw new RangeError("mulDiv: negative input");
  return (a * b) / d;
}

/** Round-up multiply-divide. Every quantity the user owes uses this. */
export function mulDivUp(a: bigint, b: bigint, d: bigint): bigint {
  if (d === 0n) throw new RangeError("mulDivUp: zero denominator");
  if (a === 0n || b === 0n) return 0n;
  return (a * b - 1n) / d + 1n;
}

function statusMax(...s: AccountStatus[]): AccountStatus {
  const i = Math.max(...s.map((x) => ACCOUNT_STATUS.indexOf(x)));
  return ACCOUNT_STATUS[i] as AccountStatus;
}

// ---------------------------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------------------------

export interface ExitTier {
  thresholdUsd18: bigint;
  recoveryBps: number;
}

export interface RiskParameters {
  initialLtvBps: number;
  maintenanceLtvBps: number;
  liquidationLtvBps: number;
  maxConcentrationBps: number;
  haircutMarketBps: number;
  haircutLiquidityBps: number;
  haircutIssuerBps: number;
  haircutSettlementBps: number;
  haircutCrosschainBps: number;
  maxOracleAge: number;
  maxPassportAge: number;
}

export interface AssetRiskInput {
  assetId: string;
  symbol?: string;
  quantity: bigint;
  decimals: number;
  priceUsd18: bigint;
  priceUpdatedAt: number;
  passportCommittedAt: number;
  passportStatus: PassportStatus;
  redemptionSupported: boolean;
  redemptionFloorBps: number;
  assetStatus: AssetStatus;
  params: RiskParameters;
  exitCurve: ExitTier[];
}

export interface AccountInput {
  scaledPrincipal: bigint;
  borrowIndex: bigint;
  reservedUsd18: bigint;
  statusOverride: AccountStatus;
}

export interface SequencerInput {
  up: boolean;
  lastRestartAt: number;
  gracePeriod: number;
}

export interface AssetValuation {
  assetId: string;
  marketValueUsd18: bigint;
  haircutMarkUsd18: bigint;
  stressedExitUsd18: bigint;
  redemptionFloorUsd18: bigint | null;
  recognizedUsd18: bigint;
  cappedUsd18: bigint;
}

export interface RiskResult {
  perAsset: AssetValuation[];
  totalRecognizedUsd18: bigint;
  borrowLimitUsd18: bigint;
  maintenanceLimitUsd18: bigint;
  liquidationLimitUsd18: bigint;
  debtUsd18: bigint;
  availableBorrowUsd18: bigint;
  healthFactorWad: bigint;
  status: AccountStatus;
  gates: Gate[];
}

// ---------------------------------------------------------------------------------------------
// §4 Valuation
// ---------------------------------------------------------------------------------------------

/** §4.3 First tier at or above the position; past the end, the worst tier. */
export function selectRecoveryBps(curve: ExitTier[], marketValue: bigint): number {
  if (curve.length === 0) throw new RangeError("exit curve is empty");
  for (const tier of curve) {
    if (marketValue <= tier.thresholdUsd18) return tier.recoveryBps;
  }
  return curve[curve.length - 1]!.recoveryBps;
}

export function valueAsset(a: AssetRiskInput): AssetValuation {
  // §4.1
  const marketValueUsd18 = mulDiv(a.quantity, a.priceUsd18, 10n ** BigInt(a.decimals));

  // §4.2 — fixed order, each step floors
  let m = marketValueUsd18;
  for (const h of [
    a.params.haircutMarketBps,
    a.params.haircutLiquidityBps,
    a.params.haircutIssuerBps,
    a.params.haircutSettlementBps,
    a.params.haircutCrosschainBps,
  ]) {
    m = mulDiv(m, BPS - BigInt(h), BPS);
  }

  // §4.3
  const stressedExitUsd18 = mulDiv(
    marketValueUsd18,
    BigInt(selectRecoveryBps(a.exitCurve, marketValueUsd18)),
    BPS,
  );

  // §4.4 / §4.5
  const candidates = [m, stressedExitUsd18];
  let redemptionFloorUsd18: bigint | null = null;
  if (a.redemptionSupported) {
    redemptionFloorUsd18 = mulDiv(marketValueUsd18, BigInt(a.redemptionFloorBps), BPS);
    candidates.push(redemptionFloorUsd18);
  }

  return {
    assetId: a.assetId,
    marketValueUsd18,
    haircutMarkUsd18: m,
    stressedExitUsd18,
    redemptionFloorUsd18,
    recognizedUsd18: candidates.reduce((x, y) => (x < y ? x : y)),
    cappedUsd18: 0n,
  };
}

function assetGates(a: AssetRiskInput, now: number): Gate[] {
  if (a.quantity === 0n) return [];
  const g: Gate[] = [];
  if (now - a.priceUpdatedAt > a.params.maxOracleAge) g.push("ORACLE_STALE");
  if (a.priceUsd18 <= 0n) g.push("ORACLE_INVALID");
  if (now - a.passportCommittedAt > a.params.maxPassportAge) g.push("PASSPORT_STALE");
  if (a.passportStatus === "CONFLICTED") g.push("CLAIM_CONFLICT");
  if (a.passportStatus === "SUSPENDED" || a.assetStatus === "SUSPENDED") g.push("ASSET_SUSPENDED");
  return g;
}

// ---------------------------------------------------------------------------------------------
// §4.6 + §5 Portfolio
// ---------------------------------------------------------------------------------------------

export function evaluate(
  assets: AssetRiskInput[],
  account: AccountInput,
  seq: SequencerInput,
  now: number,
): RiskResult {
  // Truncated sums are order-dependent, so ordering is checked rather than assumed.
  for (let i = 1; i < assets.length; i++) {
    if (BigInt(assets[i]!.assetId) <= BigInt(assets[i - 1]!.assetId)) {
      throw new RangeError("assets must be sorted ascending by assetId");
    }
  }

  const gates = new Set<Gate>();
  if (!seq.up) gates.add("SEQUENCER_DOWN");
  else if (now - seq.lastRestartAt < seq.gracePeriod) gates.add("SEQUENCER_GRACE");

  const perAsset = assets.map((a) => {
    for (const g of assetGates(a, now)) gates.add(g);
    return valueAsset(a);
  });

  // §4.6 single pass against the uncapped total
  const rawTotal = perAsset.reduce((s, v) => s + v.recognizedUsd18, 0n);

  let totalRecognizedUsd18 = 0n;
  let borrowLimitUsd18 = 0n;
  let maintenanceLimitUsd18 = 0n;
  let liquidationLimitUsd18 = 0n;

  perAsset.forEach((v, i) => {
    const p = assets[i]!.params;
    const cap = mulDiv(rawTotal, BigInt(p.maxConcentrationBps), BPS);
    v.cappedUsd18 = v.recognizedUsd18 < cap ? v.recognizedUsd18 : cap;

    totalRecognizedUsd18 += v.cappedUsd18;
    borrowLimitUsd18 += mulDiv(v.cappedUsd18, BigInt(p.initialLtvBps), BPS);
    maintenanceLimitUsd18 += mulDiv(v.cappedUsd18, BigInt(p.maintenanceLtvBps), BPS);
    liquidationLimitUsd18 += mulDiv(v.cappedUsd18, BigInt(p.liquidationLtvBps), BPS);
  });

  // §3.1
  const debtUsd18 = mulDivUp(account.scaledPrincipal, account.borrowIndex, WAD);

  // §5.1
  let base: AccountStatus;
  if (debtUsd18 === 0n || debtUsd18 <= borrowLimitUsd18) base = "NORMAL";
  else if (debtUsd18 <= maintenanceLimitUsd18) base = "NO_NEW_RISK";
  else if (debtUsd18 <= liquidationLimitUsd18) base = "REDUCE_ONLY";
  else base = "MARGIN_CALL";

  const gateFloor: AccountStatus = gates.size > 0 ? "NO_NEW_RISK" : "NORMAL";
  const status = statusMax(base, gateFloor, account.statusOverride);

  let availableBorrowUsd18 = 0n;
  if (status === "NORMAL") {
    const used = debtUsd18 + account.reservedUsd18;
    availableBorrowUsd18 = borrowLimitUsd18 > used ? borrowLimitUsd18 - used : 0n;
  }

  const healthFactorWad =
    debtUsd18 === 0n ? UINT256_MAX : mulDiv(maintenanceLimitUsd18, WAD, debtUsd18);

  return {
    perAsset,
    totalRecognizedUsd18,
    borrowLimitUsd18,
    maintenanceLimitUsd18,
    liquidationLimitUsd18,
    debtUsd18,
    availableBorrowUsd18,
    healthFactorWad,
    status,
    gates: [...gates].sort(),
  };
}

// ---------------------------------------------------------------------------------------------
// §6 Interest
// ---------------------------------------------------------------------------------------------

export function borrowRateBps(
  cash: bigint,
  borrows: bigint,
  base: number,
  slope1: number,
  slope2: number,
  kink: number,
): bigint {
  if (borrows === 0n) return BigInt(base);
  const u = mulDiv(borrows, BPS, cash + borrows);
  if (u <= BigInt(kink)) return BigInt(base) + mulDiv(u, BigInt(slope1), BigInt(kink));
  return (
    BigInt(base) + BigInt(slope1) + mulDiv(u - BigInt(kink), BigInt(slope2), BPS - BigInt(kink))
  );
}

export function accrueIndex(index: bigint, rateBps: bigint, dt: bigint): bigint {
  if (dt === 0n || rateBps === 0n) return index;
  return index + mulDiv(index, rateBps * dt, BPS * SECONDS_PER_YEAR);
}

// ---------------------------------------------------------------------------------------------
// Presentation
// ---------------------------------------------------------------------------------------------

/**
 * Format a usd18 amount for display.
 *
 * Deliberately not `Number(x) / 1e18`: that loses precision above 2^53 and would let the UI
 * show a number the contract disagrees with. String arithmetic keeps every digit.
 */
export function formatUsd(usd18: bigint, decimals = 2): string {
  const neg = usd18 < 0n;
  const v = neg ? -usd18 : usd18;
  const whole = v / USD;
  const frac = v % USD;
  const fracStr = frac.toString().padStart(18, "0").slice(0, decimals);
  const wholeStr = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${neg ? "-" : ""}${wholeStr}${decimals > 0 ? `.${fracStr}` : ""}`;
}

export function formatTokens(raw: bigint, decimals: number, displayDecimals = 4): string {
  const unit = 10n ** BigInt(decimals);
  const whole = raw / unit;
  const frac = raw % unit;
  const fracStr = frac.toString().padStart(decimals, "0").slice(0, displayDecimals);
  const wholeStr = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return displayDecimals > 0 ? `${wholeStr}.${fracStr}` : wholeStr;
}

export function parseUsd(input: string): bigint {
  const cleaned = input.replace(/,/g, "").trim();
  if (!/^\d*(\.\d*)?$/.test(cleaned) || cleaned === "" || cleaned === ".") return 0n;
  const [w = "0", f = ""] = cleaned.split(".");
  return BigInt(w) * USD + BigInt(f.padEnd(18, "0").slice(0, 18));
}

/** Health factor as a display string. `∞` when there is no debt. */
export function formatHealth(healthFactorWad: bigint): string {
  if (healthFactorWad === UINT256_MAX) return "∞";
  return formatUsd(healthFactorWad, 2);
}

/**
 * Plain-language reason that recognised value is below market value.
 *
 * The asset page's "Why is this lower?" is the moment a user learns the protocol is doing
 * something real, so the explanation names the binding constraint rather than listing all of them.
 */
export function explainHaircut(v: AssetValuation): string {
  if (v.marketValueUsd18 === 0n) return "No market value.";
  if (v.recognizedUsd18 === v.stressedExitUsd18 && v.stressedExitUsd18 < v.haircutMarkUsd18) {
    return "Limited by what this position could actually be sold for at this size.";
  }
  if (
    v.redemptionFloorUsd18 !== null &&
    v.recognizedUsd18 === v.redemptionFloorUsd18 &&
    v.redemptionFloorUsd18 < v.haircutMarkUsd18
  ) {
    return "Limited by what the issuer's redemption terms currently guarantee.";
  }
  return "Reduced by volatility, liquidity, issuer and settlement buffers.";
}

export const GATE_COPY: Record<Gate, { title: string; body: string; repair: string }> = {
  ORACLE_STALE: {
    title: "Price feed is stale",
    body: "New borrowing is paused because the market price for one of your assets has not updated recently.",
    repair: "You can still repay, add collateral, or reduce exposure.",
  },
  ORACLE_INVALID: {
    title: "No valid price",
    body: "The price source for one of your assets is not returning a usable value.",
    repair: "You can still repay, add collateral, or reduce exposure.",
  },
  PASSPORT_STALE: {
    title: "Issuer information needs refreshing",
    body: "The evidence behind one of your assets is older than policy allows, so it cannot support new borrowing.",
    repair: "Review the evidence, or repay to free up room.",
  },
  CLAIM_CONFLICT: {
    title: "Conflicting evidence",
    body: "Two independent readings of the issuer's documents disagree. Usance will not increase your limits while that is unresolved.",
    repair: "View the conflict, or continue using your existing position.",
  },
  ASSET_SUSPENDED: {
    title: "Asset suspended",
    body: "One of your assets has been suspended. Your balance is unaffected, but it cannot support new risk.",
    repair: "Repay or withdraw as normal.",
  },
  SEQUENCER_DOWN: {
    title: "Network sequencer is down",
    body: "X Layer is not currently sequencing, so prices cannot be trusted for new lending decisions.",
    repair: "Existing positions are unaffected. Try again once the network recovers.",
  },
  SEQUENCER_GRACE: {
    title: "Network recently recovered",
    body: "X Layer restarted recently. Usance waits a short period before trusting prices again.",
    repair: "New borrowing resumes automatically.",
  },
};

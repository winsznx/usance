import { WAD, type CorporateActionSnapshot, type EffectiveFactor } from "./types";

/**
 * Quantity conversions — `spec/corporate-action-model.md §1, §4, §5, §9`.
 *
 * Every conversion rounds DOWN (toward less recognised value / less that a holder can withdraw).
 * A conversion must never increase borrowing capacity or let a holder pull out more economic
 * ownership than their claim.
 */

export function mulDivDown(a: bigint, b: bigint, d: bigint): bigint {
  if (d === 0n) throw new Error("mulDivDown: division by zero");
  return (a * b) / d;
}

/**
 * The factor to apply now, and whether the state forces new risk to be restricted (§9).
 *
 * - `UNSUPPORTED` throws — it must not be reachable in a valuation path.
 * - `UNKNOWN` support, or a paused / stale / unknown feed, restricts.
 * - Inside an activation window (a pending factor that has not activated yet), capacity uses the
 *   MORE CONSERVATIVE of `{factorWad, pendingFactorWad}` and restricts new risk.
 * - Past `pendingActivationAt` with a pending factor still set, the snapshot is behind the chain:
 *   restrict and signal a re-read.
 */
export function effectiveFactor(snap: CorporateActionSnapshot, now: number): EffectiveFactor {
  if (snap.support === "UNSUPPORTED") {
    throw new Error(`corporate-action support is UNSUPPORTED for ${snap.instrumentId}`);
  }

  if (snap.accountingMode === "FIXED_UNIT") {
    if (snap.factorWad !== WAD) {
      throw new Error("FIXED_UNIT must carry factorWad == 1e18");
    }
    return { factorWad: WAD, restrictNewRisk: false, reason: null };
  }

  let restrict = false;
  const reasons: string[] = [];

  if (snap.support === "UNKNOWN" || snap.support === "RESTRICTED") {
    restrict = true;
    reasons.push(`support is ${snap.support}`);
  }
  if (snap.feedStatus !== "LIVE") {
    restrict = true;
    reasons.push(`feed is ${snap.feedStatus}`);
  }

  let factor = snap.factorWad;
  if (snap.pendingFactorWad !== null) {
    const activated = snap.pendingActivationAt !== null && now >= snap.pendingActivationAt;
    if (activated) {
      restrict = true;
      reasons.push("snapshot predates the pending activation; re-read the factor from chain");
      // The pending factor is authoritative now, but this snapshot was taken before it. Use the
      // more conservative of the two and force a re-read rather than trusting a stale number.
      factor = snap.pendingFactorWad < factor ? snap.pendingFactorWad : factor;
    } else {
      restrict = true;
      reasons.push("a corporate-action factor change is pending");
      factor = snap.pendingFactorWad < factor ? snap.pendingFactorWad : factor;
    }
  }

  return {
    factorWad: factor,
    restrictNewRisk: restrict,
    reason: reasons.length > 0 ? reasons.join("; ") : null,
  };
}

/**
 * Stored quantity → effective economic quantity.
 *
 * - `FIXED_UNIT`: identity.
 * - `EXTERNALLY_SCALED` (B20): `stored` is raw; `effective = raw × factor / WAD` (down).
 * - `REBASING_BALANCE` (xStocks): `stored` is already `balanceOf()` == effective at the *current*
 *   factor. When a more conservative factor applies (pending reverse split, restricted state),
 *   scale it back: `effective = stored × conservativeFactor / factorWad` (down).
 * - `SHARE_BASED_CUSTODY`: not a per-instrument conversion — see `pool.ts`.
 */
export function effectiveQuantity(
  stored: bigint,
  snap: CorporateActionSnapshot,
  now: number,
): { effective: bigint; restrictNewRisk: boolean; reason: string | null } {
  const f = effectiveFactor(snap, now);

  switch (snap.accountingMode) {
    case "FIXED_UNIT":
      return { effective: stored, restrictNewRisk: false, reason: null };

    case "EXTERNALLY_SCALED":
      return {
        effective: mulDivDown(stored, f.factorWad, WAD),
        restrictNewRisk: f.restrictNewRisk,
        reason: f.reason,
      };

    case "REBASING_BALANCE":
      // stored already reflects snap.factorWad. Re-scale to the conservative factor.
      return {
        effective: mulDivDown(stored, f.factorWad, snap.factorWad),
        restrictNewRisk: f.restrictNewRisk,
        reason: f.reason,
      };

    case "SHARE_BASED_CUSTODY":
      throw new Error("SHARE_BASED_CUSTODY effective quantity is a pool computation — use pool.ts");

    case "EXTERNALLY_MANAGED":
      throw new Error("EXTERNALLY_MANAGED accounting is not modelled in Phase 03");
  }
}

/**
 * Economic USD value with the corporate-action factor applied EXACTLY ONCE — invariant I-84.
 *
 * The caller passes the RAW stored quantity and the price; this function branches on
 * `priceConvention` and never applies the factor on both sides.
 *
 * - `FACTOR_ABSENT` / `FACTOR_IN_PRICE`: value from RAW × price (the feed already carries any
 *   factor). Using a scaled quantity here would double-count.
 * - `FACTOR_IN_QUANTITY`: value from EFFECTIVE × price (the feed reports the raw underlying price).
 *
 * `priceUsd18` is USD scaled to 18 decimals per whole token unit; `decimals` is the token's.
 */
export function economicValueUsd18(args: {
  storedRaw: bigint;
  priceUsd18: bigint;
  decimals: number;
  snap: CorporateActionSnapshot;
  now: number;
}): { valueUsd18: bigint; quantityUsed: bigint; basis: "RAW" | "EFFECTIVE"; restrictNewRisk: boolean; reason: string | null } {
  const scale = 10n ** BigInt(args.decimals);

  if (args.snap.priceConvention === "FACTOR_ABSENT" || args.snap.priceConvention === "FACTOR_IN_PRICE") {
    const f = args.snap.accountingMode === "FIXED_UNIT"
      ? { restrictNewRisk: false, reason: null as string | null }
      : effectiveFactor(args.snap, args.now);
    return {
      valueUsd18: mulDivDown(args.storedRaw, args.priceUsd18, scale),
      quantityUsed: args.storedRaw,
      basis: "RAW",
      restrictNewRisk: f.restrictNewRisk,
      reason: f.reason,
    };
  }

  // FACTOR_IN_QUANTITY
  const e = effectiveQuantity(args.storedRaw, args.snap, args.now);
  return {
    valueUsd18: mulDivDown(e.effective, args.priceUsd18, scale),
    quantityUsed: e.effective,
    basis: "EFFECTIVE",
    restrictNewRisk: e.restrictNewRisk,
    reason: e.reason,
  };
}

/**
 * A hand-rolled WRONG computation that applies the factor to BOTH the quantity and a
 * factor-in-price feed. Exported only so the mutation test can show the helper above does not do
 * this and that the wrong path is detectably ~factor× too large.
 */
export function doubleCountedValueUsd18(args: {
  storedRaw: bigint;
  factorInPriceUsd18: bigint;
  decimals: number;
  factorWad: bigint;
}): bigint {
  const scale = 10n ** BigInt(args.decimals);
  const scaledQty = mulDivDown(args.storedRaw, args.factorWad, WAD);
  return mulDivDown(scaledQty, args.factorInPriceUsd18, scale);
}

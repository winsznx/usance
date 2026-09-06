import {
  BPS,
  DIMENSIONS,
  WAD,
  type BindingKind,
  type ConstraintReduction,
  type Dimension,
  type GroupKind,
  type MarketSession,
  type PortfolioPosition,
  type PortfolioResult,
  type PortfolioRiskPolicy,
  type PositionResult,
} from "./types";

export function mulDivDown(a: bigint, b: bigint, d: bigint): bigint {
  if (d === 0n) throw new Error("mulDivDown: division by zero");
  return (a * b) / d;
}
const min = (a: bigint, b: bigint) => (a < b ? a : b);

/**
 * Group key for a position in a dimension.
 *
 * For the concentration dimensions (UNDERLYING / ISSUER / CUSTODY / SECTOR) a missing groupId puts
 * the position in the `UNKNOWN_<d>` group, which the policy caps at `capBps[d].UNKNOWN` (≤ the
 * named cap) — unknown never improves capacity (I-89).
 *
 * LIQUIDITY is a depth constraint on an explicitly-declared shared route, not a shared-fate group.
 * A position with no declared `(route, positive depth)` carries `NONE` here and the LIQUIDITY
 * dimension is a no-op for it. Route metadata is an ADMISSION requirement for a production
 * instrument whose liquidation could compete (`spec/portfolio-risk-model.md §3`), enforced by the
 * admission layer, not by silently zeroing a position here.
 */
function groupKeyOf(pos: PortfolioPosition, d: Dimension): { key: string; kind: GroupKind | "NONE" } {
  const g = pos.groups[d];
  if (d === "LIQUIDITY") {
    const depth = pos.liquidityDepthUsd18;
    if (g === undefined || g === null || g === "" || depth === undefined || depth === null || depth <= 0n) {
      return { key: "NONE", kind: "NONE" };
    }
    return { key: g, kind: "NAMED" };
  }
  if (g === undefined || g === null || g === "") return { key: `UNKNOWN_${d}`, kind: "UNKNOWN" };
  return { key: g, kind: "NAMED" };
}

/** dimScale(i, d) for every position, plus the group each position sat in. */
function dimensionScales(
  positions: PortfolioPosition[],
  base: bigint,
  d: Dimension,
  policy: PortfolioRiskPolicy,
): { scaleWad: bigint[]; groupKey: string[]; overGroups: Set<string> } {
  const totals = new Map<string, bigint>();
  const kinds = new Map<string, GroupKind | "NONE">();
  const depthByGroup = new Map<string, bigint>();
  const key: string[] = [];

  positions.forEach((p, i) => {
    const { key: k, kind } = groupKeyOf(p, d);
    key[i] = k;
    kinds.set(k, kind);
    if (kind === "NONE") return; // LIQUIDITY with no declared (route, depth) — dimension is a no-op
    totals.set(k, (totals.get(k) ?? 0n) + p.singleRecognizedUsd18);
    if (d === "LIQUIDITY") {
      const depth = p.liquidityDepthUsd18!; // groupKeyOf guarantees a positive depth for a NAMED route
      const cur = depthByGroup.get(k);
      depthByGroup.set(k, cur === undefined ? depth : min(cur, depth));
    }
  });

  const scaleWad: bigint[] = [];
  const overGroups = new Set<string>();
  positions.forEach((_p, i) => {
    const k = key[i]!;
    if (kinds.get(k) === "NONE") {
      scaleWad[i] = WAD;
      return;
    }
    const total = totals.get(k)!;
    if (total === 0n) {
      scaleWad[i] = WAD;
      return;
    }
    const capBps = policy.capBps[d][kinds.get(k) as GroupKind];
    let allowed = mulDivDown(base, capBps, BPS);
    if (d === "LIQUIDITY") {
      allowed = min(allowed, depthByGroup.get(k) ?? 0n);
    }
    const s = min(WAD, mulDivDown(allowed, WAD, total));
    scaleWad[i] = s;
    if (s < WAD) overGroups.add(k);
  });

  return { scaleWad, groupKey: key, overGroups };
}

function sessionScaleWad(session: MarketSession, policy: PortfolioRiskPolicy): bigint {
  return mulDivDown(min(BPS, policy.sessionFactorBps[session]), WAD, BPS);
}

/**
 * Evaluate a facility's admitted-collateral portfolio — `spec/portfolio-risk-model.md §4`.
 *
 * `positions` MUST already be the facility's admitted set on its home domain (I-87); this function
 * does not filter. It only ever reduces: `result ≤ Σ singleRecognized` (I-86).
 */
export function evaluatePortfolio(
  rawPositions: readonly PortfolioPosition[],
  policy: PortfolioRiskPolicy,
): PortfolioResult {
  if (rawPositions.length > policy.maxCollateralInstruments) {
    throw new Error(
      `portfolio has ${rawPositions.length} instruments, over the policy bound of ${policy.maxCollateralInstruments}`,
    );
  }
  if (policy.stressScenarios.length > policy.maxStressScenarios) {
    throw new Error("policy defines more stress scenarios than its own bound allows");
  }
  for (const d of DIMENSIONS) {
    if (policy.capBps[d].UNKNOWN > policy.capBps[d].NAMED) {
      throw new Error(`policy ${d}: UNKNOWN cap must be ≤ NAMED cap`);
    }
    if (policy.capBps[d].NAMED > BPS || policy.capBps[d].UNKNOWN < 0n) {
      throw new Error(`policy ${d}: cap out of [0, BPS]`);
    }
  }

  // 0. dedupe by instrumentId
  const byId = new Map<string, PortfolioPosition>();
  for (const p of rawPositions) {
    const existing = byId.get(p.instrumentId);
    if (!existing) {
      byId.set(p.instrumentId, { ...p, groups: { ...p.groups } });
      continue;
    }
    // conflicting metadata for the same instrument is malformed input
    if (
      existing.marketSession !== p.marketSession ||
      existing.homeDomain !== p.homeDomain ||
      JSON.stringify(existing.groups) !== JSON.stringify(p.groups)
    ) {
      throw new Error(`duplicate instrumentId ${p.instrumentId} with conflicting risk metadata`);
    }
    existing.singleRecognizedUsd18 += p.singleRecognizedUsd18;
    existing.marketValueUsd18 += p.marketValueUsd18;
    if ((existing.liquidityDepthUsd18 ?? null) !== (p.liquidityDepthUsd18 ?? null)) {
      existing.liquidityDepthUsd18 = min(existing.liquidityDepthUsd18 ?? 0n, p.liquidityDepthUsd18 ?? 0n);
    }
  }
  const positions = [...byId.values()];

  const base = positions.reduce((s, p) => s + p.singleRecognizedUsd18, 0n);
  const marketValue = positions.reduce((s, p) => s + p.marketValueUsd18, 0n);

  if (base === 0n) {
    return {
      portfolioMarketValueUsd18: marketValue,
      singleAssetRecognizedTotalUsd18: 0n,
      portfolioRecognizedValueUsd18: 0n,
      positions: positions.map((p) => ({
        instrumentId: p.instrumentId,
        singleRecognizedUsd18: 0n,
        workingUsd18: 0n,
        positionScaleWad: WAD,
        bindingDimension: "NONE",
        bindingGroup: null,
      })),
      constraintBreakdown: [],
      bindingConstraint: "NONE",
      policyVersion: policy.version,
      canonicalInput: canonicalEncode(positions, policy),
    };
  }

  // 2. per-dimension scales
  const dimData = new Map<Dimension, ReturnType<typeof dimensionScales>>();
  for (const d of DIMENSIONS) dimData.set(d, dimensionScales(positions, base, d, policy));

  // 4. position scale = min(session, min over dimensions)
  const posResults: PositionResult[] = positions.map((p, i) => {
    let scale = sessionScaleWad(p.marketSession, policy);
    let bindingDimension: PositionResult["bindingDimension"] = scale < WAD ? "SESSION" : "NONE";
    let bindingGroup: string | null = null;
    for (const d of DIMENSIONS) {
      const dd = dimData.get(d)!;
      if (dd.scaleWad[i]! < scale) {
        scale = dd.scaleWad[i]!;
        bindingDimension = d;
        bindingGroup = dd.groupKey[i]!;
      }
    }
    return {
      instrumentId: p.instrumentId,
      singleRecognizedUsd18: p.singleRecognizedUsd18,
      workingUsd18: mulDivDown(p.singleRecognizedUsd18, scale, WAD),
      positionScaleWad: scale,
      bindingDimension,
      bindingGroup,
    };
  });

  let recognized = posResults.reduce((s, r) => s + r.workingUsd18, 0n);

  // 6. stress scenarios
  let worstStressed = recognized;
  for (const s of policy.stressScenarios) {
    const groupSet = new Set(s.appliesToGroupIds);
    const sessionSet = new Set(s.appliesToSessions);
    const stressed = positions.reduce((acc, p, i) => {
      const hit =
        sessionSet.has(p.marketSession) ||
        DIMENSIONS.some((d) => {
          const g = p.groups[d];
          return g != null && g !== "" && groupSet.has(g);
        });
      const w = posResults[i]!.workingUsd18;
      return acc + (hit ? mulDivDown(w, BPS - s.haircutBps, BPS) : w);
    }, 0n);
    if (stressed < worstStressed) worstStressed = stressed;
  }
  recognized = min(recognized, worstStressed);

  // 9. standalone reductions per dimension / session / stress
  const breakdown: ConstraintReduction[] = [];
  for (const d of DIMENSIONS) {
    const dd = dimData.get(d)!;
    const only = positions.reduce(
      (acc, p, i) => acc + mulDivDown(p.singleRecognizedUsd18, min(WAD, dd.scaleWad[i]!), WAD),
      0n,
    );
    breakdown.push({ kind: d, standaloneReductionUsd18: base - only, bindingGroups: [...dd.overGroups] });
  }
  {
    const only = positions.reduce(
      (acc, p) => acc + mulDivDown(p.singleRecognizedUsd18, sessionScaleWad(p.marketSession, policy), WAD),
      0n,
    );
    const groups = [...new Set(positions.filter((p) => policy.sessionFactorBps[p.marketSession] < BPS).map((p) => p.marketSession))];
    breakdown.push({ kind: "SESSION", standaloneReductionUsd18: base - only, bindingGroups: groups });
  }
  breakdown.push({
    kind: "STRESS",
    standaloneReductionUsd18: base - worstStressed < 0n ? 0n : base - worstStressed,
    bindingGroups: policy.stressScenarios.map((s) => s.id),
  });

  let bindingConstraint: BindingKind = "NONE";
  let worst = 0n;
  for (const b of breakdown) {
    if (b.standaloneReductionUsd18 > worst) {
      worst = b.standaloneReductionUsd18;
      bindingConstraint = b.kind;
    }
  }

  return {
    portfolioMarketValueUsd18: marketValue,
    singleAssetRecognizedTotalUsd18: base,
    portfolioRecognizedValueUsd18: recognized,
    positions: posResults,
    constraintBreakdown: breakdown,
    bindingConstraint,
    policyVersion: policy.version,
    canonicalInput: canonicalEncode(positions, policy),
  };
}

/**
 * Deterministic canonical encoding of the evaluation inputs. The caller hashes this into a
 * `PortfolioRiskSnapshot.digest`. Order-independent: positions and groups are sorted.
 */
export function canonicalEncode(
  positions: readonly PortfolioPosition[],
  policy: PortfolioRiskPolicy,
): string {
  const pos = [...positions]
    .map((p) => ({
      i: p.instrumentId,
      d: p.homeDomain,
      r: p.singleRecognizedUsd18.toString(),
      m: p.marketValueUsd18.toString(),
      s: p.marketSession,
      g: Object.fromEntries(DIMENSIONS.map((k) => [k, p.groups[k] ?? null])),
      l: (p.liquidityDepthUsd18 ?? 0n).toString(),
    }))
    .sort((a, b) => (a.i < b.i ? -1 : a.i > b.i ? 1 : 0));
  const pol = {
    id: policy.policyId,
    v: policy.version,
    t: policy.taxonomyVersion,
    c: Object.fromEntries(
      DIMENSIONS.map((d) => [d, { N: policy.capBps[d].NAMED.toString(), U: policy.capBps[d].UNKNOWN.toString() }]),
    ),
    sf: Object.fromEntries(Object.entries(policy.sessionFactorBps).map(([k, v]) => [k, v.toString()])),
    ss: [...policy.stressScenarios]
      .map((s) => ({
        id: s.id,
        h: s.haircutBps.toString(),
        g: [...s.appliesToGroupIds].sort(),
        se: [...s.appliesToSessions].sort(),
      }))
      .sort((a, b) => (a.id < b.id ? -1 : 1)),
  };
  return JSON.stringify({ pos, pol });
}

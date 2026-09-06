import { BPS, WAD, type PortfolioPosition, type PortfolioRiskPolicy } from "../src/index";

export const U = (n: bigint) => n * WAD;

/** A representative launch policy. Caps are illustrative; the shape is what matters. */
export function defaultPolicy(over: Partial<PortfolioRiskPolicy> = {}): PortfolioRiskPolicy {
  const base: PortfolioRiskPolicy = {
    policyId: "PORT-LAUNCH",
    version: 1,
    taxonomyVersion: "usance-risk-groups/1",
    capBps: {
      UNDERLYING: { NAMED: 4000n, UNKNOWN: 2500n },
      ISSUER: { NAMED: 6000n, UNKNOWN: 3000n },
      CUSTODY: { NAMED: 6000n, UNKNOWN: 3000n },
      SECTOR: { NAMED: 5000n, UNKNOWN: 3000n },
      // A declared route is bounded by its depth; an UNDECLARED route is assumed shared and shallow.
      LIQUIDITY: { NAMED: BPS, UNKNOWN: 4000n },
    },
    sessionFactorBps: {
      OPEN: BPS,
      PRE_MARKET: 9500n,
      POST_MARKET: 9500n,
      CLOSED: 8000n,
      UNKNOWN: 6000n,
    },
    stressScenarios: [],
    maxCollateralInstruments: 24,
    maxStressScenarios: 8,
  };
  return { ...base, ...over, capBps: { ...base.capBps, ...(over.capBps ?? {}) } };
}

let seq = 0;
export function nextId(): string {
  seq += 1;
  return `0x${seq.toString(16).padStart(64, "0")}`;
}

/**
 * A position with sensible defaults. `over.groups` is MERGED into the default groups, so a caller
 * that sets only `{ UNDERLYING: "NVDA" }` keeps a deep default liquidity route and does not
 * accidentally fall into UNKNOWN_LIQUIDITY.
 */
export function pos(over: Partial<PortfolioPosition> = {}): PortfolioPosition {
  const id = over.instrumentId ?? nextId();
  const n = id.slice(-8);
  const defaults: PortfolioPosition = {
    instrumentId: id,
    homeDomain: "eip155:8453",
    singleRecognizedUsd18: U(100n),
    marketValueUsd18: U(100n),
    marketSession: "OPEN",
    groups: {
      UNDERLYING: `u-${n}`,
      ISSUER: `i-${n}`,
      CUSTODY: `c-${n}`,
      SECTOR: `s-${n}`,
      LIQUIDITY: `route-${n}`,
    },
    liquidityDepthUsd18: U(1_000_000n),
  };
  return {
    ...defaults,
    ...over,
    instrumentId: id,
    groups: over.groups ? { ...defaults.groups, ...over.groups } : defaults.groups,
  };
}

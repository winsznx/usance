/**
 * Explicit transaction-gas policy for Hedera ATS-touching writes.
 *
 * Live evidence (Phase 11B-D substitution proof) showed raw `eth_estimateGas` is unsafe for a
 * write that traverses the ATS Diamond facet chain: `abortCommittedSubstitution` estimated
 * 462,086 gas, and a transaction broadcast at that exact limit reverted deep in the Diamond with
 * the facet's own literal `"INSUFFICIENT_GAS"` error after fully exhausting the gas forwarded to
 * it (gas supplied == gas consumed at that frame) — while `eth_call` simulation at the same limit
 * had reported success. A manual limit of 900,000 for the identical call succeeded using only
 * 385,071. This is a documented Hashio/Hedera estimator gap for multi-hop Diamond/precompile
 * paths, not a one-off flake — see `docs/phase-11/HEDERA_ATS_GAS_POLICY.md`.
 *
 * Policy: raw estimate (diagnostics only, never the cap) -> evidence-backed floor -> validate
 * against the network's block gas limit -> the SAME final number for both simulation and send.
 */

export type HederaAtsMethod = "abortCommittedSubstitution" | "commitReplacement" | "releaseOld";

/**
 * Floors set from live historical `gasUsed` on this exact facility/adapter architecture, each with
 * headroom over the highest observed value:
 *   - abortCommittedSubstitution: successful manual-gas run used 385,071 (limit 900,000)
 *   - commitReplacement: three historical successes used up to 900,215 (limits up to 955,292);
 *     floor set at ceil(900,215 * 1.25)
 *   - releaseOld: three historical successes used up to 586,053 (limits up to 754,965), plus a
 *     live run at limit 900,000 using 678,211
 */
const GAS_FLOORS: Record<HederaAtsMethod, bigint> = {
  abortCommittedSubstitution: 900_000n,
  commitReplacement: 1_150_000n,
  releaseOld: 900_000n,
};

export type GasSelection = {
  method: HederaAtsMethod;
  estimatedGas: bigint | null;
  floorGas: bigint;
  selectedGas: bigint;
  /** True when the estimator's own output already exceeded the evidence-backed floor — kept for
   *  drift monitoring: a persistently rising estimate may mean the floor itself needs revisiting. */
  estimatorExceededFloor: boolean;
};

export class GasPolicyError extends Error {}

/**
 * Selects the gas limit a Hedera ATS-touching write should use for BOTH its pre-broadcast
 * simulation and its actual send — the same number for both, never re-estimated in between.
 * `estimatedGas` is accepted only for diagnostics/logging; it never lowers or replaces the floor.
 */
export function selectHederaAtsGas(method: HederaAtsMethod, estimatedGas: bigint | null, blockGasLimit: bigint): GasSelection {
  const floorGas = GAS_FLOORS[method];
  const selectedGas = floorGas;
  if (selectedGas >= blockGasLimit) {
    throw new GasPolicyError(`Selected gas ${selectedGas} for ${method} meets or exceeds the current block gas limit ${blockGasLimit}.`);
  }
  return {
    method,
    estimatedGas,
    floorGas,
    selectedGas,
    estimatorExceededFloor: estimatedGas !== null && estimatedGas > floorGas,
  };
}

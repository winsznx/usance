import { readHederaFacility } from "./hedera-facility";
import { readSubstitutionReadiness, type SubstitutionReadiness } from "./institutional-substitution-readiness";

export type ReconciliationOutcome =
  | "NONE" | "REQUESTED" | "REPLACEMENT_COMMITTING" | "COMMITMENT_UNKNOWN"
  | "REPLACEMENT_COMMITTED" | "OLD_RELEASED" | "EXTERNAL_ATTEMPT_DETECTED" | "UNAVAILABLE";

export type Reconciliation = {
  outcome: ReconciliationOutcome;
  observedAt: string;
  observedAtBlock: string;
  onChainSubstitutionState: string;
  onChainRequestId: string;
  matchesThisOperation: boolean;
  readiness: SubstitutionReadiness | null;
  reason?: string;
};

/**
 * Authoritative Hedera/ATS reconciliation for one durable operation. Historical Phase 07 proof
 * cannot answer "is this exact request the one currently pending on chain" — only a live read of
 * `InstitutionalFacility.substitution().id` compared against this operation's own `requestId` can.
 * `COMMITMENT_UNKNOWN` is never resolved to success or failure here (I-98/§17): it means
 * reconcile again, not "failed".
 */
export async function reconcileSubstitutionOperation(input: {
  requestId: `0x${string}`;
  replacement: string;
  requestedUnits: bigint;
}): Promise<Reconciliation> {
  const [facility, readiness] = await Promise.all([
    readHederaFacility(),
    readSubstitutionReadiness(input.replacement, input.requestedUnits),
  ]);
  if (facility.outcome === "UNAVAILABLE") {
    return {
      outcome: "UNAVAILABLE", observedAt: new Date().toISOString(), observedAtBlock: "UNKNOWN",
      onChainSubstitutionState: "UNKNOWN", onChainRequestId: "UNKNOWN", matchesThisOperation: false,
      readiness: null, reason: facility.reason,
    };
  }
  const onChainState = facility.facility.substitution.state;
  const onChainRequestId = facility.facility.substitution.requestId;
  const matches = onChainRequestId.toLowerCase() === input.requestId.toLowerCase();
  const outcome = mapReconciliationOutcome(onChainState, matches, /^0x0+$/.test(onChainRequestId));

  return {
    outcome,
    observedAt: new Date().toISOString(),
    observedAtBlock: facility.observedAtBlock,
    onChainSubstitutionState: onChainState,
    onChainRequestId: facility.facility.substitution.requestId,
    matchesThisOperation: matches,
    readiness: readiness.outcome === "FACILITY_UNAVAILABLE" ? null : readiness,
  };
}

/** Pure state mapping (§17): `COMMITMENT_UNKNOWN` never resolves here; a mismatched non-zero
 *  on-chain requestId is always an external attempt, even mid-lifecycle. */
export function mapReconciliationOutcome(onChainState: string, matches: boolean, zeroRequestId: boolean): ReconciliationOutcome {
  if (onChainState === "COMMITMENT_UNKNOWN") return "COMMITMENT_UNKNOWN";
  if (!matches && !zeroRequestId) return "EXTERNAL_ATTEMPT_DETECTED";
  if (onChainState === "NONE") return zeroRequestId ? "NONE" : "OLD_RELEASED";
  if (onChainState === "REQUESTED") return "REQUESTED";
  if (onChainState === "REPLACEMENT_COMMITTING") return "REPLACEMENT_COMMITTING";
  if (onChainState === "REPLACEMENT_COMMITTED") return "REPLACEMENT_COMMITTED";
  return "UNAVAILABLE";
}

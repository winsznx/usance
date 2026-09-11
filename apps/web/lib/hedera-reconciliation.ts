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
  /** True once the durable operation has already recorded a COMPLETED release for this exact
   *  requestId. `InstitutionalFacility._clearSubstitution()` zeroes `substitution.id` on release,
   *  so a live chain read alone cannot distinguish "this operation released" from "this facility
   *  never had a substitution" — both read back as `NONE` with a zero on-chain requestId. This
   *  flag is the only thing that disambiguates them; it never substitutes for the chain read
   *  itself, only for resolving that one specific ambiguity. */
  operationAlreadyCompleted?: boolean;
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
  const outcome = mapReconciliationOutcome(onChainState, matches, /^0x0+$/.test(onChainRequestId), input.operationAlreadyCompleted ?? false);

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
 *  on-chain requestId is always an external attempt, even mid-lifecycle.
 *
 *  `_clearSubstitution()` deletes the whole `Substitution` struct on release, so a released
 *  operation and a facility that never substituted are BOTH observed as `NONE` with a zero
 *  on-chain requestId — chain state alone cannot tell them apart. `operationAlreadyCompleted`
 *  (sourced from this operation's own durable record, never from historical proof of a
 *  *different* operation) is the only thing allowed to break that tie. */
export function mapReconciliationOutcome(
  onChainState: string,
  matches: boolean,
  zeroRequestId: boolean,
  operationAlreadyCompleted = false,
): ReconciliationOutcome {
  if (onChainState === "COMMITMENT_UNKNOWN") return "COMMITMENT_UNKNOWN";
  if (!matches && !zeroRequestId) return "EXTERNAL_ATTEMPT_DETECTED";
  if (onChainState === "NONE") {
    if (matches) return "OLD_RELEASED";
    return zeroRequestId && operationAlreadyCompleted ? "OLD_RELEASED" : "NONE";
  }
  if (onChainState === "REQUESTED") return "REQUESTED";
  if (onChainState === "REPLACEMENT_COMMITTING") return "REPLACEMENT_COMMITTING";
  if (onChainState === "REPLACEMENT_COMMITTED") return "REPLACEMENT_COMMITTED";
  return "UNAVAILABLE";
}

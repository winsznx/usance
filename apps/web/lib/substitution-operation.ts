export const TERMINAL_SUBSTITUTION_STATES = ["COMPLETED", "REFUSED", "EXPIRED", "CANCELLED"] as const;

/**
 * Orchestration-only state. None of these states move collateral or settlement — the frozen
 * Hedera `InstitutionalFacility` is the sole financial authority (Phase 06/07). `CREATED` is
 * durable metadata; everything through `ORG_APPROVAL_PENDING` is read-only against Hedera/Sepolia.
 */
export type SubstitutionOperationState =
  | "CREATED"
  | "AUTHORITY_RESOLVING"
  | "AUTHORITY_VALID"
  | "AUTHORITY_REQUIRED"
  | "AUTHORITY_REVOKED"
  | "AUTHORITY_EXPIRED"
  | "AUTHORITY_UNAVAILABLE"
  | "ORG_APPROVAL_PENDING"
  | "ORG_APPROVED"
  | "AUTHORITY_APPROVED_ONCHAIN"
  | "ORG_APPROVAL_INVALID"
  | "ORG_APPROVAL_EXPIRED"
  | "ORG_APPROVAL_UNAVAILABLE"
  | "POLICY_PENDING"
  | "POLICY_ALLOWED"
  | "POLICY_DENIED"
  | "POLICY_UNAVAILABLE"
  | "AWAITING_FINANCIAL_SAFETY"
  | "COMMITMENT_UNKNOWN"
  | "RELEASE_UNKNOWN"
  | (typeof TERMINAL_SUBSTITUTION_STATES)[number];

/** States where the last authoritative action was a read, not a financial commitment. */
export const NON_FINANCIAL_STATES: readonly SubstitutionOperationState[] = [
  "CREATED",
  "AUTHORITY_RESOLVING",
  "AUTHORITY_VALID",
  "AUTHORITY_REQUIRED",
  "AUTHORITY_REVOKED",
  "AUTHORITY_EXPIRED",
  "AUTHORITY_UNAVAILABLE",
  "ORG_APPROVAL_PENDING",
  "ORG_APPROVED",
  "AUTHORITY_APPROVED_ONCHAIN",
  "ORG_APPROVAL_INVALID",
  "ORG_APPROVAL_EXPIRED",
  "ORG_APPROVAL_UNAVAILABLE",
  "POLICY_PENDING",
  "POLICY_ALLOWED",
  "POLICY_DENIED",
  "POLICY_UNAVAILABLE",
];

/** A state the pipeline stops in until a human/operator resolves the blocker outside this app. */
export const BLOCKED_STATES: readonly SubstitutionOperationState[] = [
  "AUTHORITY_REQUIRED",
  "AUTHORITY_REVOKED",
  "AUTHORITY_EXPIRED",
  "AUTHORITY_UNAVAILABLE",
  "ORG_APPROVAL_INVALID",
  "ORG_APPROVAL_EXPIRED",
  "ORG_APPROVAL_UNAVAILABLE",
  "POLICY_DENIED",
  "POLICY_UNAVAILABLE",
];

export type CreateSubstitutionOperation = {
  operationId: string; requestId: string; facilityId: string; homeDomain: "hedera:testnet:296";
  oldInstrumentId: string; replacementInstrumentId: string; requestedUnits: string; state: "CREATED";
};

/** The operation database records intent and observations, never an inferred facility outcome. */
export function canAdvanceOperation(from: SubstitutionOperationState, to: SubstitutionOperationState): boolean {
  if (TERMINAL_SUBSTITUTION_STATES.includes(from as (typeof TERMINAL_SUBSTITUTION_STATES)[number])) return false;
  if (from === "COMMITMENT_UNKNOWN" || from === "RELEASE_UNKNOWN") {
    return to === "AWAITING_FINANCIAL_SAFETY" || TERMINAL_SUBSTITUTION_STATES.includes(to as (typeof TERMINAL_SUBSTITUTION_STATES)[number]);
  }
  return true;
}

/** A blocked non-terminal state is a stop, not a failure the caller must retry differently. */
export function isBlocked(state: SubstitutionOperationState): boolean {
  return BLOCKED_STATES.includes(state);
}

import { keccak256, toBytes } from "viem";
import { readCurrentEnsAuthority } from "./current-authority";
import { readSubstitutionReadiness } from "./institutional-substitution-readiness";
import { transitionDurableSubstitutionOperation, type SupabaseOperation } from "./substitution-operation-store";
import { FACILITY_OPERATION, decisionHash, orgApprovalHash, type FacilityDecision } from "./facility-decision";

const DECISION_EXPIRY_SECONDS = 3600;

export type OrgApprovalPreparation = {
  decision: FacilityDecision;
  decisionHash: `0x${string}`;
  ensDigest: `0x${string}`;
  orgApprovalHash: `0x${string}`;
  orgApprover: `0x${string}`;
};

/** Seconds of validity left before `decision.expiry`, for a preflight freshness check. Negative means expired. */
export function remainingValiditySeconds(decision: FacilityDecision): number {
  return Number(decision.expiry) - Math.floor(Date.now() / 1000);
}

/** `FacilityDecision` carries `bigint` fields for exact on-chain arithmetic; `NextResponse.json`
 *  (and any other `JSON.stringify` caller) cannot serialize those directly. */
export type JsonSafePreparation = Omit<OrgApprovalPreparation, "decision"> & {
  decision: Omit<FacilityDecision, "pinnedEpoch" | "collateralPolicyVersion" | "expiry" | "nonce"> & {
    pinnedEpoch: string; collateralPolicyVersion: string; expiry: string; nonce: string;
  };
};
export function toJsonSafePreparation(preparation: OrgApprovalPreparation): JsonSafePreparation {
  return {
    ...preparation,
    decision: {
      ...preparation.decision,
      pinnedEpoch: preparation.decision.pinnedEpoch.toString(),
      collateralPolicyVersion: preparation.decision.collateralPolicyVersion.toString(),
      expiry: preparation.decision.expiry.toString(),
      nonce: preparation.decision.nonce.toString(),
    },
  };
}

/**
 * The one automatic step this app performs after operation creation: resolve CURRENT authority
 * and, if valid, prepare the exact digest a Privy quorum approval would need to sign — without
 * invoking Privy. Every other stage (org approval itself, CRE, Hedera writes) requires an explicit
 * consequential action this module never takes on its own (§11/§15/§18 of the Phase 11B-D brief).
 *
 * `mode: "REFRESH"` re-runs the exact same pipeline against current chain state to replace a
 * stale/near-expiry decision with a fresh one (new nonce, new expiry) — recorded as an explicit
 * new event under the SAME operation/requestId, never a silent overwrite. No prior Privy signature
 * exists to invalidate, since none is ever produced before the consequential-action gate.
 */
export async function resolveAuthorityAndPrepareOrgApproval(
  operation: SupabaseOperation,
  mode: "INITIAL" | "REFRESH" = "INITIAL",
): Promise<{
  operation: SupabaseOperation;
  preparation: OrgApprovalPreparation | null;
}> {
  const resolving = await transitionDurableSubstitutionOperation({
    operationId: operation.operation_id,
    expectedVersion: operation.version,
    nextState: "AUTHORITY_RESOLVING",
    eventType: "AUTHORITY_RESOLVING_STARTED",
    payload: {},
    source: "USANCE_API",
  });

  const authority = await readCurrentEnsAuthority();

  if (authority.outcome !== "AUTHORITY_VALID") {
    const nextState = authority.outcome; // AUTHORITY_REQUIRED | AUTHORITY_REVOKED | AUTHORITY_UNAVAILABLE
    const stopped = await transitionDurableSubstitutionOperation({
      operationId: resolving.operation_id,
      expectedVersion: resolving.version,
      nextState,
      eventType: nextState,
      payload: authority,
      source: "USANCE_API",
    });
    return { operation: stopped, preparation: null };
  }

  const readiness = await readSubstitutionReadiness(operation.replacement_instrument_id, BigInt(operation.requested_units));
  if (readiness.outcome !== "PREPARATION_READY" || !readiness.replacementIdentity) {
    const stopped = await transitionDurableSubstitutionOperation({
      operationId: resolving.operation_id,
      expectedVersion: resolving.version,
      nextState: mapReadinessToBlockedState(readiness.outcome),
      eventType: "READINESS_" + readiness.outcome,
      payload: readiness,
      source: "USANCE_API",
    });
    return { operation: stopped, preparation: null };
  }

  const authorityValid = await transitionDurableSubstitutionOperation({
    operationId: resolving.operation_id,
    expectedVersion: resolving.version,
    nextState: "AUTHORITY_VALID",
    eventType: "AUTHORITY_VALID",
    payload: authority,
    source: "USANCE_API",
  });

  const requestId = operation.request_id as `0x${string}`;
  const decision: FacilityDecision = {
    facilityId: operation.facility_id as `0x${string}`,
    operation: FACILITY_OPERATION.SUBSTITUTE,
    subjectAssetId: readiness.replacementIdentity.assetId as `0x${string}`,
    subjectInstrumentRef: readiness.replacementIdentity.instrumentRef as `0x${string}`,
    requestId,
    pinnedEpoch: BigInt(readiness.current.riskEpoch),
    collateralPolicyVersion: BigInt(readiness.current.riskEpoch),
    decisionVersion: 1,
    expiry: BigInt(Math.floor(Date.now() / 1000) + DECISION_EXPIRY_SECONDS),
    nonce: BigInt(Date.now()),
    proofRef: keccak256(toBytes(`proof:SUBSTITUTE:${requestId}`)),
    attestationHash: keccak256(toBytes(`att:SUBSTITUTE:${requestId}`)),
  };
  const dHash = decisionHash(decision);
  const approvalHash = orgApprovalHash(dHash, authority.digest);
  const preparation: OrgApprovalPreparation = {
    decision, decisionHash: dHash, ensDigest: authority.digest, orgApprovalHash: approvalHash, orgApprover: authority.orgApprover,
  };

  const pending = await transitionDurableSubstitutionOperation({
    operationId: authorityValid.operation_id,
    expectedVersion: authorityValid.version,
    nextState: "ORG_APPROVAL_PENDING",
    eventType: mode === "REFRESH" ? "DECISION_REFRESHED" : "ORG_APPROVAL_PENDING",
    payload: {
      decisionHash: dHash, ensDigest: authority.digest, orgApprovalHash: approvalHash, orgApprover: authority.orgApprover,
      expiry: decision.expiry.toString(), nonce: decision.nonce.toString(),
      replacementAssetId: decision.subjectAssetId, replacementInstrumentRef: decision.subjectInstrumentRef,
    },
    source: "USANCE_API",
  });

  return { operation: pending, preparation };
}

function mapReadinessToBlockedState(outcome: string): string {
  switch (outcome) {
    case "AUTHORITY_REVOKED": return "AUTHORITY_REVOKED";
    case "AUTHORITY_REQUIRED": return "AUTHORITY_REQUIRED";
    case "CRE_REQUIRED": return "POLICY_UNAVAILABLE";
    case "COMMITMENT_UNKNOWN": return "COMMITMENT_UNKNOWN";
    default: return "AUTHORITY_UNAVAILABLE";
  }
}

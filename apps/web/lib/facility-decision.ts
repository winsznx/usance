import { encodeAbiParameters, keccak256, parseAbiParameters } from "viem";

/**
 * The exact Phase 06/07 `FacilityDecision` binding. Reused verbatim from
 * `packages/ethonline/src/hedera/run-substitution.mjs` and the ENS/Privy/CRE lifecycle scripts —
 * this is not a frontend-specific request hash. `IFacilityDecisions.sol` is the source of truth;
 * changing the field order here without changing the contract breaks every downstream signature.
 */
export const FACILITY_OPERATION = { ACTIVATE: 0, SUBSTITUTE: 1, RECALL: 2, SETTLE: 3 } as const;

export type FacilityDecision = {
  facilityId: `0x${string}`;
  operation: number;
  subjectAssetId: `0x${string}`;
  subjectInstrumentRef: `0x${string}`;
  requestId: `0x${string}`;
  pinnedEpoch: bigint;
  collateralPolicyVersion: bigint;
  decisionVersion: number;
  expiry: bigint;
  nonce: bigint;
  proofRef: `0x${string}`;
  attestationHash: `0x${string}`;
};

const DECISION_TYPES = parseAbiParameters(
  "string, bytes32, uint8, bytes32, bytes32, bytes32, uint64, uint64, uint32, uint64, uint64, bytes32, bytes32",
);

/** `keccak256` of the full decision, exactly `FacilityDecisionLib.hash` in `IFacilityDecisions.sol`. */
export function decisionHash(d: FacilityDecision): `0x${string}` {
  return keccak256(
    encodeAbiParameters(DECISION_TYPES, [
      "USANCE_FACILITY_DECISION_V1",
      d.facilityId,
      d.operation,
      d.subjectAssetId,
      d.subjectInstrumentRef,
      d.requestId,
      d.pinnedEpoch,
      d.collateralPolicyVersion,
      d.decisionVersion,
      d.expiry,
      d.nonce,
      d.proofRef,
      d.attestationHash,
    ]),
  );
}

/**
 * What the Privy quorum would sign: `keccak256(abi.encode("USANCE_ORG_APPROVAL_V1", decisionHash,
 * ensDigest))`, exactly `EthOnlineAuthorityVerifier.submitApproval`'s recovered message. Computing
 * this needs no Privy credential — it is the digest a quorum approval must be produced over, not
 * an approval itself.
 */
export function orgApprovalHash(dHash: `0x${string}`, ensDigest: `0x${string}`): `0x${string}` {
  return keccak256(
    encodeAbiParameters(parseAbiParameters("string, bytes32, bytes32"), ["USANCE_ORG_APPROVAL_V1", dHash, ensDigest]),
  );
}

/**
 * What the CRE reporter would sign over a verdict: `EthOnlinePolicyVerifier.submitVerdict`'s
 * recovered message. Computing this binds the CRE evaluation to this exact operation; it does not
 * invoke CRE or require the reporter key.
 */
export function creReportHash(input: {
  dHash: `0x${string}`;
  allow: boolean;
  policyCommitment: `0x${string}`;
  workflowVersion: number;
  reasonCode: `0x${string}`;
  expiry: bigint;
}): `0x${string}` {
  return keccak256(
    encodeAbiParameters(
      parseAbiParameters("string, bytes32, bool, bytes32, uint32, bytes32, uint64"),
      [
        "USANCE_CRE_POLICY_V1",
        input.dHash,
        input.allow,
        input.policyCommitment,
        input.workflowVersion,
        input.reasonCode,
        input.expiry,
      ],
    ),
  );
}

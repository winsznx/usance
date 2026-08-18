import { encodeFunctionData, keccak256, stringToBytes, toFunctionSelector } from "viem";
import { commitPassportArgs, type CanonicalDocument, type Hex32, type PassportCandidate } from "@usance/schemas";

/**
 * Calldata production. The pipeline stops here.
 *
 * This module holds no key, imports no wallet client, and has no function that broadcasts. It returns
 * bytes for a human or a process holding `ADMISSION` to sign. That is not a limitation of the current
 * implementation, it is the shape of the authority graph: an evidence pipeline that could sign is an
 * evidence pipeline that can commit its own conclusions, and `spec/evidence-model.md §8` is a table of
 * guards whose whole content is that no extractor holds a role.
 *
 * The scalars in `commitPassport`, plus a list of 32-byte evidence ids, are the complete interface
 * between the evidence world and the money world. There is no string, no free-form field, no bytes
 * blob and no callback. "Document content cannot influence control flow" is a claim about the width
 * of a struct, and this file is where that width is fixed. The evidence ids widen it by a list of
 * hashes the registry independently verifies — nothing a document could author.
 */

/**
 * Function signatures, transcribed from `contracts/src/core/`.
 *
 * Written out as strings as well as ABI objects so a test can compute the selector from the signature
 * and compare it against the encoded calldata. Enum parameters appear as `uint8` because that is what
 * Solidity's ABI encoding does with them, and `PassportStatus`/`SourceClass` ordinals are load-bearing
 * (`spec/interfaces.md §3`) — a reordered enum is an RFC-level change, not a refactor.
 */
export const COMMIT_PASSPORT_SIGNATURE =
  "commitPassport(bytes32,uint64,bytes32[],bytes32,bytes32,uint64,bool,uint16,bool)" as const;
export const RESTRICT_PASSPORT_SIGNATURE = "restrict(bytes32,uint64,uint8)" as const;
export const COMMIT_EVIDENCE_SIGNATURE = "commit(bytes32,bytes32,bytes32,uint64,uint64,uint8)" as const;
export const BUMP_EPOCH_SIGNATURE = "bumpEpoch(bytes32)" as const;

export const PASSPORT_REGISTRY_ABI = [
  {
    type: "function",
    name: "commitPassport",
    stateMutability: "nonpayable",
    inputs: [
      { name: "assetId", type: "bytes32" },
      { name: "version", type: "uint64" },
      // The evidence being cited, ascending. The registry checks each id is committed against this
      // asset and recomputes the root from them, so a Passport can no longer assert a root over
      // evidence that was never filed.
      { name: "evidenceIds", type: "bytes32[]" },
      { name: "evidenceRoot", type: "bytes32" },
      { name: "claimsRoot", type: "bytes32" },
      { name: "expiresAt", type: "uint64" },
      { name: "redemptionSupported", type: "bool" },
      { name: "redemptionFloorBps", type: "uint16" },
      { name: "singleSource", type: "bool" },
    ],
    outputs: [{ name: "passportId", type: "bytes32" }],
  },
  {
    type: "function",
    name: "restrict",
    stateMutability: "nonpayable",
    inputs: [
      { name: "assetId", type: "bytes32" },
      { name: "version", type: "uint64" },
      { name: "status", type: "uint8" },
    ],
    outputs: [],
  },
] as const;

export const EVIDENCE_REGISTRY_ABI = [
  {
    type: "function",
    name: "commit",
    stateMutability: "nonpayable",
    inputs: [
      { name: "assetId", type: "bytes32" },
      { name: "contentHash", type: "bytes32" },
      { name: "sourceHash", type: "bytes32" },
      { name: "effectiveAt", type: "uint64" },
      { name: "retrievedAt", type: "uint64" },
      { name: "sourceClass", type: "uint8" },
    ],
    outputs: [{ name: "evidenceId", type: "bytes32" }],
  },
] as const;

export const RISK_POLICY_REGISTRY_ABI = [
  {
    type: "function",
    name: "bumpEpoch",
    stateMutability: "nonpayable",
    inputs: [{ name: "cause", type: "bytes32" }],
    outputs: [],
  },
] as const;

/**
 * `Types.PassportStatus`, ordinals matching `contracts/src/libraries/Types.sol`.
 *
 * `restrict` requires a strictly greater ordinal, which is what makes a guardian's power one-way: a
 * Passport can be moved toward more restrictive and there is no function that moves it back
 * (`spec/evidence-model.md §10`).
 */
export const PASSPORT_STATUS = {
  NONE: 0,
  ACTIVE: 1,
  STALE: 2,
  CONFLICTED: 3,
  SUSPENDED: 4,
  REVOKED: 5,
} as const;

export type PassportStatusName = keyof typeof PASSPORT_STATUS;

/** Statuses `restrict` may be called with. `NONE` and `ACTIVE` cannot be reached by restriction. */
export type RestrictableStatus = Extract<PassportStatusName, "STALE" | "CONFLICTED" | "SUSPENDED" | "REVOKED">;

export interface Calldata {
  /** The contract this is for, by name. There is no address here; deployment binding is the caller's. */
  readonly contract: "PassportRegistry" | "EvidenceRegistry" | "RiskPolicyRegistry";
  readonly functionName: string;
  readonly signature: string;
  readonly selector: `0x${string}`;
  readonly data: `0x${string}`;
  /** The role the signer must hold. Recorded so a caller cannot mistake this for a permissionless call. */
  readonly requiredRole: "ADMISSION" | "ADMISSION_OR_GUARDIAN";
}

/**
 * Calldata for `PassportRegistry.commitPassport`.
 *
 * The argument list comes from `commitPassportArgs` in `@usance/schemas`, which is the single place
 * the positional order is written down. Re-listing the arguments here would create a second place for
 * them to drift, and a silent argument swap between two `bytes32` roots is undetectable by type.
 */
export function commitPassportCalldata(candidate: PassportCandidate): Calldata {
  const args = commitPassportArgs(candidate);
  return {
    contract: "PassportRegistry",
    functionName: "commitPassport",
    signature: COMMIT_PASSPORT_SIGNATURE,
    selector: toFunctionSelector(COMMIT_PASSPORT_SIGNATURE),
    data: encodeFunctionData({ abi: PASSPORT_REGISTRY_ABI, functionName: "commitPassport", args }),
    requiredRole: "ADMISSION",
  };
}

/**
 * Calldata for `PassportRegistry.restrict`.
 *
 * This, not a new commit, is the response to `CLAIM_CONFLICT`. `commitPassport` always writes
 * `status = ACTIVE`, so committing first and restricting second leaves a window in which the disputed
 * reading is live. The version that already exists is the one to restrict.
 */
export function restrictPassportCalldata(
  assetId: Hex32,
  version: number,
  status: RestrictableStatus,
): Calldata {
  return {
    contract: "PassportRegistry",
    functionName: "restrict",
    signature: RESTRICT_PASSPORT_SIGNATURE,
    selector: toFunctionSelector(RESTRICT_PASSPORT_SIGNATURE),
    data: encodeFunctionData({
      abi: PASSPORT_REGISTRY_ABI,
      functionName: "restrict",
      args: [assetId, BigInt(version), PASSPORT_STATUS[status]],
    }),
    requiredRole: "ADMISSION_OR_GUARDIAN",
  };
}

/** Calldata for `EvidenceRegistry.commit`, one call per document. */
export function commitEvidenceCalldata(assetId: Hex32, doc: CanonicalDocument): Calldata {
  return {
    contract: "EvidenceRegistry",
    functionName: "commit",
    signature: COMMIT_EVIDENCE_SIGNATURE,
    selector: toFunctionSelector(COMMIT_EVIDENCE_SIGNATURE),
    data: encodeFunctionData({
      abi: EVIDENCE_REGISTRY_ABI,
      functionName: "commit",
      args: [
        assetId,
        doc.contentHash,
        doc.sourceHash,
        BigInt(doc.effectiveAt),
        BigInt(doc.retrievedAt),
        doc.sourceClass,
      ],
    }),
    requiredRole: "ADMISSION",
  };
}

/** `keccak256("CLAIM_CONFLICT")`, the cause `spec/evidence-model.md §2` names for the epoch bump. */
export const CAUSE_CLAIM_CONFLICT: Hex32 = keccak256(stringToBytes("CLAIM_CONFLICT"));
export const CAUSE_PASSPORT_COMMIT: Hex32 = keccak256(stringToBytes("PASSPORT_COMMIT"));

export function bumpEpochCalldata(cause: Hex32): Calldata {
  return {
    contract: "RiskPolicyRegistry",
    functionName: "bumpEpoch",
    signature: BUMP_EPOCH_SIGNATURE,
    selector: toFunctionSelector(BUMP_EPOCH_SIGNATURE),
    data: encodeFunctionData({ abi: RISK_POLICY_REGISTRY_ABI, functionName: "bumpEpoch", args: [cause] }),
    requiredRole: "ADMISSION",
  };
}

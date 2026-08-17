import { encodeAbiParameters, keccak256 } from "viem";
import type { EvmAddress, Hex32 } from "./primitives";

/**
 * Identifier derivation, matching `spec/accounting.md §2` exactly.
 *
 * Every id is derived, never assigned, so two independent implementations produce the same value
 * from the same inputs. `packages/schemas/test/ids.test.ts` pins each one against a constant
 * produced by `cast`, so a drift between this file and Solidity fails a test rather than producing
 * two different ids for the same thing.
 */

export function assetId(chainId: bigint, token: EvmAddress): Hex32 {
  return keccak256(encodeAbiParameters([{ type: "uint256" }, { type: "address" }], [chainId, token]));
}

export function accountId(owner: EvmAddress): Hex32 {
  return keccak256(
    encodeAbiParameters([{ type: "string" }, { type: "address" }], ["USANCE_ACCOUNT_V1", owner]),
  );
}

export function evidenceId(sourceHash: Hex32, contentHash: Hex32, effectiveAt: number): Hex32 {
  return keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, { type: "bytes32" }, { type: "uint64" }],
      [sourceHash, contentHash, BigInt(effectiveAt)],
    ),
  );
}

export function passportId(asset: Hex32, version: number | bigint): Hex32 {
  return keccak256(
    encodeAbiParameters([{ type: "bytes32" }, { type: "uint64" }], [asset, BigInt(version)]),
  );
}

export function intentId(
  account: Hex32,
  mandateId: Hex32,
  nonce: bigint,
  planHash: Hex32,
): Hex32 {
  return keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, { type: "bytes32" }, { type: "uint256" }, { type: "bytes32" }],
      [account, mandateId, nonce, planHash],
    ),
  );
}

export function receiptId(chainId: bigint, txHash: Hex32, logIndex: number): Hex32 {
  return keccak256(
    encodeAbiParameters(
      [{ type: "uint256" }, { type: "bytes32" }, { type: "uint256" }],
      [chainId, txHash, BigInt(logIndex)],
    ),
  );
}

// ---------------------------------------------------------------------------- merkle

/**
 * Sorted-pair keccak Merkle root over leaves.
 *
 * Sorting each pair before hashing removes the left/right distinction, which makes a proof
 * verifiable without carrying a direction bitmap and makes the root independent of sibling order.
 * The leaf list itself IS sorted first, so the root is a function of the set rather than of
 * insertion order — two pipelines that discovered the same evidence in different orders must
 * commit the same root.
 *
 * An odd node at any level is promoted unchanged rather than duplicated. Duplicating it is the
 * classic second-preimage footgun: it makes a tree with a duplicated last leaf indistinguishable
 * from one without.
 */
export function merkleRoot(leaves: readonly Hex32[]): Hex32 {
  if (leaves.length === 0) return `0x${"00".repeat(32)}`;

  let level = [...leaves].sort(compareHex);
  while (level.length > 1) {
    const next: Hex32[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const a = level[i]!;
      const b = level[i + 1];
      next.push(b === undefined ? a : hashPair(a, b));
    }
    level = next;
  }
  return level[0]!;
}

function hashPair(a: Hex32, b: Hex32): Hex32 {
  const [lo, hi] = compareHex(a, b) <= 0 ? [a, b] : [b, a];
  return keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "bytes32" }], [lo, hi]));
}

function compareHex(a: Hex32, b: Hex32): number {
  const x = BigInt(a);
  const y = BigInt(b);
  return x < y ? -1 : x > y ? 1 : 0;
}

/**
 * Leaf hash for a claim.
 *
 * Hashed over the fields that determine meaning. `confidenceBps` is excluded deliberately: it is
 * inert for admission, and including it would make an otherwise identical claim commit to a
 * different root depending on how confident a model happened to feel.
 */
export function claimLeaf(field: string, normalizedValue: string, evidence: Hex32): Hex32 {
  return keccak256(
    encodeAbiParameters(
      [{ type: "string" }, { type: "string" }, { type: "bytes32" }],
      [field, normalizedValue, evidence],
    ),
  );
}

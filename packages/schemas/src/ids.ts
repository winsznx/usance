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

// ---------------------------------------------------------------------- instrument identity
//
// The product-identity layer above `assetId`, frozen in `spec/identity-model.md`. `assetId`
// stays the financial key the deployed contracts use; nothing here is an input to a formula in
// `accounting.md` or a key in any deployed contract. Every derivation is `keccak256(abi.encode(...))`
// of value types so it is pinned against `cast` in `../test/instrument.test.ts`.

/** `keccak256(abi.encode("USANCE_DOMAIN_V1", caip2))`. `caip2` is authored by a human, e.g. "eip155:8453". */
export function domainId(caip2: string): Hex32 {
  return keccak256(
    encodeAbiParameters([{ type: "string" }, { type: "string" }], ["USANCE_DOMAIN_V1", caip2]),
  );
}

/** `keccak256(abi.encode("USANCE_INSTRUMENT_STANDARD_V1", standard))` over the closed vocabulary. */
export function instrumentStandardId(standard: string): Hex32 {
  return keccak256(
    encodeAbiParameters(
      [{ type: "string" }, { type: "string" }],
      ["USANCE_INSTRUMENT_STANDARD_V1", standard],
    ),
  );
}

/**
 * The exact token this instrument is.
 *
 * EVM: the 20-byte address left-padded into `bytes32`, the same value `abi.encode(address)` and
 * `bytes32(uint256(uint160(addr)))` both produce. Native: a hash of the chain-native identifier.
 */
export function evmCanonicalRef(token: EvmAddress): Hex32 {
  return `0x${token.toLowerCase().replace(/^0x/, "").padStart(64, "0")}` as Hex32;
}

export function nativeCanonicalRef(nativeId: string): Hex32 {
  return keccak256(
    encodeAbiParameters(
      [{ type: "string" }, { type: "string" }],
      ["USANCE_NATIVE_REF_V1", nativeId],
    ),
  );
}

export interface UnderlyingReferenceParts {
  assetClass: string;
  isin: string;
  figi: string;
  ticker: string;
  name: string;
}

/**
 * The economic reference — company / fund / asset. Deliberately NOT an input to `instrumentId`:
 * learning an ISIN later must not change an instrument's identity, and two instruments over one
 * underlying must stay distinct.
 */
export function underlyingReferenceId(u: UnderlyingReferenceParts): Hex32 {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "string" },
        { type: "string" },
        { type: "string" },
        { type: "string" },
        { type: "string" },
        { type: "string" },
      ],
      ["USANCE_UNDERLYING_REF_V1", u.assetClass, u.isin, u.figi, u.ticker, u.name],
    ),
  );
}

export interface InstrumentIdParts {
  domainId: Hex32;
  canonicalRef: Hex32;
  issuerId: Hex32;
  instrumentStandardId: Hex32;
  /** uint32, starts at 1. Bumped only on a genuine identity change — never for a corporate action. */
  instrumentVersion: number;
}

export function instrumentId(i: InstrumentIdParts): Hex32 {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "uint32" },
      ],
      [i.domainId, i.canonicalRef, i.issuerId, i.instrumentStandardId, i.instrumentVersion],
    ),
  );
}

/** `keccak256(abi.encode(legacyAssetId, instrumentId, boundAt))` — see `spec/identity-model.md §3`. */
export function instrumentBindingId(legacyAssetId: Hex32, instrumentIdValue: Hex32, boundAt: number): Hex32 {
  return keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, { type: "bytes32" }, { type: "uint64" }],
      [legacyAssetId, instrumentIdValue, BigInt(boundAt)],
    ),
  );
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

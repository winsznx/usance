import { createPublicClient, http } from "viem";
import deployment from "../../../docs/ethonline-2026/proof/hedera-facility-deployment.json";
import ensEvidence from "../../../docs/ethonline-2026/proof/ensv2-authority.json";

const HEDERA_RPC = "https://testnet.hashio.io/api";
const SEPOLIA_RPC = process.env.SEPOLIA_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com";

const AUTHORITY_ABI = [
  { name: "facilityAuthority", type: "function", stateMutability: "view", inputs: [{ type: "bytes32" }], outputs: [{ type: "tuple", components: [{ name: "orgApprover", type: "address" }, { name: "expectedEnsDigest", type: "bytes32" }, { name: "ensRoleRevoked", type: "bool" }, { name: "configured", type: "bool" }] }] },
] as const;
const ETH_REGISTRY_ABI = [
  { name: "hasRoles", type: "function", stateMutability: "view", inputs: [{ type: "uint256" }, { type: "uint256" }, { type: "address" }], outputs: [{ type: "bool" }] },
] as const;

/** What `EthOnlineAuthorityVerifier` on Hedera currently has configured for this facility — a
 *  relationship, not a proof by itself. It was historically set from a pinned Sepolia observation
 *  and does not change unless governance reconfigures it. */
export type ConfiguredAuthority = {
  facilityId: `0x${string}`;
  authorityVerifier: `0x${string}`;
  expectedEnsDigest: `0x${string}`;
  orgApprover: `0x${string}`;
  ensRoleRevoked: boolean;
  configured: boolean;
  hederaBlock: string;
};

/** A live Sepolia read, taken now. Says nothing about what Hedera has configured. */
export type ObservedAuthority =
  | { outcome: "OBSERVED"; hasRoles: boolean; name: string; registry: `0x${string}`; version: string; resource: `0x${string}`; roleBitmap: `0x${string}`; delegate: `0x${string}`; sepoliaBlock: string; observedAt: string; source: "sepolia-rpc" }
  | { outcome: "UNAVAILABLE"; reason: string; observedAt: string; source: "sepolia-rpc" };

export type CurrentAuthority =
  | { outcome: "AUTHORITY_VALID"; digest: `0x${string}`; orgApprover: `0x${string}`; configured: ConfiguredAuthority; observed: Extract<ObservedAuthority, { outcome: "OBSERVED" }> }
  | { outcome: "AUTHORITY_REVOKED"; reason: string; observedAt: string; configured: ConfiguredAuthority | null; observed: ObservedAuthority | null }
  | { outcome: "AUTHORITY_REQUIRED"; observedAt: string; configured: ConfiguredAuthority | null; observed: ObservedAuthority | null }
  | { outcome: "AUTHORITY_UNAVAILABLE"; reason: string };

async function readConfiguredAuthority(): Promise<ConfiguredAuthority> {
  const facilityId = deployment.facilityId as `0x${string}`;
  const authorityVerifier = deployment.contracts.EthOnlineAuthorityVerifier as `0x${string}`;
  const hedera = createPublicClient({ transport: http(HEDERA_RPC, { timeout: 12_000, retryCount: 1 }) });
  const [hederaBlock, authority] = await Promise.all([
    hedera.getBlockNumber(),
    hedera.readContract({ address: authorityVerifier, abi: AUTHORITY_ABI, functionName: "facilityAuthority", args: [facilityId] }),
  ]);
  return {
    facilityId, authorityVerifier, expectedEnsDigest: authority.expectedEnsDigest, orgApprover: authority.orgApprover,
    ensRoleRevoked: authority.ensRoleRevoked, configured: authority.configured, hederaBlock: hederaBlock.toString(),
  };
}

async function readObservedAuthority(): Promise<ObservedAuthority> {
  const registry = ensEvidence.ensv2.ethRegistry as `0x${string}`;
  const labelhash = BigInt(ensEvidence.labelhash);
  const roleBitmap = BigInt(ensEvidence.roleBitmap);
  const delegate = ensEvidence.delegate as `0x${string}`;
  const sepolia = createPublicClient({ transport: http(SEPOLIA_RPC, { timeout: 12_000, retryCount: 1 }) });
  const observedAt = new Date().toISOString();
  try {
    const [sepoliaBlock, hasRoles] = await Promise.all([
      sepolia.getBlockNumber(),
      sepolia.readContract({ address: registry, abi: ETH_REGISTRY_ABI, functionName: "hasRoles", args: [labelhash, roleBitmap, delegate] }),
    ]);
    return {
      outcome: "OBSERVED", hasRoles, name: ensEvidence.name, registry,
      version: ensEvidence.authorityEvidence.ensv2Version, resource: ensEvidence.resource as `0x${string}`,
      roleBitmap: ensEvidence.roleBitmap as `0x${string}`, delegate, sepoliaBlock: sepoliaBlock.toString(), observedAt, source: "sepolia-rpc",
    };
  } catch (error) {
    return { outcome: "UNAVAILABLE", reason: (error as Error).message.slice(0, 180), observedAt, source: "sepolia-rpc" };
  }
}

/**
 * `AUTHORITY_VALID` requires BOTH facts, read independently and never substituted for each other:
 *   A. the CONFIGURED relationship on Hedera (`EthOnlineAuthorityVerifier.facilityAuthority`) says
 *      this facility is not revoked and has an org approver configured;
 *   B. a LIVE Sepolia `hasRoles` read, taken now, still returns true for that exact
 *      resource/role/delegate.
 * The historical Phase 07 proof supplies only the resource/role/delegate identifiers to re-check —
 * it is never itself treated as a current authority result, and a stale or unreachable Sepolia RPC
 * fails closed rather than falling back to that historical record.
 */
export async function readCurrentEnsAuthority(): Promise<CurrentAuthority> {
  let configured: ConfiguredAuthority;
  try {
    configured = await readConfiguredAuthority();
  } catch (error) {
    return { outcome: "AUTHORITY_UNAVAILABLE", reason: `Hedera read failed: ${(error as Error).message.slice(0, 160)}` };
  }
  const observed = await readObservedAuthority();
  const observedAt = new Date().toISOString();

  if (!configured.configured) return { outcome: "AUTHORITY_REQUIRED", observedAt, configured, observed };
  if (configured.ensRoleRevoked) return { outcome: "AUTHORITY_REVOKED", reason: "Hedera EthOnlineAuthorityVerifier.ensRoleRevoked is set.", observedAt, configured, observed };
  if (observed.outcome === "UNAVAILABLE") return { outcome: "AUTHORITY_UNAVAILABLE", reason: `Sepolia read failed: ${observed.reason}` };
  if (!observed.hasRoles) return { outcome: "AUTHORITY_REVOKED", reason: "The live Sepolia EAC role read returned false for the configured resource/delegate.", observedAt, configured, observed };

  return { outcome: "AUTHORITY_VALID", digest: configured.expectedEnsDigest, orgApprover: configured.orgApprover, configured, observed };
}

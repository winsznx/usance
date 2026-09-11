import { createPublicClient, http } from "viem";
import { HEDERA_FACILITY } from "./institutional-proof";

const HEDERA_RPC = "https://testnet.hashio.io/api";
const STATUS = ["DRAFT", "PENDING_ACTIVATION", "ACTIVE", "SUBSTITUTION_PENDING", "RECALLING", "MATURED", "SETTLED", "DEFAULTED"] as const;
const SUBSTITUTION = ["NONE", "REQUESTED", "REPLACEMENT_COMMITTING", "COMMITMENT_UNKNOWN", "REPLACEMENT_COMMITTED"] as const;

const ABI = [
  { name: "status", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
  { name: "outstanding", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { name: "riskEpochAtActivation", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint64" }] },
  { name: "collateral", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "tuple", components: [{ name: "assetId", type: "bytes32" }, { name: "instrumentRef", type: "bytes32" }, { name: "adapter", type: "address" }, { name: "committedUnits", type: "uint256" }, { name: "passportVersion", type: "uint64" }] }] },
  { name: "substitution", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "tuple", components: [{ name: "state", type: "uint8" }, { name: "consumed", type: "bool" }, { name: "id", type: "bytes32" }, { name: "replacementAssetId", type: "bytes32" }, { name: "replacementInstrumentRef", type: "bytes32" }, { name: "replacementAdapter", type: "address" }, { name: "requiredUnits", type: "uint256" }, { name: "pinnedEpoch", type: "uint64" }, { name: "collateralPolicyVersion", type: "uint64" }, { name: "authorityExpiry", type: "uint64" }, { name: "policyDecisionHash", type: "bytes32" }, { name: "authorityDecisionHash", type: "bytes32" }, { name: "lastReason", type: "bytes32" }] }] },
] as const;

export type HederaFacilityRead =
  | { outcome: "READY"; observedAtBlock: string; facility: { status: string; outstanding: string; riskEpochAtActivation: string; collateral: { assetId: string; instrumentRef: string; adapter: string; committedUnits: string; passportVersion: string }; substitution: { state: string; requestId: string; requiredUnits: string; authorityExpiry: string } } }
  | { outcome: "UNAVAILABLE"; reason: string };

/** The Hedera contract is authoritative operational state. Proof JSON is never used as a fallback balance. */
export async function readHederaFacility(): Promise<HederaFacilityRead> {
  const client = createPublicClient({ transport: http(HEDERA_RPC, { timeout: 12_000, retryCount: 1 }) });
  try {
    const blockNumber = await client.getBlockNumber();
    const address = HEDERA_FACILITY.controller as `0x${string}`;
    const [status, outstanding, riskEpoch, collateral, substitution] = await Promise.all([
      client.readContract({ address, abi: ABI, functionName: "status", blockNumber }),
      client.readContract({ address, abi: ABI, functionName: "outstanding", blockNumber }),
      client.readContract({ address, abi: ABI, functionName: "riskEpochAtActivation", blockNumber }),
      client.readContract({ address, abi: ABI, functionName: "collateral", blockNumber }),
      client.readContract({ address, abi: ABI, functionName: "substitution", blockNumber }),
    ]);
    return { outcome: "READY", observedAtBlock: blockNumber.toString(), facility: {
      status: STATUS[Number(status)] ?? "UNKNOWN", outstanding: outstanding.toString(), riskEpochAtActivation: riskEpoch.toString(),
      collateral: { assetId: collateral.assetId, instrumentRef: collateral.instrumentRef, adapter: collateral.adapter, committedUnits: collateral.committedUnits.toString(), passportVersion: collateral.passportVersion.toString() },
      substitution: { state: SUBSTITUTION[Number(substitution.state)] ?? "UNKNOWN", requestId: substitution.id, requiredUnits: substitution.requiredUnits.toString(), authorityExpiry: substitution.authorityExpiry.toString() },
    } };
  } catch (error) {
    return { outcome: "UNAVAILABLE", reason: (error as Error).message.slice(0, 180) };
  }
}

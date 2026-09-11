import { createPublicClient, http } from "viem";
import { BASE_SEPOLIA_DEPLOYMENT } from "./base-sepolia-proof";

const RPC = process.env.BASE_SEPOLIA_RPC_URL ?? "https://sepolia.base.org";
const STATUS = ["DRAFT", "PORTFOLIO_PENDING", "ACTIVE", "RECALLING", "MATURED", "SETTLED"] as const;
const POLICY = ["DRAFT", "TESTNET_CALIBRATION", "CANARY_PROVISIONAL", "PRODUCTION_VALIDATED"] as const;
const SESSION = ["OPEN", "PRE_MARKET", "POST_MARKET", "CLOSED", "UNKNOWN"] as const;
const FACILITY = [{ name: "status", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] }, { name: "outstandingDebtUsd18", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] }, { name: "borrower", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] }, { name: "policyReg", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] }, { name: "vault", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] }, { name: "policyId", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "bytes32" }] }, { name: "admittedCount", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] }, { name: "quote", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "bytes32" }, { type: "bool" }] }, { name: "admittedInfo", type: "function", stateMutability: "view", inputs: [{ type: "bytes32" }], outputs: [{ type: "tuple", components: [{ name: "adapter", type: "address" }, { name: "oracle", type: "address" }, { name: "liquidity", type: "address" }, { name: "session", type: "address" }, { name: "recognitionBps", type: "uint16" }, { name: "decimals", type: "uint8" }, { name: "admitted", type: "bool" }] }] }] as const;
const VAULT = [{ name: "claimOf", type: "function", stateMutability: "view", inputs: [{ type: "bytes32" }, { type: "address" }], outputs: [{ type: "uint256" }] }] as const;
const ORACLE = [{ name: "priceUsd18", type: "function", stateMutability: "view", inputs: [{ type: "bytes32" }], outputs: [{ type: "uint256" }, { type: "uint64" }, { type: "bool" }] }] as const;
const SESSIONS = [{ name: "sessionOf", type: "function", stateMutability: "view", inputs: [{ type: "bytes32" }, { type: "uint64" }], outputs: [{ type: "uint8" }] }] as const;
const POLICY_REGISTRY = [{ name: "portfolioRiskEpoch", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint64" }] }, { name: "meta", type: "function", stateMutability: "view", inputs: [{ type: "bytes32" }], outputs: [{ type: "uint32" }, { type: "uint32" }, { type: "uint8" }, { type: "uint64" }, { type: "uint64" }, { type: "bool" }] }] as const;

export type BaseInstrumentRead = { id: string; symbol: string; rawClaim: string; oraclePriceUsd18: string; oracleUpdatedAt: string; oracleAgeSeconds: string; oracleLive: boolean; session: string; admitted: boolean };
export type BaseFacilityRead =
  | { outcome: "READY"; observedAt: string; observedAtBlock: string; chainId: number; provenance: { facilityAddress: string; facilityType: string; rpc: string }; facility: { status: string; debtUsd18: string; recognisedValueUsd18: string; maxDebtUsd18: string; availableCapacityUsd18: string; snapshotDigest: string; riskEpoch: string; policyVersion: string; policyStatus: string; instruments: BaseInstrumentRead[] } }
  | { outcome: "STALE"; observedAt: string; observedAtBlock: string; chainId: number; reason: string; facility: { status: string; debtUsd18: string; riskEpoch: string; policyVersion: string; policyStatus: string; instruments: BaseInstrumentRead[] } }
  | { outcome: "PORTFOLIO_UNKNOWN"; observedAt: string; observedAtBlock: string; chainId: number; reason: string }
  | { outcome: "UNAVAILABLE"; reason: string };

export function classifyBaseRead(input: { admittedCount: bigint; expectedInstrumentCount: number; allLive: boolean; instrumentLive: boolean; policyExists: boolean }): "READY" | "STALE" | "PORTFOLIO_UNKNOWN" {
  if (!input.policyExists || input.admittedCount !== BigInt(input.expectedInstrumentCount)) return "PORTFOLIO_UNKNOWN";
  return input.allLive && input.instrumentLive ? "READY" : "STALE";
}

/** Reads the deployed facility at one Base Sepolia block. It never falls back to lifecycle evidence. */
export async function readBaseSepoliaFacility(): Promise<BaseFacilityRead> {
  const client = createPublicClient({ transport: http(RPC, { timeout: 12_000, retryCount: 1 }) });
  try {
    const blockNumber = await client.getBlockNumber();
    const block = await client.getBlock({ blockNumber });
    const address = BASE_SEPOLIA_DEPLOYMENT.facility;
    const [status, debt, borrower, policyRegistry, vault, policyId, admittedCount, quote] = await Promise.all([
      client.readContract({ address, abi: FACILITY, functionName: "status", blockNumber }), client.readContract({ address, abi: FACILITY, functionName: "outstandingDebtUsd18", blockNumber }), client.readContract({ address, abi: FACILITY, functionName: "borrower", blockNumber }), client.readContract({ address, abi: FACILITY, functionName: "policyReg", blockNumber }), client.readContract({ address, abi: FACILITY, functionName: "vault", blockNumber }), client.readContract({ address, abi: FACILITY, functionName: "policyId", blockNumber }), client.readContract({ address, abi: FACILITY, functionName: "admittedCount", blockNumber }), client.readContract({ address, abi: FACILITY, functionName: "quote", blockNumber }),
    ]);
    if (policyRegistry.toLowerCase() !== BASE_SEPOLIA_DEPLOYMENT.policyRegistry.toLowerCase() || vault.toLowerCase() !== BASE_SEPOLIA_DEPLOYMENT.vault.toLowerCase()) return unknown(blockNumber, "Facility dependency addresses differ from the recorded deployment manifest.");
    const [riskEpoch, meta] = await Promise.all([client.readContract({ address: BASE_SEPOLIA_DEPLOYMENT.policyRegistry, abi: POLICY_REGISTRY, functionName: "portfolioRiskEpoch", blockNumber }), client.readContract({ address: BASE_SEPOLIA_DEPLOYMENT.policyRegistry, abi: POLICY_REGISTRY, functionName: "meta", args: [policyId], blockNumber })]);
    const instruments = await Promise.all(BASE_SEPOLIA_DEPLOYMENT.instruments.map(async (instrument) => {
      const admitted = await client.readContract({ address, abi: FACILITY, functionName: "admittedInfo", args: [instrument.id], blockNumber });
      const [rawClaim, price, session] = await Promise.all([client.readContract({ address: BASE_SEPOLIA_DEPLOYMENT.vault, abi: VAULT, functionName: "claimOf", args: [instrument.id, borrower], blockNumber }), client.readContract({ address: admitted.oracle, abi: ORACLE, functionName: "priceUsd18", args: [instrument.id], blockNumber }), client.readContract({ address: admitted.session, abi: SESSIONS, functionName: "sessionOf", args: [instrument.id, block.timestamp], blockNumber })]);
      return { id: instrument.id, symbol: instrument.symbol, rawClaim: rawClaim.toString(), oraclePriceUsd18: price[0].toString(), oracleUpdatedAt: price[1].toString(), oracleAgeSeconds: (block.timestamp - price[1]).toString(), oracleLive: price[2], session: SESSION[Number(session)] ?? "UNKNOWN", admitted: admitted.admitted };
    }));
    const observedAt = new Date(Number(block.timestamp) * 1_000).toISOString();
    const common = { observedAt, observedAtBlock: blockNumber.toString(), chainId: BASE_SEPOLIA_DEPLOYMENT.chainId };
    const facility = { status: STATUS[Number(status)] ?? "UNKNOWN", debtUsd18: debt.toString(), riskEpoch: riskEpoch.toString(), policyVersion: meta[0].toString(), policyStatus: POLICY[Number(meta[2])] ?? "UNKNOWN", instruments };
    const outcome = classifyBaseRead({ admittedCount, expectedInstrumentCount: BASE_SEPOLIA_DEPLOYMENT.instruments.length, allLive: quote[4], instrumentLive: instruments.every((instrument) => instrument.admitted && instrument.oracleLive && instrument.session !== "UNKNOWN"), policyExists: meta[5] });
    if (outcome === "PORTFOLIO_UNKNOWN") return { ...common, outcome, reason: "The live admission or policy record is incomplete; current portfolio values and capacity are withheld." };
    if (outcome === "STALE") return { ...common, outcome, reason: "One or more market inputs are stale or restricted; recognised value and draw capacity are withheld.", facility };
    return { ...common, outcome, provenance: { facilityAddress: address, facilityType: "PortfolioRevolvingCredit", rpc: RPC }, facility: { ...facility, recognisedValueUsd18: quote[0].toString(), maxDebtUsd18: quote[1].toString(), availableCapacityUsd18: quote[2].toString(), snapshotDigest: quote[3] } };
  } catch (error) { return { outcome: "UNAVAILABLE", reason: (error as Error).message.slice(0, 220) }; }
}

function unknown(blockNumber: bigint, reason: string): BaseFacilityRead { return { outcome: "PORTFOLIO_UNKNOWN", observedAt: new Date().toISOString(), observedAtBlock: blockNumber.toString(), chainId: BASE_SEPOLIA_DEPLOYMENT.chainId, reason }; }

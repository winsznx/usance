import { createPublicClient, http } from "viem";
import deployment from "../../../docs/ethonline-2026/proof/hedera-facility-deployment.json";

const RPC = "https://testnet.hashio.io/api";

const ORACLE_ABI = [
  { name: "getPrice", type: "function", stateMutability: "view", inputs: [{ type: "bytes32" }], outputs: [{ type: "uint256" }, { type: "uint64" }] },
] as const;
const ASSET_REGISTRY_ABI = [
  { name: "getAsset", type: "function", stateMutability: "view", inputs: [{ type: "bytes32" }], outputs: [{ type: "tuple", components: [
    { name: "token", type: "address" }, { name: "chainId", type: "uint256" }, { name: "underlyingId", type: "bytes32" },
    { name: "decimals", type: "uint8" }, { name: "status", type: "uint8" }, { name: "passportVersion", type: "uint64" },
    { name: "riskPolicyId", type: "bytes32" }, { name: "capabilities", type: "uint16" },
  ] }] },
] as const;
const RISK_POLICY_ABI = [
  { name: "getParams", type: "function", stateMutability: "view", inputs: [{ type: "bytes32" }], outputs: [{ type: "tuple", components: [
    { name: "initialLtvBps", type: "uint16" }, { name: "maintenanceLtvBps", type: "uint16" }, { name: "liquidationLtvBps", type: "uint16" },
    { name: "maxConcentrationBps", type: "uint16" }, { name: "haircutMarketBps", type: "uint16" }, { name: "haircutLiquidityBps", type: "uint16" },
    { name: "haircutIssuerBps", type: "uint16" }, { name: "haircutSettlementBps", type: "uint16" }, { name: "haircutCrosschainBps", type: "uint16" },
    { name: "maxOracleAge", type: "uint64" }, { name: "maxPassportAge", type: "uint64" },
  ] }] },
] as const;

/**
 * The facility gates on TWO independent oracle inputs before `releaseOld` succeeds
 * (`FacilityValuation.toUsd18` for the settlement feed, `RiskMath.assetGates` for the replacement
 * collateral's own mark) — proven live when a substitution released cleanly through the settlement
 * check only to then hit `CoverageFailed` because the replacement asset's own price was
 * independently stale. This module surfaces both, separately, so a caller can see which one (if
 * either) is stale before attempting `releaseOld` — it never claims to replace the facility's own
 * `_assertReleasable` check, which remains the sole financial authority.
 */
export type PriceInputStatus = "READY" | "STALE" | "UNAVAILABLE" | "UNKNOWN";

export type PriceInputReadiness = {
  status: PriceInputStatus;
  assetId: `0x${string}`;
  price: string | null;
  updatedAt: string | null;
  ageSeconds: number | null;
  maxAgeSeconds: number | null;
  source: "HederaTestOracleAdapter";
  provenance: "TEST_ONLY_FIXED_MARK";
};

export type ValuationReadiness = {
  observedAt: string;
  settlementPrice: PriceInputReadiness;
  replacementCollateralPrice: PriceInputReadiness;
  /** True only when BOTH inputs read READY. This is a preparation signal, never an authoritative
   *  release-eligibility claim — the facility's own `releaseOld` simulation is final. */
  allInputsReady: boolean;
};

async function readPriceInput(
  oracle: `0x${string}`,
  assetId: `0x${string}`,
  maxAgeSeconds: number | null,
): Promise<PriceInputReadiness> {
  const client = createPublicClient({ transport: http(RPC, { timeout: 12_000, retryCount: 1 }) });
  try {
    const [price, updatedAt] = await client.readContract({ address: oracle, abi: ORACLE_ABI, functionName: "getPrice", args: [assetId] });
    if (price === 0n) return { status: "UNAVAILABLE", assetId, price: "0", updatedAt: updatedAt.toString(), ageSeconds: null, maxAgeSeconds, source: "HederaTestOracleAdapter", provenance: "TEST_ONLY_FIXED_MARK" };
    const age = Math.floor(Date.now() / 1000) - Number(updatedAt);
    const status: PriceInputStatus = maxAgeSeconds === null ? "UNKNOWN" : age > maxAgeSeconds ? "STALE" : "READY";
    return { status, assetId, price: price.toString(), updatedAt: updatedAt.toString(), ageSeconds: age, maxAgeSeconds, source: "HederaTestOracleAdapter", provenance: "TEST_ONLY_FIXED_MARK" };
  } catch {
    return { status: "UNKNOWN", assetId, price: null, updatedAt: null, ageSeconds: null, maxAgeSeconds, source: "HederaTestOracleAdapter", provenance: "TEST_ONLY_FIXED_MARK" };
  }
}

/** The replacement asset's own max-oracle-age comes from its registered risk policy
 *  (`RiskPolicyRegistry.getParams(asset.riskPolicyId).maxOracleAge`) — the exact gate
 *  `RiskMath.assetGates` enforces — not the settlement feed's `settlementMaxPriceAge`. */
async function readReplacementMaxAge(replacementAssetId: `0x${string}`): Promise<number | null> {
  const client = createPublicClient({ transport: http(RPC, { timeout: 12_000, retryCount: 1 }) });
  try {
    const asset = await client.readContract({ address: deployment.contracts.AssetRegistry as `0x${string}`, abi: ASSET_REGISTRY_ABI, functionName: "getAsset", args: [replacementAssetId] });
    const params = await client.readContract({ address: deployment.contracts.RiskPolicyRegistry as `0x${string}`, abi: RISK_POLICY_ABI, functionName: "getParams", args: [asset.riskPolicyId] });
    return Number(params.maxOracleAge);
  } catch {
    return null;
  }
}

export async function readValuationReadiness(replacementAssetId: `0x${string}`): Promise<ValuationReadiness> {
  const oracle = deployment.contracts.HederaTestOracleAdapter as `0x${string}`;
  const settlementAssetId = deployment.terms.settlementAssetId as `0x${string}`;
  const settlementMaxAge = Number(deployment.terms.settlementMaxPriceAge);
  const replacementMaxAge = await readReplacementMaxAge(replacementAssetId);

  const [settlementPrice, replacementCollateralPrice] = await Promise.all([
    readPriceInput(oracle, settlementAssetId, settlementMaxAge),
    readPriceInput(oracle, replacementAssetId, replacementMaxAge),
  ]);

  return {
    observedAt: new Date().toISOString(),
    settlementPrice,
    replacementCollateralPrice,
    allInputsReady: settlementPrice.status === "READY" && replacementCollateralPrice.status === "READY",
  };
}

import { chainById, type ChainConfig } from "@usance/xlayer";

/**
 * Deployment manifests.
 *
 * The app refuses to invent addresses. If a chain has no manifest under `deployments/`, every
 * write path is disabled and the UI says so in plain language rather than rendering a portfolio
 * full of zeroes that looks like a working product with no money in it.
 */

export interface Deployment {
  chainId: number;
  deployedAt: string;
  commit: string;
  contracts: {
    authority: `0x${string}`;
    assetRegistry: `0x${string}`;
    evidenceRegistry: `0x${string}`;
    passportRegistry: `0x${string}`;
    riskPolicyRegistry: `0x${string}`;
    collateralVault: `0x${string}`;
    liquidityVault: `0x${string}`;
    financingEngine: `0x${string}`;
    clearingHouse: `0x${string}`;
    oracleAdapter: `0x${string}`;
    /**
     * Modules a deployment may or may not carry.
     *
     * Optional rather than required, because a manifest generated before a module existed is still
     * a valid manifest for the deployment it describes. A page that assumed presence would crash on
     * exactly the historical records the freshness rules exist to preserve.
     */
    feeController?: `0x${string}`;
    mandateRegistry?: `0x${string}`;
    intentBook?: `0x${string}`;
    delegationGateway?: `0x${string}`;
    sentinelTemplateRegistry?: `0x${string}`;
    sentinelInstanceRegistry?: `0x${string}`;
  };
  assets: Array<{
    assetId: `0x${string}`;
    symbol: string;
    name: string;
    token: `0x${string}`;
    decimals: number;
    isTestFixture: boolean;
  }>;
  settlementAsset: { assetId: `0x${string}`; symbol: string; token: `0x${string}`; decimals: number };
}

/**
 * A chain with no deployment is a legitimate state, not an error — and it must not be a build
 * failure either, which is why this reads a generated record rather than importing a JSON file
 * that only exists after a broadcast.
 */
export async function loadDeployment(chainId: number): Promise<Deployment | null> {
  const { deployments } = await import("../../../deployments/manifest");
  return (deployments[chainId] as Deployment | undefined) ?? null;
}

export function activeChain(): ChainConfig {
  const id = Number(process.env["NEXT_PUBLIC_XLAYER_CHAIN_ID"] ?? 1952);
  const c = chainById(id);
  if (!c) throw new Error(`NEXT_PUBLIC_XLAYER_CHAIN_ID is not an X Layer chain: ${id}`);
  return c;
}

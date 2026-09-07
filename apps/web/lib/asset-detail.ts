import { createPublicClient, http, type Address } from "viem";
import { activeChain, loadDeployment } from "./deployments";
import { loadAccount, type AccountView, type PositionAsset } from "./account";

/**
 * One asset, seen from one account.
 *
 * The overview shows every holding as a row. This answers the questions a row cannot: how many
 * units are actually in custody, what the asset resolves to under Phase 01, and which single
 * number out of four a reader should act on.
 *
 * The account read and the custody read are taken at the same block as each other where possible,
 * for the same reason `loadAccount` pins its own reads: a units figure from one block against a
 * recognised value from another is two answers to one question.
 */

const VAULT_ABI = [
  { name: "balanceOf", type: "function", stateMutability: "view", inputs: [{ type: "bytes32" }, { type: "address" }], outputs: [{ type: "uint256" }] },
  { name: "totalDeposited", type: "function", stateMutability: "view", inputs: [{ type: "bytes32" }], outputs: [{ type: "uint256" }] },
] as const;

export interface AssetDetailView {
  account: Address;
  chainId: number;
  assetId: `0x${string}`;
  /** Present when the manifest knows this asset. Fixtures may not carry a token address. */
  token: `0x${string}` | null;
  symbol: string | null;
  name: string | null;
  decimals: number | null;
  isTestFixture: boolean;
  isSettlementAsset: boolean;
  /** Units in custody for this account, in token decimals. */
  depositedUnits: bigint;
  totalDeposited: bigint;
  /** The account-wide figures, so the page never implies "available to borrow" is per-asset. */
  account_debt: bigint;
  account_availableBorrow: bigint;
  account_recognized: bigint;
  reserved: bigint;
  status: AccountView["status"];
  riskEpoch: number;
  /** This asset's contribution, from `accountHealth`. Zero if the account holds none. */
  position: PositionAsset | null;
}

export type AssetDetailLookup =
  | { outcome: "OK"; view: AssetDetailView }
  | { outcome: "NOT_DEPLOYED" }
  | { outcome: "UNKNOWN_ASSET" }
  | { outcome: "UNREADABLE"; reason: string };

export async function loadAssetDetail(account: Address, assetId: string): Promise<AssetDetailLookup> {
  const chain = activeChain();
  const deployment = await loadDeployment(chain.id);
  if (!deployment) return { outcome: "NOT_DEPLOYED" };

  const wanted = assetId.toLowerCase();
  const manifestAsset = deployment.assets.find((a) => a.assetId.toLowerCase() === wanted);
  const isSettlementAsset = deployment.settlementAsset.assetId.toLowerCase() === wanted;
  if (!manifestAsset && !isSettlementAsset) return { outcome: "UNKNOWN_ASSET" };

  const account_lookup = await loadAccount(account);
  if (account_lookup.outcome === "NOT_DEPLOYED") return { outcome: "NOT_DEPLOYED" };
  if (account_lookup.outcome === "UNREADABLE") return { outcome: "UNREADABLE", reason: account_lookup.reason };
  const view = account_lookup.view;

  const client = createPublicClient({
    transport: http(chain.rpcUrl, { retryCount: 3, retryDelay: 1200, timeout: 30_000 }),
  });

  try {
    const at = { address: deployment.contracts.collateralVault as Address, abi: VAULT_ABI, blockNumber: view.blockNumber } as const;
    const [depositedUnits, totalDeposited] = await Promise.all([
      client.readContract({ ...at, functionName: "balanceOf", args: [wanted as `0x${string}`, account] }),
      client.readContract({ ...at, functionName: "totalDeposited", args: [wanted as `0x${string}`] }),
    ]);

    const position = view.assets.find((a) => a.assetId.toLowerCase() === wanted) ?? null;
    const settlement = deployment.settlementAsset;

    return {
      outcome: "OK",
      view: {
        account,
        chainId: chain.id,
        assetId: wanted as `0x${string}`,
        token: manifestAsset?.token ?? (isSettlementAsset ? settlement.token : null),
        symbol: manifestAsset?.symbol ?? (isSettlementAsset ? settlement.symbol : null),
        name: manifestAsset?.name ?? (isSettlementAsset ? settlement.symbol : null),
        decimals: manifestAsset?.decimals ?? (isSettlementAsset ? settlement.decimals : null),
        isTestFixture: manifestAsset?.isTestFixture ?? isSettlementAsset,
        isSettlementAsset,
        depositedUnits,
        totalDeposited,
        account_debt: view.debt,
        account_availableBorrow: view.availableBorrow,
        account_recognized: view.recognized,
        reserved: view.reserved,
        status: view.status,
        riskEpoch: view.riskEpoch,
        position,
      },
    };
  } catch (e) {
    return { outcome: "UNREADABLE", reason: (e as Error).message.slice(0, 160) };
  }
}

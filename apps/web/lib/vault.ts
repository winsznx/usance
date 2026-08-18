import { createPublicClient, http, type Address } from "viem";
import { activeChain, loadDeployment } from "./deployments";

/**
 * Lender-side vault state, read from the deployed contract.
 *
 * Every number here is read back from chain. There is no modelled APY: a yield figure a frontend
 * computed is a yield figure nobody has to honour, and the one number a lender actually needs —
 * what they can get out today — is a balance, not a projection.
 *
 * Where a figure genuinely cannot be produced, the field is null and the UI says so rather than
 * showing a zero that reads like a fact.
 */

export const VAULT_ABI = [
  { name: "asset", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { name: "decimals", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
  { name: "totalSupply", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { name: "totalAssets", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { name: "availableCash", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { name: "totalPrincipal", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { name: "accruedReceivables", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { name: "reserves", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { name: "badDebt", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { name: "utilizationBps", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { name: "queuedLiabilities", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { name: "queuedFunded", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { name: "balanceOf", type: "function", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
  { name: "maxWithdraw", type: "function", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
  { name: "convertToAssets", type: "function", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "uint256" }] },
  {
    name: "withdrawalRequests",
    type: "function",
    stateMutability: "view",
    inputs: [{ type: "uint256" }],
    outputs: [
      { type: "address" }, { type: "uint256" }, { type: "uint256" },
      { type: "uint256" }, { type: "uint64" }, { type: "bool" },
    ],
  },
  { name: "nextRequestId", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
] as const;

const RATE_ABI = [
  {
    name: "rate",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }, { type: "uint256" }, { type: "uint16" }, { type: "uint16" }, { type: "uint16" }],
  },
] as const;

export interface VaultView {
  address: Address;
  chainId: number;
  settlementSymbol: string;
  decimals: number;

  totalSupplied: bigint;
  availableCash: bigint;
  deployedPrincipal: bigint;
  accruedReceivables: bigint;
  reserves: bigint;
  badDebt: bigint;
  utilizationBps: number;

  /** Null when the deployed vault predates the withdrawal queue. */
  queuedLiabilities: bigint | null;
  queuedFunded: bigint | null;

  /**
   * Gross borrower rate in bps, and the protocol's share of it.
   *
   * Lender yield is the residual, and it is stated as a rate the borrower is currently being
   * charged rather than as a projection of what a lender will earn. Those are different claims: the
   * borrow rate is a fact about the contract right now, and realised lender yield also depends on
   * utilisation and on whether the debt is repaid.
   */
  borrowRateBps: number | null;
  protocolShareBps: number | null;
  lenderShareBps: number | null;
}

export interface LenderPosition {
  shares: bigint;
  value: bigint;
  withdrawableNow: bigint;
  requests: Array<{
    id: number;
    shares: bigint;
    amount: bigint;
    funded: bigint;
    requestedAt: number;
    claimed: boolean;
    claimable: boolean;
  }>;
}

function client() {
  const chain = activeChain();
  return createPublicClient({ transport: http(chain.rpcUrl, { retryCount: 3, retryDelay: 1200, timeout: 30_000 }) });
}

export async function loadVault(): Promise<VaultView | null> {
  const chain = activeChain();
  const deployment = await loadDeployment(chain.id);
  if (!deployment) return null;

  const c = client();
  const vault = deployment.contracts.liquidityVault as Address;
  const at = { address: vault, abi: VAULT_ABI } as const;

  const [
    decimals, totalSupplied, availableCash, deployedPrincipal,
    accruedReceivables, reserves, badDebt, utilizationBps, queuedLiabilities, queuedFunded,
  ] = await Promise.all([
    c.readContract({ ...at, functionName: "decimals" }),
    c.readContract({ ...at, functionName: "totalAssets" }),
    c.readContract({ ...at, functionName: "availableCash" }),
    c.readContract({ ...at, functionName: "totalPrincipal" }),
    c.readContract({ ...at, functionName: "accruedReceivables" }),
    c.readContract({ ...at, functionName: "reserves" }),
    c.readContract({ ...at, functionName: "badDebt" }),
    c.readContract({ ...at, functionName: "utilizationBps" }),
    // Tolerated rather than assumed. A vault deployed before the withdrawal queue existed has no
    // such function, and the honest reading of that is "this deployment has no queue" — not a
    // crashed page. The drift gate is what stops the repo and the chain diverging for long; this is
    // what keeps the page truthful in the window where they have.
    c.readContract({ ...at, functionName: "queuedLiabilities" }).catch(() => null),
    c.readContract({ ...at, functionName: "queuedFunded" }).catch(() => null),
  ]);

  // The rate is read from FinancingEngine, not modelled here. If it cannot be read the fields stay
  // null and the page says the rate is unavailable — better than a number the contract disagrees with.
  let borrowRateBps: number | null = null;
  let protocolShareBps: number | null = null;
  try {
    const r = (await c.readContract({
      address: deployment.contracts.financingEngine as Address,
      abi: RATE_ABI,
      functionName: "rate",
    })) as readonly [bigint, bigint, number, number, number];
    borrowRateBps = Number(r[2]);
    protocolShareBps = Number(r[4]);
  } catch {
    // Left null on purpose.
  }

  return {
    address: vault,
    chainId: chain.id,
    settlementSymbol: deployment.settlementAsset.symbol,
    decimals: Number(decimals),
    totalSupplied, availableCash, deployedPrincipal, accruedReceivables,
    reserves, badDebt,
    utilizationBps: Number(utilizationBps),
    queuedLiabilities, queuedFunded,
    borrowRateBps,
    protocolShareBps,
    lenderShareBps: borrowRateBps !== null && protocolShareBps !== null
      ? Math.round((borrowRateBps * (10_000 - protocolShareBps)) / 10_000)
      : null,
  };
}

export async function loadPosition(account: Address): Promise<LenderPosition | null> {
  const chain = activeChain();
  const deployment = await loadDeployment(chain.id);
  if (!deployment) return null;

  const c = client();
  const vault = deployment.contracts.liquidityVault as Address;
  const at = { address: vault, abi: VAULT_ABI } as const;

  const [shares, withdrawableNow, nextId] = await Promise.all([
    c.readContract({ ...at, functionName: "balanceOf", args: [account] }),
    c.readContract({ ...at, functionName: "maxWithdraw", args: [account] }),
    c.readContract({ ...at, functionName: "nextRequestId" }),
  ]);
  const value = shares > 0n
    ? await c.readContract({ ...at, functionName: "convertToAssets", args: [shares] })
    : 0n;

  // Walked rather than indexed. Honest about what this is: without an indexer the only way to find
  // a lender's requests is to read them, and the page says so rather than implying a backend exists.
  const requests: LenderPosition["requests"] = [];
  const scanFrom = nextId > 200n ? nextId - 200n : 1n;
  for (let id = scanFrom; id < nextId; id++) {
    const r = await c.readContract({ ...at, functionName: "withdrawalRequests", args: [id] });
    if (r[0].toLowerCase() !== account.toLowerCase()) continue;
    requests.push({
      id: Number(id),
      shares: r[1], amount: r[2], funded: r[3],
      requestedAt: Number(r[4]),
      claimed: r[5],
      claimable: !r[5] && r[3] >= r[2],
    });
  }

  return { shares, value, withdrawableNow, requests };
}

import { createPublicClient, http, parseAbi, type Address } from "viem";
import type { AccountStatus } from "@usance/domain";
import { activeChain, loadDeployment, type Deployment } from "./deployments";

/**
 * Authoritative quotes, read from the deployed contracts.
 *
 * The frontend computes no financial truth. Every number below is read from the chain or derived
 * from numbers read from the chain, and where a derivation is unavoidable it is marked. A browser
 * that reimplements the risk pipeline is a second implementation that will disagree with the
 * contract, and the contract is the one that decides.
 *
 * Every quote carries the risk epoch it was produced under. A transaction quoted under one epoch
 * reverts under another, so the epoch is not decoration — it is the field that makes a stale
 * preview refuse rather than execute under rules the user never saw.
 */

const CH = parseAbi([
  "function accountHealth(address) view returns ((uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint8,uint32),(bytes32,uint256,uint256,uint256,uint256,uint256,uint256)[])",
  "function availableBorrow(address) view returns (uint256,bool)",
  "function settlementFreshness() view returns (bool,uint64)",
  "function settlementAssetId() view returns (bytes32)",
]);
const RP = parseAbi(["function riskEpoch() view returns (uint64)"]);
const PR = parseAbi(["function currentVersion(bytes32) view returns (uint64)"]);
const ORACLE = parseAbi(["function getPrice(bytes32) view returns (uint256,uint64)"]);
const LV = parseAbi(["function availableCash() view returns (uint256)"]);
const ERC20 = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
]);

export const STATUS_ORDER: readonly AccountStatus[] = [
  "NORMAL", "NO_NEW_RISK", "REDUCE_ONLY", "MARGIN_CALL", "LIQUIDATING", "SETTLED", "BAD_DEBT",
];

/** How long a preview stays valid before it is re-fetched, absent an epoch change. */
export const QUOTE_TTL_SECONDS = 30;

export type QuoteAction = "BORROW" | "REPAY" | "ADD_COLLATERAL" | "WITHDRAW";

export interface Quote {
  chainId: number;
  account: Address;
  assetId: `0x${string}` | null;
  action: QuoteAction;

  passportVersion: number | null;
  riskEpoch: bigint;

  oracleUpdatedAt: number | null;
  oracleFreshness: { configured: boolean; maxAgeSeconds: number; ageSeconds: number | null; stale: boolean };

  amountUsd: bigint;

  recognisedBefore: bigint;
  recognisedAfter: bigint;
  debtBefore: bigint;
  debtAfter: bigint;
  availableBorrowBefore: bigint;
  availableBorrowAfter: bigint;
  statusBefore: AccountStatus;
  statusAfter: AccountStatus;

  maintenanceLimit: bigint;
  liquidationLimit: bigint;
  protocolLiquidity: bigint;
  limitedByLiquidity: boolean;

  walletBalance: bigint;
  allowance: bigint;

  createdAt: number;
  expiresAt: number;
}

export class DeploymentMismatch extends Error {
  readonly code = "DEPLOYMENT_MISMATCH";
  constructor(expected: string, actual: string) {
    super(
      `The app is configured for ClearingHouse ${expected} but the manifest points at ${actual}. ` +
        "Refusing to quote against a deployment this build was not verified against.",
    );
    this.name = "DeploymentMismatch";
  }
}

function client() {
  const chain = activeChain();
  return createPublicClient({
    transport: http(chain.rpcUrl, { retryCount: 3, retryDelay: 1200, timeout: 30_000 }),
  });
}

/**
 * Read the account and the policy that governs it.
 *
 * `statusAfter` is projected from the same thresholds the contract uses rather than by simulating
 * the transaction, and that is a real limitation rather than an equivalence: the contract's
 * `accountHealth` folds in gates the projection cannot see. It is marked as a preview everywhere it
 * surfaces, and the epoch stamp is what protects a user from acting on it after policy has moved.
 */
export async function quoteFor(
  account: Address,
  action: QuoteAction,
  amountUsd: bigint,
  assetId?: `0x${string}`,
): Promise<Quote> {
  const chain = activeChain();
  const deployment = await loadDeployment(chain.id);
  if (!deployment) throw new Error(`Usance is not deployed on ${chain.name}`);

  const pub = client();
  const C = deployment.contracts;

  const [health, availableTuple, epoch, freshness, liquidity] = await Promise.all([
    pub.readContract({ address: C.clearingHouse as Address, abi: CH, functionName: "accountHealth", args: [account] }),
    pub.readContract({ address: C.clearingHouse as Address, abi: CH, functionName: "availableBorrow", args: [account] }),
    pub.readContract({ address: C.riskPolicyRegistry as Address, abi: RP, functionName: "riskEpoch" }),
    pub.readContract({ address: C.clearingHouse as Address, abi: CH, functionName: "settlementFreshness" }),
    pub.readContract({ address: C.liquidityVault as Address, abi: LV, functionName: "availableCash" }),
  ]);

  const [r] = health as unknown as [readonly bigint[] & { 7: number }];
  const recognised = r[0] as bigint;
  const borrowLimit = r[1] as bigint;
  const maintenanceLimit = r[2] as bigint;
  const liquidationLimit = r[3] as bigint;
  const debt = r[4] as bigint;
  const statusBefore = STATUS_ORDER[Number(r[7])] ?? "NORMAL";
  const [available, limitedByLiquidity] = availableTuple as unknown as [bigint, boolean];
  const [configured, maxAge] = freshness as unknown as [boolean, bigint];

  const asset = assetId ?? (deployment.assets[0]?.assetId as `0x${string}` | undefined) ?? null;

  let oracleUpdatedAt: number | null = null;
  let passportVersion: number | null = null;
  if (asset) {
    const [, updatedAt] = (await pub.readContract({
      address: C.oracleAdapter as Address, abi: ORACLE, functionName: "getPrice", args: [asset],
    })) as unknown as [bigint, bigint];
    oracleUpdatedAt = Number(updatedAt) || null;
    passportVersion = Number(
      await pub.readContract({ address: C.passportRegistry as Address, abi: PR, functionName: "currentVersion", args: [asset] }),
    ) || null;
  }

  const now = Math.floor(Date.now() / 1000);
  const ageSeconds = oracleUpdatedAt === null ? null : Math.max(0, now - oracleUpdatedAt);

  const settlement = deployment.settlementAsset.token as Address | null;
  let walletBalance = 0n;
  let allowance = 0n;
  if (settlement) {
    [walletBalance, allowance] = (await Promise.all([
      pub.readContract({ address: settlement, abi: ERC20, functionName: "balanceOf", args: [account] }),
      pub.readContract({ address: settlement, abi: ERC20, functionName: "allowance", args: [account, C.clearingHouse as Address] }),
    ])) as [bigint, bigint];
  }

  const debtAfter =
    action === "BORROW" ? debt + amountUsd : action === "REPAY" ? (debt > amountUsd ? debt - amountUsd : 0n) : debt;
  const recognisedAfter =
    action === "ADD_COLLATERAL" ? recognised + amountUsd : action === "WITHDRAW" ? (recognised > amountUsd ? recognised - amountUsd : 0n) : recognised;

  return {
    chainId: chain.id,
    account,
    assetId: asset,
    action,
    passportVersion,
    riskEpoch: epoch as bigint,
    oracleUpdatedAt,
    oracleFreshness: {
      configured: configured,
      maxAgeSeconds: Number(maxAge),
      ageSeconds,
      stale: configured && ageSeconds !== null && ageSeconds > Number(maxAge),
    },
    amountUsd,
    recognisedBefore: recognised,
    recognisedAfter,
    debtBefore: debt,
    debtAfter,
    availableBorrowBefore: available,
    availableBorrowAfter: borrowLimit > debtAfter ? borrowLimit - debtAfter : 0n,
    statusBefore,
    statusAfter: projectStatus(debtAfter, borrowLimit, maintenanceLimit, liquidationLimit, statusBefore),
    maintenanceLimit,
    liquidationLimit,
    protocolLiquidity: liquidity as bigint,
    limitedByLiquidity,
    walletBalance,
    allowance,
    createdAt: now,
    expiresAt: now + QUOTE_TTL_SECONDS,
  };
}

/**
 * The status thresholds, applied to a projected debt.
 *
 * Never lowers the status below what the chain currently reports. A gate the projection cannot see
 * — a stale oracle, a suspended asset, a paused feed — is holding the account where it is, and a
 * preview that cheerfully showed "Healthy" because the arithmetic worked would be telling the user
 * a transaction will succeed that the contract is going to refuse.
 */
export function projectStatus(
  debt: bigint,
  borrowLimit: bigint,
  maintenanceLimit: bigint,
  liquidationLimit: bigint,
  floor: AccountStatus,
): AccountStatus {
  const base: AccountStatus =
    debt === 0n || debt <= borrowLimit
      ? "NORMAL"
      : debt <= maintenanceLimit
        ? "NO_NEW_RISK"
        : debt <= liquidationLimit
          ? "REDUCE_ONLY"
          : "MARGIN_CALL";

  return STATUS_ORDER.indexOf(base) > STATUS_ORDER.indexOf(floor) ? base : floor;
}

/** A quote is dead once policy moves, whatever the clock says. */
export function quoteIsValid(q: Quote, currentEpoch: bigint, now = Math.floor(Date.now() / 1000)): boolean {
  return q.riskEpoch === currentEpoch && now < q.expiresAt;
}

export function quoteInvalidReason(q: Quote, currentEpoch: bigint, now = Math.floor(Date.now() / 1000)): string | null {
  if (q.riskEpoch !== currentEpoch) {
    return "Risk conditions changed. Review the updated values before signing.";
  }
  if (now >= q.expiresAt) return "This quote has expired. Refreshing it now.";
  return null;
}

/**
 * Refuse to quote against a deployment this build was not verified against.
 *
 * The manifest is generated from a broadcast and the app imports it, so a mismatch means the app
 * and the chain have diverged — which is the same stale-artifact failure that has bitten this repo
 * three times, arriving through the frontend instead.
 */
export function assertDeploymentMatches(deployment: Deployment, expectedClearingHouse: string): void {
  if (deployment.contracts.clearingHouse.toLowerCase() !== expectedClearingHouse.toLowerCase()) {
    throw new DeploymentMismatch(expectedClearingHouse, deployment.contracts.clearingHouse);
  }
}

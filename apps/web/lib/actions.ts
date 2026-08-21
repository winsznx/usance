"use client";

import { createPublicClient, http, parseAbi, type Abi, type Address, type PublicClient } from "viem";
import type { AccountStatus } from "@usance/domain";
import { activeChain, loadDeployment } from "./deployments";
import { loadAccount } from "./account";
import { readSession } from "./session";

/**
 * The read + write plumbing for the four account actions.
 *
 * Reads are live from the deployed contracts (through `loadAccount` plus a few targeted calls).
 * Writes go through the shared `sendTransaction` funnel at the call site; this module only supplies
 * the ABIs, the addresses, and the two conversions that are easy to get wrong: which contract to
 * approve, and USD18 ↔ token units. Settlement is a $1-pegged unit of account, so the conversion is
 * a decimals rescale — and it always rounds *up* for an approval, because an allowance that is one
 * unit short reverts the very transaction it was meant to permit.
 */

export const ERC20_ABI = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
]);

/**
 * ClearingHouse write surface, plus its custom errors so `sendTransaction` can decode a revert into
 * the exact sentence the contract already knows (your limit is X, the safe maximum is Y).
 */
export const CH_ACTION_ABI = [
  { type: "function", name: "addCollateral", stateMutability: "nonpayable", inputs: [{ name: "assetId", type: "bytes32" }, { name: "amount", type: "uint256" }], outputs: [] },
  { type: "function", name: "withdrawCollateral", stateMutability: "nonpayable", inputs: [{ name: "assetId", type: "bytes32" }, { name: "amount", type: "uint256" }], outputs: [] },
  { type: "function", name: "borrow", stateMutability: "nonpayable", inputs: [{ name: "amountUsd18", type: "uint256" }, { name: "expectedEpoch", type: "uint64" }], outputs: [] },
  { type: "function", name: "repay", stateMutability: "nonpayable", inputs: [{ name: "amountUsd18", type: "uint256" }, { name: "repayAll", type: "bool" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "maxWithdrawable", stateMutability: "view", inputs: [{ type: "address" }, { type: "bytes32" }], outputs: [{ type: "uint256" }] },
  { type: "error", name: "RiskLimitExceeded", inputs: [{ type: "uint256" }, { type: "uint256" }] },
  { type: "error", name: "AccountNotHealthy", inputs: [{ type: "uint8" }] },
  { type: "error", name: "WithdrawWouldBreachMaintenance", inputs: [{ type: "uint256" }] },
  { type: "error", name: "StaleRiskEpoch", inputs: [{ type: "uint64" }, { type: "uint64" }] },
  { type: "error", name: "InsufficientProtocolLiquidity", inputs: [{ type: "uint256" }, { type: "uint256" }] },
  { type: "error", name: "ReservationOutstanding", inputs: [] },
  { type: "error", name: "AssetNotCollateral", inputs: [{ type: "bytes32" }] },
  { type: "error", name: "NoDebt", inputs: [] },
  { type: "error", name: "ZeroAmount", inputs: [] },
  { type: "error", name: "BorrowTooSmall", inputs: [{ type: "uint256" }] },
] as const satisfies Abi;

const LV_ABI = parseAbi(["function availableCash() view returns (uint256)"]);
const CV_ABI = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "bytes32" }, { type: "address" }], outputs: [{ type: "uint256" }] },
] as const;
const FE_ABI = [
  { type: "function", name: "rate", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }, { type: "uint256" }, { type: "uint16" }, { type: "uint16" }, { type: "uint16" }] },
] as const;

function pub(): PublicClient {
  const chain = activeChain();
  return createPublicClient({ transport: http(chain.rpcUrl, { retryCount: 3, retryDelay: 1200, timeout: 30_000 }) });
}

/** USD18 → token units at a $1 settlement, rounded up. Never approve or expect too few. */
export function usd18ToToken(usd18: bigint, decimals: number): bigint {
  if (decimals >= 18) return usd18 * 10n ** BigInt(decimals - 18);
  const div = 10n ** BigInt(18 - decimals);
  return (usd18 + div - 1n) / div;
}

/** token units → USD18 at a $1 settlement. */
export function tokenToUsd18(amount: bigint, decimals: number): bigint {
  if (decimals >= 18) return amount / 10n ** BigInt(decimals - 18);
  return amount * 10n ** BigInt(18 - decimals);
}

/** The signed-in address, or null when this browser has no active session. */
export async function connectedAccount(): Promise<Address | null> {
  const s = await readSession();
  return s.status === "ACTIVE" ? s.address : null;
}

// ---------------------------------------------------------------- add collateral

export interface AddQuote {
  clearingHouse: Address; collateralVault: Address; token: Address;
  assetId: `0x${string}`; symbol: string; decimals: number;
  walletBalance: bigint; allowance: bigint;
}

export async function addCollateralQuote(user: Address): Promise<AddQuote | null> {
  const d = await loadDeployment(activeChain().id);
  const asset = d?.assets[0];
  if (!d || !asset) return null;
  const collateralVault = d.contracts.collateralVault as Address;
  const c = pub();
  const [walletBalance, allowance] = await Promise.all([
    c.readContract({ address: asset.token, abi: ERC20_ABI, functionName: "balanceOf", args: [user] }),
    c.readContract({ address: asset.token, abi: ERC20_ABI, functionName: "allowance", args: [user, collateralVault] }),
  ]);
  return {
    clearingHouse: d.contracts.clearingHouse as Address, collateralVault, token: asset.token,
    assetId: asset.assetId, symbol: asset.symbol, decimals: asset.decimals, walletBalance, allowance,
  };
}

// ---------------------------------------------------------------- borrow

export interface BorrowQuote {
  clearingHouse: Address;
  byRisk: bigint; byLiquidity: bigint; limitedByLiquidity: boolean;
  debtNow: bigint; borrowLimit: bigint; maintenanceLimit: bigint;
  rateBps: number | null; epoch: number; status: AccountStatus; settlementSymbol: string;
}

export async function borrowQuote(user: Address): Promise<BorrowQuote | null> {
  const d = await loadDeployment(activeChain().id);
  if (!d) return null;
  const acc = await loadAccount(user);
  if (acc.outcome !== "OK") return null;
  const v = acc.view;
  const c = pub();
  const cashTokens = await c.readContract({ address: d.contracts.liquidityVault as Address, abi: LV_ABI, functionName: "availableCash" });
  const byLiquidity = tokenToUsd18(cashTokens, d.settlementAsset.decimals);
  let rateBps: number | null = null;
  try {
    const r = (await c.readContract({ address: d.contracts.financingEngine as Address, abi: FE_ABI, functionName: "rate" })) as readonly [bigint, bigint, number, number, number];
    rateBps = Number(r[2]);
  } catch { /* rate unavailable — left null, the form omits the cost line */ }
  return {
    clearingHouse: d.contracts.clearingHouse as Address,
    byRisk: v.availableBorrow, byLiquidity, limitedByLiquidity: byLiquidity < v.availableBorrow,
    debtNow: v.debt, borrowLimit: v.borrowLimit, maintenanceLimit: v.maintenanceLimit,
    rateBps, epoch: v.riskEpoch, status: v.status, settlementSymbol: d.settlementAsset.symbol,
  };
}

// ---------------------------------------------------------------- repay

export interface RepayQuote {
  clearingHouse: Address; liquidityVault: Address; settlementToken: Address;
  settlementDecimals: number; settlementSymbol: string;
  debt: bigint; maintenanceLimit: bigint; status: AccountStatus;
  walletBalance: bigint; allowance: bigint;
}

export async function repayQuote(user: Address): Promise<RepayQuote | null> {
  const d = await loadDeployment(activeChain().id);
  if (!d) return null;
  const acc = await loadAccount(user);
  if (acc.outcome !== "OK") return null;
  const v = acc.view;
  const liquidityVault = d.contracts.liquidityVault as Address;
  const settlementToken = d.settlementAsset.token;
  const c = pub();
  const [walletBalance, allowance] = await Promise.all([
    c.readContract({ address: settlementToken, abi: ERC20_ABI, functionName: "balanceOf", args: [user] }),
    c.readContract({ address: settlementToken, abi: ERC20_ABI, functionName: "allowance", args: [user, liquidityVault] }),
  ]);
  return {
    clearingHouse: d.contracts.clearingHouse as Address, liquidityVault, settlementToken,
    settlementDecimals: d.settlementAsset.decimals, settlementSymbol: d.settlementAsset.symbol,
    debt: v.debt, maintenanceLimit: v.maintenanceLimit, status: v.status, walletBalance, allowance,
  };
}

// ---------------------------------------------------------------- withdraw

export interface WithdrawQuote {
  clearingHouse: Address; assetId: `0x${string}`; symbol: string; decimals: number;
  deposited: bigint; withdrawable: bigint; debtUsd: bigint; recognizedUsd: bigint;
  status: AccountStatus; epoch: number; debtFree: boolean;
}

export async function withdrawQuote(user: Address): Promise<WithdrawQuote | null> {
  const d = await loadDeployment(activeChain().id);
  const asset = d?.assets[0];
  if (!d || !asset) return null;
  const acc = await loadAccount(user);
  if (acc.outcome !== "OK") return null;
  const v = acc.view;
  const c = pub();
  const clearingHouse = d.contracts.clearingHouse as Address;
  const held = v.assets.find((a) => a.assetId.toLowerCase() === asset.assetId.toLowerCase());
  const [withdrawable, deposited] = await Promise.all([
    c.readContract({ address: clearingHouse, abi: CH_ACTION_ABI, functionName: "maxWithdrawable", args: [user, asset.assetId] }),
    c.readContract({ address: d.contracts.collateralVault as Address, abi: CV_ABI, functionName: "balanceOf", args: [asset.assetId, user] }),
  ]);
  return {
    clearingHouse, assetId: asset.assetId, symbol: asset.symbol, decimals: asset.decimals,
    deposited, withdrawable, debtUsd: v.debt, recognizedUsd: held?.recognizedUsd18 ?? 0n,
    status: v.status, epoch: v.riskEpoch, debtFree: v.debt === 0n,
  };
}

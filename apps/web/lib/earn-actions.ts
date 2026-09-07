"use client";

import { createPublicClient, http, parseAbi, type Address } from "viem";
import { activeChain, loadDeployment } from "./deployments";
import { connectedAccount } from "./actions";

/**
 * The write plumbing for the lender journey, over the real `LiquidityVault` semantics.
 *
 * There is no modelled yield anywhere in here. The only numbers are read back from the contract:
 * the settlement-token balance and allowance, the current share price, and — for a withdrawal —
 * how much the vault can honour right now versus what has to queue. The UI represents that exact
 * lifecycle; a queued request is never called an "immediate withdrawal".
 *
 * Writes go through the shared `sendTransaction` funnel at the call site (builder code, and a lost
 * RPC response that resolves to CONFIRMATION_UNKNOWN rather than "sign again"). This module supplies
 * the ABIs, the addresses, and the one conversion that is easy to get wrong: the exact allowance a
 * `supply` needs, rounded so it is never one unit short.
 */

export const VAULT_WRITE_ABI = parseAbi([
  "function supply(uint256 amount, address receiver) returns (uint256 shares)",
  "function withdraw(uint256 shares, address receiver) returns (uint256 amount)",
  "function requestWithdrawal(uint256 shares) returns (uint256 id)",
  "function cancelWithdrawal(uint256 id)",
  "function claimWithdrawal(uint256 id, address receiver) returns (uint256 amount)",
  // decoded on a revert into the exact sentence
  "error ZeroAmount()",
  "error InsufficientCash(uint256 available, uint256 requested)",
  "error InsufficientShares()",
  "error UnknownRequest(uint256 id)",
  "error NotYourRequest(uint256 id)",
  "error RequestAlreadySettled(uint256 id)",
  "error RequestNotFunded(uint256 id, uint256 funded, uint256 owed)",
]);

export const ERC20_WRITE_ABI = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
]);

const VAULT_READ_ABI = parseAbi([
  "function convertToShares(uint256 assets) view returns (uint256)",
  "function convertToAssets(uint256 shares) view returns (uint256)",
  "function availableCash() view returns (uint256)",
  "function decimals() view returns (uint8)",
]);

function pub() {
  return createPublicClient({
    transport: http(activeChain().rpcUrl, { retryCount: 3, retryDelay: 1200, timeout: 30_000 }),
  });
}

/** The connected + signed-in address, or null. Same session rule as every other write surface. */
export async function connectedLender(): Promise<Address | null> {
  return connectedAccount();
}

export interface DepositQuote {
  vault: Address;
  settlementToken: Address;
  decimals: number;
  symbol: string;
  /** Settlement-token wallet balance. */
  walletBalance: bigint;
  /** Current allowance the lender has granted the vault. */
  allowance: bigint;
  /** Shares this amount would mint at the current price. Null until an amount is entered. */
  previewShares: bigint | null;
}

export async function depositQuote(user: Address, amount?: bigint): Promise<DepositQuote | null> {
  const d = await loadDeployment(activeChain().id);
  if (!d) return null;
  const vault = d.contracts.liquidityVault as Address;
  const settlementToken = d.settlementAsset.token as Address;
  const c = pub();

  const [walletBalance, allowance, previewShares] = await Promise.all([
    c.readContract({ address: settlementToken, abi: ERC20_WRITE_ABI, functionName: "balanceOf", args: [user] }),
    c.readContract({ address: settlementToken, abi: ERC20_WRITE_ABI, functionName: "allowance", args: [user, vault] }),
    amount && amount > 0n
      ? c.readContract({ address: vault, abi: VAULT_READ_ABI, functionName: "convertToShares", args: [amount] })
      : Promise.resolve(null),
  ]);

  return {
    vault,
    settlementToken,
    decimals: d.settlementAsset.decimals,
    symbol: d.settlementAsset.symbol,
    walletBalance,
    allowance,
    previewShares,
  };
}

export interface WithdrawPreview {
  vault: Address;
  decimals: number;
  symbol: string;
  /** Shares the lender holds. */
  shares: bigint;
  /** Asset value of those shares at the current price. */
  value: bigint;
  /** Largest immediate redemption the vault can honour for this lender right now. */
  withdrawableNow: bigint;
  /** Asset value of the shares the caller wants to redeem. Null until entered. */
  previewAmount: bigint | null;
  /** True when `previewAmount` exceeds `withdrawableNow` — the excess must queue. */
  mustQueue: boolean;
}

export async function withdrawPreview(user: Address, shares?: bigint): Promise<WithdrawPreview | null> {
  const d = await loadDeployment(activeChain().id);
  if (!d) return null;
  const vault = d.contracts.liquidityVault as Address;
  const c = pub();

  const [heldShares, withdrawableNow] = await Promise.all([
    c.readContract({ address: vault, abi: parseAbi(["function balanceOf(address) view returns (uint256)"]), functionName: "balanceOf", args: [user] }),
    c.readContract({ address: vault, abi: parseAbi(["function maxWithdraw(address) view returns (uint256)"]), functionName: "maxWithdraw", args: [user] }),
  ]);

  const value = heldShares > 0n
    ? await c.readContract({ address: vault, abi: VAULT_READ_ABI, functionName: "convertToAssets", args: [heldShares] })
    : 0n;
  const previewAmount = shares && shares > 0n
    ? await c.readContract({ address: vault, abi: VAULT_READ_ABI, functionName: "convertToAssets", args: [shares] })
    : null;

  return {
    vault,
    decimals: d.settlementAsset.decimals,
    symbol: d.settlementAsset.symbol,
    shares: heldShares,
    value,
    withdrawableNow,
    previewAmount,
    mustQueue: previewAmount !== null && previewAmount > withdrawableNow,
  };
}

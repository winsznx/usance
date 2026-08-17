"use client";

import { addChainParams, isXLayer, type ChainConfig } from "@usance/xlayer";

/**
 * Wallet connection over plain EIP-1193.
 *
 * OKX Wallet is preferred where present, and any injected EIP-1193 provider works. Kept
 * deliberately thin: the four things that go wrong in onboarding are no provider, wrong network,
 * unknown network, and a rejected signature, and each of those needs its own recovery path rather
 * than a generic "something went wrong".
 */

export type Eip1193 = {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  on?(event: string, handler: (...a: any[]) => void): void;
  removeListener?(event: string, handler: (...a: any[]) => void): void;
};

export type WalletKind = "okx" | "injected" | "none";

export class WalletError extends Error {
  constructor(
    message: string,
    readonly code: "NO_PROVIDER" | "REJECTED" | "CHAIN_ADD_FAILED" | "CHAIN_SWITCH_FAILED" | "UNKNOWN",
  ) {
    super(message);
  }
}

interface WindowWithWallets extends Window {
  okxwallet?: Eip1193;
  ethereum?: Eip1193;
}

export function detectProvider(): { provider: Eip1193 | null; kind: WalletKind } {
  if (typeof window === "undefined") return { provider: null, kind: "none" };
  const w = window as WindowWithWallets;
  if (w.okxwallet) return { provider: w.okxwallet, kind: "okx" };
  if (w.ethereum) return { provider: w.ethereum, kind: "injected" };
  return { provider: null, kind: "none" };
}

function isUserRejection(e: unknown): boolean {
  const code = (e as { code?: number })?.code;
  // 4001 is the EIP-1193 user-rejection code; MetaMask-family wallets also use ACTION_REJECTED.
  return code === 4001 || (e as { code?: string })?.code === "ACTION_REJECTED";
}

export async function connect(): Promise<{ address: `0x${string}`; chainId: number; kind: WalletKind }> {
  const { provider, kind } = detectProvider();
  if (!provider) {
    throw new WalletError(
      "No wallet was found in this browser. Install OKX Wallet, or open Usance inside a wallet browser.",
      "NO_PROVIDER",
    );
  }

  try {
    const accounts = (await provider.request({ method: "eth_requestAccounts" })) as string[];
    const chainIdHex = (await provider.request({ method: "eth_chainId" })) as string;
    const address = accounts[0];
    if (!address) throw new WalletError("The wallet returned no accounts.", "UNKNOWN");
    return { address: address as `0x${string}`, chainId: Number.parseInt(chainIdHex, 16), kind };
  } catch (e) {
    if (isUserRejection(e)) {
      throw new WalletError("Connection was declined in the wallet.", "REJECTED");
    }
    throw new WalletError((e as Error).message ?? "Could not connect.", "UNKNOWN");
  }
}

/**
 * Move the wallet onto X Layer, adding the network first if the wallet does not know it.
 *
 * The user never sees an RPC URL or a chain id. 4902 is the standard "unrecognised chain" code.
 */
export async function ensureChain(target: ChainConfig): Promise<void> {
  const { provider } = detectProvider();
  if (!provider) throw new WalletError("No wallet found.", "NO_PROVIDER");

  const hexId = `0x${target.id.toString(16)}`;
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hexId }] });
    return;
  } catch (e) {
    const code = (e as { code?: number })?.code;
    if (isUserRejection(e)) {
      throw new WalletError(`Switching to ${target.name} was declined.`, "REJECTED");
    }
    if (code !== 4902) {
      throw new WalletError(`Could not switch to ${target.name}.`, "CHAIN_SWITCH_FAILED");
    }
  }

  try {
    await provider.request({ method: "wallet_addEthereumChain", params: [addChainParams(target)] });
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hexId }] });
  } catch (e) {
    if (isUserRejection(e)) {
      throw new WalletError(`Adding ${target.name} was declined.`, "REJECTED");
    }
    throw new WalletError(`Could not add ${target.name} to the wallet.`, "CHAIN_ADD_FAILED");
  }
}

/**
 * The gasless app-session signature.
 *
 * EIP-4361 shaped. This authenticates reads only. It never authorises a transfer, and the copy on
 * screen says so, because a signature request that looks like every other signature request is
 * how people get drained.
 */
export function sessionMessage(params: {
  domain: string;
  address: string;
  chainId: number;
  nonce: string;
  issuedAt: string;
}): string {
  return [
    `${params.domain} wants you to sign in with your account:`,
    params.address,
    "",
    "This signature signs you in. It does not move funds and costs no gas.",
    "",
    `URI: https://${params.domain}`,
    "Version: 1",
    `Chain ID: ${params.chainId}`,
    `Nonce: ${params.nonce}`,
    `Issued At: ${params.issuedAt}`,
  ].join("\n");
}

export async function signSession(address: `0x${string}`, chainId: number, domain: string) {
  const { provider } = detectProvider();
  if (!provider) throw new WalletError("No wallet found.", "NO_PROVIDER");

  const nonce = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  const message = sessionMessage({
    domain,
    address,
    chainId,
    nonce,
    issuedAt: new Date().toISOString(),
  });

  try {
    const signature = (await provider.request({
      method: "personal_sign",
      params: [message, address],
    })) as string;
    return { message, signature, nonce };
  } catch (e) {
    if (isUserRejection(e)) {
      throw new WalletError("Sign-in was declined. You can keep browsing in read-only mode.", "REJECTED");
    }
    throw new WalletError("Could not sign in.", "UNKNOWN");
  }
}

export { isXLayer };

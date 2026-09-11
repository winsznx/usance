"use client";

import { connect, detectProvider, WalletError } from "./wallet";

export type InstitutionalCaller = { walletAddress: string; organization: { slug: string; displayName: string }; role: string };
export type InstitutionalSessionState = { authenticated: false } | ({ authenticated: true; expiresAt: string } & InstitutionalCaller);

export async function fetchInstitutionalSession(): Promise<InstitutionalSessionState> {
  const response = await fetch("/api/auth/session");
  if (!response.ok) return { authenticated: false };
  const data = (await response.json()) as { authenticated: boolean; caller?: InstitutionalCaller; expiresAt?: string };
  if (!data.authenticated || !data.caller || !data.expiresAt) return { authenticated: false };
  return { authenticated: true, expiresAt: data.expiresAt, ...data.caller };
}

/** Connect a wallet, sign the server-issued challenge, and establish the institutional session cookie. */
export async function signIntoInstitutionalWorkspace(): Promise<InstitutionalSessionState> {
  const { provider } = detectProvider();
  if (!provider) throw new WalletError("No wallet was found in this browser.", "NO_PROVIDER");
  const { address } = await connect();

  const issued = await fetch("/api/auth/challenge", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ walletAddress: address }),
  });
  if (!issued.ok) throw new WalletError("Could not start institutional sign-in.", "UNKNOWN");
  const { challengeId, message } = (await issued.json()) as { challengeId: string; message: string };
  const nonceMatch = message.match(/Nonce: ([0-9a-f]{64})/);
  if (!nonceMatch) throw new WalletError("The sign-in challenge was malformed.", "UNKNOWN");

  let signature: string;
  try {
    signature = (await provider.request({ method: "personal_sign", params: [message, address] })) as string;
  } catch (e) {
    const rejected = (e as { code?: number })?.code === 4001;
    throw new WalletError(rejected ? "Sign-in was declined in the wallet." : "Could not sign the challenge.", rejected ? "REJECTED" : "UNKNOWN");
  }

  const verified = await fetch("/api/auth/verify", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ challengeId, nonce: nonceMatch[1], signature }),
  });
  if (!verified.ok) throw new WalletError("This wallet is not an active institutional operator on this testnet organization.", "UNKNOWN");
  const data = (await verified.json()) as { authenticated: boolean; caller: InstitutionalCaller; expiresAt: string };
  return { authenticated: true, expiresAt: data.expiresAt, ...data.caller };
}

export async function signOutOfInstitutionalWorkspace(): Promise<void> {
  await fetch("/api/auth/logout", { method: "POST" });
}

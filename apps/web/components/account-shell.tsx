"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Notice } from "@/components/primitives";
import { AppShell } from "@/components/app-shell";
import { activeChain } from "@/lib/deployments";
import { connect, detectProvider, WalletError } from "@/lib/wallet";

/**
 * The shell every signed-in route shares.
 *
 * It exists so the states before a portfolio can be shown are written once. Six routes each writing
 * their own "connect your wallet" is six routes that disagree about what a wrong network looks
 * like, and five of them will be missing the case nobody thought about.
 *
 * The testnet banner is not decoration. A user who confuses tUSTB with a real tokenised T-bill has
 * misunderstood the single most important thing about this deployment.
 */
export function AccountShell({
  title,
  intro,
  children,
  before,
}: {
  title: string;
  intro: string;
  children: (account: `0x${string}`) => React.ReactNode;
  /**
   * Rendered whether or not a wallet is connected.
   *
   * For content that is most useful *before* connecting — an explanation of what a signature grants
   * belongs in front of somebody deciding whether to give one, not behind the decision.
   */
  before?: React.ReactNode;
}) {
  const chain = activeChain();
  const [address, setAddress] = useState<`0x${string}` | null>(null);
  const [error, setError] = useState<{ message: string; code: string } | null>(null);
  const [hasProvider, setHasProvider] = useState(true);
  const [connecting, setConnecting] = useState(false);

  useEffect(() => setHasProvider(detectProvider().provider !== null), []);

  useEffect(() => {
    const { provider } = detectProvider();
    if (!provider?.on) return;
    // A wallet that switches account mid-session must not leave the previous account's balances on
    // screen. Silently continuing is how somebody acts on somebody else's position.
    const onAccounts = (accts: string[]) => setAddress((accts[0] as `0x${string}`) ?? null);
    provider.on("accountsChanged", onAccounts);
    return () => provider.removeListener?.("accountsChanged", onAccounts);
  }, []);

  const doConnect = useCallback(async () => {
    setError(null);
    setConnecting(true);
    try {
      const r = await connect();
      setAddress(r.address);
    } catch (e) {
      setError(
        e instanceof WalletError
          ? { message: e.message, code: e.code }
          : { message: (e as Error).message, code: "UNKNOWN" },
      );
    } finally {
      setConnecting(false);
    }
  }, []);

  return (
    <AppShell account={address}>
      <div className="stack" style={{ gap: 0 }}>
        <h1 className="heading-lg" style={{ marginBottom: 10, fontSize: 26 }}>{title}</h1>
        <p className="muted" style={{ marginTop: 0, marginBottom: 28 }}>{intro}</p>

        {before ? <div style={{ marginBottom: 20 }}>{before}</div> : null}

        {address === null ? (
          <div className="card stack" style={{ maxWidth: 520 }}>
            {!hasProvider ? (
              <Notice title="No wallet detected">
                Usance works with OKX Wallet and any standard browser wallet. On a phone, open this
                page inside your wallet&rsquo;s own browser.
              </Notice>
            ) : null}
            <button
              className="btn btn-primary btn-lg btn-block"
              onClick={doConnect}
              disabled={connecting || !hasProvider}
            >
              {connecting ? "Waiting for your wallet…" : "Connect wallet"}
            </button>
            <p className="caption" style={{ margin: 0, textAlign: "center" }}>
              Connecting shows Usance your address and nothing else.{" "}
              <Link href="/assets" style={{ textDecoration: "underline" }}>Browse assets instead</Link>.
            </p>
          </div>
        ) : (
          children(address)
        )}
      </div>
    </AppShell>
  );
}

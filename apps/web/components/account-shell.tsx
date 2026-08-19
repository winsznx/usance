"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Notice } from "@/components/primitives";
import { AppShell } from "@/components/app-shell";
import { activeChain } from "@/lib/deployments";
import { detectProvider } from "@/lib/wallet";
import { readSession, clearSession } from "@/lib/session";
import { useRouter } from "next/navigation";

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
  /** Rendered whether or not a wallet is connected. */
  before?: React.ReactNode;
}) {
  const router = useRouter();
  const [address, setAddress] = useState<`0x${string}` | null>(null);
  const [checked, setChecked] = useState(false);

  /**
   * One place asks for a wallet, and it is not here — and it asks for a signature, not a connection.
   *
   * Gating on `eth_accounts` let a returning visitor past onboarding entirely, because a wallet
   * reports an address for any site it has previously been connected to.
   */
  useEffect(() => {
    let live = true;
    readSession().then((state) => {
      if (!live) return;
      setChecked(true);
      if (state.status === "ACTIVE") setAddress(state.address);
      else router.replace("/app/onboarding");
    });
    return () => {
      live = false;
    };
  }, [router]);

  useEffect(() => {
    const { provider } = detectProvider();
    if (!provider?.on) return;
    const onAccounts = () => {
      clearSession();
      setAddress(null);
      router.replace("/app/onboarding");
    };
    provider.on("accountsChanged", onAccounts);
    return () => provider.removeListener?.("accountsChanged", onAccounts);
  }, [router]);

  return (
    <AppShell account={address}>
      <div className="stack" style={{ gap: 0 }}>
        <h1 className="heading-lg" style={{ marginBottom: 10, fontSize: 26 }}>{title}</h1>
        <p className="muted" style={{ marginTop: 0, marginBottom: 28 }}>{intro}</p>

        {before ? <div style={{ marginBottom: 20 }}>{before}</div> : null}

        {!checked ? (
          <div className="card"><div className="skeleton" style={{ height: 120 }} /></div>
        ) : address === null ? (
          /* Momentary: the redirect above is already in flight. Saying so beats a blank frame. */
          <Notice title="Taking you to sign in">
            Usance asks for a wallet once, on its own screen, rather than on every page.
          </Notice>
        ) : (
          children(address)
        )}
      </div>
    </AppShell>
  );
}

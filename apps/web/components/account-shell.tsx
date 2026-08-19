"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Notice } from "@/components/primitives";
import { AppShell } from "@/components/app-shell";
import { activeChain } from "@/lib/deployments";
import { detectProvider } from "@/lib/wallet";
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
   * One place asks for a wallet, and it is not here.
   *
   * Every signed-in route used to carry its own connect prompt, so a user could meet the same
   * question four different ways on four different screens. Now an unauthenticated visit redirects
   * to onboarding, which owns the whole sequence, and everything past it assumes a session.
   */
  useEffect(() => {
    const { provider } = detectProvider();
    if (!provider) {
      setChecked(true);
      router.replace("/app/onboarding");
      return;
    }
    provider
      .request({ method: "eth_accounts" })
      .then((accts) => {
        const found = (accts as string[])[0] as `0x${string}` | undefined;
        if (found) setAddress(found);
        else router.replace("/app/onboarding");
      })
      .catch(() => router.replace("/app/onboarding"))
      .finally(() => setChecked(true));
  }, [router]);

  // A wallet that switches to a locked or different account must not leave the previous account's
  // figures on screen.
  useEffect(() => {
    const { provider } = detectProvider();
    if (!provider?.on) return;
    const onAccounts = (accts: string[]) => {
      const next = (accts[0] as `0x${string}`) ?? null;
      setAddress(next);
      if (!next) router.replace("/app/onboarding");
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

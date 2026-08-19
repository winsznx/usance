"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Footer, Logo, Notice } from "@/components/primitives";
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
    <>
      <header style={{ background: "var(--paper)", borderBottom: "1px solid var(--hairline)" }}>
        <div className="shell row-between" style={{ height: 68 }}>
          <Logo />
          <div className="row" style={{ gap: 10 }}>
            <span className="tag">{chain.name}</span>
            {address ? (
              <span className="tag mono" style={{ fontSize: 12 }}>
                {address.slice(0, 6)}…{address.slice(-4)}
              </span>
            ) : null}
          </div>
        </div>
      </header>

      {chain.id !== 196 ? (
        <div
          style={{
            background: "var(--paper)",
            borderBottom: "1px solid var(--hairline)",
            padding: "10px 0",
            textAlign: "center",
          }}
        >
          <span className="caption" style={{ letterSpacing: "0.04em" }}>
            X LAYER TESTNET · TEST ASSETS HAVE NO REAL VALUE · tUSTB IS NOT FOBXX, OUSG OR ARCOIN
          </span>
        </div>
      ) : null}

      <main className="shell" style={{ padding: "40px 24px 80px", maxWidth: 860 }}>
        <h1 className="heading-lg" style={{ marginBottom: 10 }}>{title}</h1>
        <p className="muted" style={{ marginTop: 0, marginBottom: 28 }}>{intro}</p>

        {error ? (
          <div style={{ marginBottom: 20 }}>
            <Notice
              tone={error.code === "REJECTED" ? "warn" : "stop"}
              title={error.code === "REJECTED" ? "Declined in your wallet" : "Could not connect"}
              action={<button className="btn btn-ghost" onClick={() => setError(null)}>Dismiss</button>}
            >
              {error.message}
            </Notice>
          </div>
        ) : null}

        {before ? <div style={{ marginBottom: 20 }}>{before}</div> : null}

        {address === null ? (
          <div className="card stack">
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
              Connecting reads your address. It moves nothing and grants nothing.{" "}
              <Link href="/assets" style={{ textDecoration: "underline" }}>Browse assets instead</Link>.
            </p>
          </div>
        ) : (
          children(address)
        )}
      </main>
      <Footer />
    </>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { isXLayer } from "@usance/xlayer";
import { Footer, Logo, Notice, Steps } from "@/components/primitives";
import { AccountStatusPanel, type AccountView } from "@/components/account-state";
import { quoteFor } from "@/lib/quote";
import { activeChain, loadDeployment, type Deployment } from "@/lib/deployments";
import { WalletError, connect, detectProvider, ensureChain, signSession } from "@/lib/wallet";

type Phase = "disconnected" | "connecting" | "wrong-network" | "session" | "ready" | "readonly";

/**
 * `/app` — first run and portfolio.
 *
 * The onboarding sequence is connect → network → session → holdings, and every step has a named
 * failure with a named recovery. Declining the session signature drops to read-only rather than
 * treating the wallet as broken.
 */
export default function AppHome() {
  const chain = activeChain();

  const [phase, setPhase] = useState<Phase>("disconnected");
  const [address, setAddress] = useState<`0x${string}` | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [error, setError] = useState<{ message: string; code: string } | null>(null);
  const [deployment, setDeployment] = useState<Deployment | null | undefined>(undefined);
  const [hasProvider, setHasProvider] = useState(true);

  useEffect(() => {
    setHasProvider(detectProvider().provider !== null);
  }, []);

  useEffect(() => {
    let live = true;
    loadDeployment(chain.id).then((d) => {
      if (live) setDeployment(d);
    });
    return () => {
      live = false;
    };
  }, [chain.id]);

  // A wallet that changes account or network mid-session invalidates the session. Silently
  // continuing against a different address is how people act on someone else's balance.
  useEffect(() => {
    const { provider } = detectProvider();
    if (!provider?.on) return;
    const onAccounts = (accts: string[]) => {
      setAddress((accts[0] as `0x${string}`) ?? null);
      setPhase(accts.length > 0 ? "session" : "disconnected");
    };
    const onChain = (hex: string) => {
      const id = Number.parseInt(hex, 16);
      setChainId(id);
      setPhase(isXLayer(id) ? "session" : "wrong-network");
    };
    provider.on("accountsChanged", onAccounts);
    provider.on("chainChanged", onChain);
    return () => {
      provider.removeListener?.("accountsChanged", onAccounts);
      provider.removeListener?.("chainChanged", onChain);
    };
  }, []);

  const handle = useCallback((e: unknown) => {
    if (e instanceof WalletError) setError({ message: e.message, code: e.code });
    else setError({ message: (e as Error).message ?? "Something went wrong.", code: "UNKNOWN" });
  }, []);

  const doConnect = useCallback(async () => {
    setError(null);
    setPhase("connecting");
    try {
      const r = await connect();
      setAddress(r.address);
      setChainId(r.chainId);
      setPhase(isXLayer(r.chainId) ? "session" : "wrong-network");
    } catch (e) {
      setPhase("disconnected");
      handle(e);
    }
  }, [handle]);

  const doSwitch = useCallback(async () => {
    setError(null);
    try {
      await ensureChain(chain);
      setChainId(chain.id);
      setPhase("session");
    } catch (e) {
      handle(e);
    }
  }, [chain, handle]);

  const doSignIn = useCallback(async () => {
    if (!address || !chainId) return;
    setError(null);
    try {
      await signSession(address, chainId, "usance.xyz");
      setPhase("ready");
    } catch (e) {
      setPhase("readonly");
      handle(e);
    }
  }, [address, chainId, handle]);

  const step = (want: Phase[], done: Phase[]) =>
    done.includes(phase) ? ("done" as const) : want.includes(phase) ? ("active" as const) : ("pending" as const);

  return (
    <>
      <header style={{ background: "var(--paper)", borderBottom: "1px solid var(--hairline)" }}>
        <div className="shell row-between" style={{ height: 68 }}>
          <Logo />
          <div className="row" style={{ gap: 12 }}>
            <span className="tag">{chain.name}</span>
            {address ? (
              <span className="tag mono" style={{ fontSize: 12 }}>
                {address.slice(0, 6)}…{address.slice(-4)}
              </span>
            ) : null}
          </div>
        </div>
      </header>

      <main className="shell" style={{ padding: "48px 24px 80px", maxWidth: 780 }}>
        <h1 className="heading-lg" style={{ marginBottom: 10 }}>
          {phase === "ready" || phase === "readonly" ? "Your portfolio" : "Get set up"}
        </h1>
        <p className="muted" style={{ marginTop: 0, marginBottom: 34 }}>
          {phase === "ready" || phase === "readonly"
            ? "What you hold, how much of it Usance can recognise, and what you can do with it."
            : "Usance needs your address and your network before it can show you anything."}
        </p>

        {error ? (
          <div style={{ marginBottom: 24 }}>
            <Notice
              tone={error.code === "REJECTED" ? "warn" : "stop"}
              title={error.code === "REJECTED" ? "Declined in the wallet" : "Could not continue"}
              action={
                <button className="btn btn-ghost" onClick={() => setError(null)}>
                  Dismiss
                </button>
              }
            >
              {error.message}
            </Notice>
          </div>
        ) : null}

        {/* ------------------------------------------------------------- onboarding */}
        {phase !== "ready" && phase !== "readonly" ? (
          <div className="card stack" style={{ gap: 24 }}>
            <Steps
              steps={[
                { label: "Connect your wallet", state: step(["disconnected", "connecting"], ["wrong-network", "session"]) },
                { label: `Switch to ${chain.name}`, state: step(["wrong-network"], ["session"]) },
                { label: "Sign in", state: step(["session"], []) },
              ]}
            />

            <hr className="divider" />

            {phase === "disconnected" || phase === "connecting" ? (
              <div className="stack">
                {!hasProvider ? (
                  <Notice title="No wallet detected">
                    Usance works with OKX Wallet and any standard browser wallet. On mobile, open
                    this page inside your wallet&rsquo;s browser.
                  </Notice>
                ) : null}
                <button
                  className="btn btn-primary btn-lg btn-block"
                  onClick={doConnect}
                  disabled={phase === "connecting" || !hasProvider}
                >
                  {phase === "connecting" ? "Waiting for your wallet…" : "Connect wallet"}
                </button>
                <p className="caption" style={{ margin: 0, textAlign: "center" }}>
                  You can{" "}
                  <Link href="/assets" style={{ textDecoration: "underline" }}>
                    browse supported assets
                  </Link>{" "}
                  without connecting.
                </p>
              </div>
            ) : null}

            {phase === "wrong-network" ? (
              <div className="stack">
                <Notice tone="warn" title={`Usance runs on ${chain.name}`}>
                  Your wallet is on chain {chainId}. Usance will switch it for you, and add the
                  network first if your wallet does not know it yet.
                </Notice>
                <button className="btn btn-primary btn-lg btn-block" onClick={doSwitch}>
                  Switch to {chain.name}
                </button>
              </div>
            ) : null}

            {phase === "session" ? (
              <div className="stack">
                <Notice title="Sign in to Usance">
                  Your wallet will show a plain-text message rather than a transaction. There is no
                  gas estimate on it and no spending limit. Signing proves the address is yours, so
                  Usance can show you what it holds.
                </Notice>
                <button className="btn btn-primary btn-lg btn-block" onClick={doSignIn}>
                  Sign in
                </button>
                <button className="btn btn-ghost btn-block" onClick={() => setPhase("readonly")}>
                  Continue without signing in
                </button>
              </div>
            ) : null}
          </div>
        ) : null}

        {/* ------------------------------------------------------------- portfolio */}
        {phase === "ready" || phase === "readonly" ? (
          <div className="stack" style={{ gap: 20 }}>
            {phase === "readonly" ? (
              <Notice tone="warn" title="Read-only mode" action={<button className="btn btn-ghost" onClick={doSignIn}>Sign in</button>}>
                You are browsing without a session. Sign in to use your portfolio.
              </Notice>
            ) : null}

            {deployment === undefined ? (
              <div className="card">
                <div className="skeleton" style={{ height: 18, width: "40%", marginBottom: 12 }} />
                <div className="skeleton" style={{ height: 44, width: "60%" }} />
              </div>
            ) : deployment === null ? (
              /*
               * No manifest for this chain. Rendering an empty portfolio here would look like a
               * working product with no assets, which is a lie. Say exactly what is missing.
               */
              <Notice
                tone="stop"
                title={`Usance is not yet deployed on ${chain.name}`}
                action={
                  <div className="row" style={{ flexWrap: "wrap" }}>
                    <Link className="btn btn-primary" href="/simulate">
                      See the walkthrough
                    </Link>
                    <Link className="btn btn-ghost" href="/status">
                      Integration status
                    </Link>
                  </div>
                }
              >
                No deployment manifest is published for chain {chain.id}, so there are no contracts
                to read and no balances to show. Rather than render an empty portfolio that looks
                like a working account, Usance tells you plainly. The full mechanism, from evidence
                through Passport to recognised value and borrowing limits, is reproducible right now
                from the canonical scenarios in the walkthrough.
              </Notice>
            ) : (
              <PortfolioSummary deployment={deployment} address={address} />
            )}
          </div>
        ) : null}
      </main>

      <Footer />
    </>
  );
}

/**
 * The portfolio, read from the deployed contracts.
 *
 * Nothing is rendered until the chain answers. An empty portfolio and an unread one look identical
 * to a user, and only one of them is safe to show — so the loading and error states are distinct
 * and neither of them is a zero balance.
 */
function PortfolioSummary({ deployment, address }: { deployment: Deployment; address: `0x${string}` | null }) {
  const [account, setAccount] = useState<AccountView | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!address) return;
    let live = true;
    quoteFor(address, "BORROW", 0n)
      .then((q) => {
        if (!live) return;
        setAccount({
          status: q.statusBefore,
          recognisedUsd: q.recognisedBefore,
          debtUsd: q.debtBefore,
          borrowLimitUsd: q.availableBorrowBefore + q.debtBefore,
          maintenanceLimitUsd: q.maintenanceLimit,
          liquidationLimitUsd: q.liquidationLimit,
          epoch: q.riskEpoch,
        });
      })
      .catch((e: unknown) => {
        if (live) setError((e as Error).message);
      });
    return () => {
      live = false;
    };
  }, [address]);

  if (error) {
    return (
      <Notice tone="stop" title="Could not read your account">
        {error} Nothing is shown rather than a zero balance, because an unread account and an empty
        one look the same and only one of them is safe to act on.
      </Notice>
    );
  }

  if (account === undefined) {
    return (
      <div className="card">
        <div className="skeleton" style={{ height: 18, width: "40%", marginBottom: 12 }} />
        <div className="skeleton" style={{ height: 44, width: "60%" }} />
      </div>
    );
  }

  return (
    <div className="stack" style={{ gap: 20 }}>
      {account ? <AccountStatusPanel account={account} /> : null}

      <div className="card">
        <div className="micro">Deployment</div>
        <p className="caption" style={{ marginTop: 10 }}>
          Reading live state from ClearingHouse at{" "}
          <span className="mono">{deployment.contracts.clearingHouse}</span>, under risk epoch{" "}
          {account ? String(account.epoch) : "—"}.
        </p>
        <p className="caption">
          {deployment.assets.length} admitted asset{deployment.assets.length === 1 ? "" : "s"}, settling
          in {deployment.settlementAsset.symbol}.
        </p>
      </div>
    </div>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { isXLayer } from "@usance/xlayer";
import { Footer, Logo, Notice, Steps } from "@/components/primitives";
import { activeChain, loadDeployment, type Deployment } from "@/lib/deployments";
import { WalletError, connect, detectProvider, ensureChain, signSession } from "@/lib/wallet";

/**
 * `/app/onboarding` — first run, with every way it can go wrong named.
 *
 * The happy path is four steps and takes twenty seconds. This page is mostly not about the happy
 * path: it is about the eight states where somebody gets stuck, each of which otherwise surfaces as
 * a spinner that never resolves or a wallet popup that closed and left nothing behind.
 *
 * Nothing here moves funds. That is stated at every step, because a first-time user being asked to
 * sign something has no way to tell a session proof from a transfer approval, and the honest answer
 * to "what does this do" is the difference between a user and a bounce.
 */

type Phase =
  | "DISCONNECTED"
  | "CONNECTING"
  | "WRONG_NETWORK"
  | "NETWORK_SWITCH_REJECTED"
  | "INSUFFICIENT_GAS"
  | "SESSION_SIGNATURE_PENDING"
  | "SESSION_REJECTED"
  | "NO_SUPPORTED_ASSETS"
  | "SUPPORTED_ASSETS_FOUND"
  | "RPC_DEGRADED";

export default function OnboardingPage() {
  const chain = activeChain();
  const [phase, setPhase] = useState<Phase>("DISCONNECTED");
  const [address, setAddress] = useState<`0x${string}` | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [detail, setDetail] = useState<string | null>(null);
  const [deployment, setDeployment] = useState<Deployment | null | undefined>(undefined);
  const [hasProvider, setHasProvider] = useState(true);

  useEffect(() => setHasProvider(detectProvider().provider !== null), []);
  useEffect(() => {
    let live = true;
    loadDeployment(chain.id)
      .then((d) => live && setDeployment(d))
      .catch(() => live && setPhase("RPC_DEGRADED"));
    return () => {
      live = false;
    };
  }, [chain.id]);

  const fail = useCallback((e: unknown, rejected: Phase, other: Phase) => {
    const w = e instanceof WalletError ? e : null;
    setDetail(w?.message ?? (e as Error).message);
    setPhase(w?.code === "REJECTED" ? rejected : other);
  }, []);

  const doConnect = useCallback(async () => {
    setDetail(null);
    setPhase("CONNECTING");
    try {
      const r = await connect();
      setAddress(r.address);
      setChainId(r.chainId);
      setPhase(isXLayer(r.chainId) ? "SESSION_SIGNATURE_PENDING" : "WRONG_NETWORK");
    } catch (e) {
      setPhase("DISCONNECTED");
      setDetail(e instanceof WalletError ? e.message : (e as Error).message);
    }
  }, []);

  const doSwitch = useCallback(async () => {
    setDetail(null);
    try {
      await ensureChain(chain);
      setChainId(chain.id);
      setPhase("SESSION_SIGNATURE_PENDING");
    } catch (e) {
      fail(e, "NETWORK_SWITCH_REJECTED", "WRONG_NETWORK");
    }
  }, [chain, fail]);

  const doSignIn = useCallback(async () => {
    if (!address || !chainId) return;
    setDetail(null);
    try {
      await signSession(address, chainId, "usance.xyz");
      setPhase(deployment && deployment.assets.length > 0 ? "SUPPORTED_ASSETS_FOUND" : "NO_SUPPORTED_ASSETS");
    } catch (e) {
      fail(e, "SESSION_REJECTED", "SESSION_REJECTED");
    }
  }, [address, chainId, deployment, fail]);

  const done = (p: Phase[]) => p.includes(phase);
  const step = (active: Phase[], complete: Phase[]) =>
    done(complete) ? ("done" as const) : done(active) ? ("active" as const) : ("pending" as const);

  const CONNECTED: Phase[] = [
    "WRONG_NETWORK", "NETWORK_SWITCH_REJECTED", "SESSION_SIGNATURE_PENDING",
    "SESSION_REJECTED", "INSUFFICIENT_GAS", "NO_SUPPORTED_ASSETS", "SUPPORTED_ASSETS_FOUND",
  ];
  const ON_NETWORK: Phase[] = ["SESSION_SIGNATURE_PENDING", "SESSION_REJECTED", "INSUFFICIENT_GAS", "NO_SUPPORTED_ASSETS", "SUPPORTED_ASSETS_FOUND"];
  const SIGNED_IN: Phase[] = ["NO_SUPPORTED_ASSETS", "SUPPORTED_ASSETS_FOUND"];

  return (
    <>
      <header style={{ background: "var(--paper)", borderBottom: "1px solid var(--hairline)" }}>
        <div className="shell row-between" style={{ height: 68 }}>
          <Logo />
          <span className="tag">{chain.name}</span>
        </div>
      </header>

      {chain.id !== 196 ? (
        <div style={{ background: "var(--paper)", borderBottom: "1px solid var(--hairline)", padding: "10px 0", textAlign: "center" }}>
          <span className="caption" style={{ letterSpacing: "0.04em" }}>
            X LAYER TESTNET · TEST ASSETS HAVE NO REAL VALUE · tUSTB IS NOT FOBXX, OUSG OR ARCOIN
          </span>
        </div>
      ) : null}

      <main className="shell" style={{ padding: "48px 24px 80px", maxWidth: 720 }}>
        <h1 className="heading-lg" style={{ marginBottom: 10 }}>Get set up</h1>
        <p className="muted" style={{ marginTop: 0, marginBottom: 30 }}>
          Usance needs your address and your network before it can show you anything.
        </p>

        <div className="card stack" style={{ gap: 24 }}>
          <Steps
            steps={[
              { label: "Connect your wallet", state: step(["DISCONNECTED", "CONNECTING"], CONNECTED) },
              { label: `Switch to ${chain.name}`, state: step(["WRONG_NETWORK", "NETWORK_SWITCH_REJECTED"], ON_NETWORK) },
              { label: "Sign in", state: step(["SESSION_SIGNATURE_PENDING", "SESSION_REJECTED"], SIGNED_IN) },
            ]}
          />
          <hr className="divider" />
          <PhasePanel
            phase={phase}
            chain={chain}
            chainId={chainId}
            detail={detail}
            hasProvider={hasProvider}
            onConnect={doConnect}
            onSwitch={doSwitch}
            onSignIn={doSignIn}
          />
        </div>
      </main>
      <Footer />
    </>
  );
}

function PhasePanel({
  phase, chain, chainId, detail, hasProvider, onConnect, onSwitch, onSignIn,
}: {
  phase: Phase;
  chain: { id: number; name: string };
  chainId: number | null;
  detail: string | null;
  hasProvider: boolean;
  onConnect: () => void;
  onSwitch: () => void;
  onSignIn: () => void;
}) {
  switch (phase) {
    case "RPC_DEGRADED":
      return (
        <Notice tone="stop" title="Usance cannot reach X Layer right now">
          Onboarding needs to read the deployment before it can tell you anything true about your
          holdings. Nothing is wrong with your wallet and there is nothing to retry — this clears
          when the network is reachable again.
        </Notice>
      );

    case "DISCONNECTED":
    case "CONNECTING":
      return (
        <div className="stack">
          {!hasProvider ? (
            <Notice title="No wallet detected">
              Usance works with OKX Wallet and any standard browser wallet. On a phone, open this
              page inside your wallet&rsquo;s own browser rather than in Safari or Chrome.
            </Notice>
          ) : null}
          {detail ? <Notice tone="warn" title="That did not complete">{detail}</Notice> : null}
          <button className="btn btn-primary btn-lg btn-block" onClick={onConnect} disabled={phase === "CONNECTING" || !hasProvider}>
            {phase === "CONNECTING" ? "Waiting for your wallet…" : "Connect wallet"}
          </button>
          <p className="caption" style={{ margin: 0, textAlign: "center" }}>
            This shows Usance your address. It cannot move anything.{" "}
            <Link href="/assets" style={{ textDecoration: "underline" }}>Browse assets first</Link>.
          </p>
        </div>
      );

    case "WRONG_NETWORK":
    case "NETWORK_SWITCH_REJECTED":
      return (
        <div className="stack">
          <Notice
            tone={phase === "NETWORK_SWITCH_REJECTED" ? "warn" : "neutral"}
            title={phase === "NETWORK_SWITCH_REJECTED" ? "You declined the network switch" : `Usance runs on ${chain.name}`}
          >
            {phase === "NETWORK_SWITCH_REJECTED"
              ? "Nothing happened and nothing is wrong. Usance can only read your position on the network its contracts are deployed to, so it cannot continue until you switch."
              : `Your wallet is on chain ${chainId}. Usance will switch it, and add the network first if your wallet does not know it yet.`}
          </Notice>
          <button className="btn btn-primary btn-lg btn-block" onClick={onSwitch}>
            Switch to {chain.name}
          </button>
        </div>
      );

    case "INSUFFICIENT_GAS":
      return (
        <Notice tone="warn" title="Not enough OKB for gas">
          Reading your position costs nothing, but any action will need a small amount of OKB.{" "}
          {detail} You can continue and top up before your first transaction.
        </Notice>
      );

    case "SESSION_SIGNATURE_PENDING":
    case "SESSION_REJECTED":
      return (
        <div className="stack">
          <Notice
            tone={phase === "SESSION_REJECTED" ? "warn" : "neutral"}
            title={phase === "SESSION_REJECTED" ? "You declined the signature" : "Sign in to Usance"}
          >
            {phase === "SESSION_REJECTED" ? (
              <>
                Nothing was signed and nothing changed. You can sign in now, or continue without
                signing in and browse without seeing your own position.
              </>
            ) : (
              <>
                Your wallet will show a plain-text message rather than a transaction. There is no
                gas estimate on it and no spending limit. Signing proves the address is yours, so
                Usance can show you what it holds.
              </>
            )}
          </Notice>
          <button className="btn btn-primary btn-lg btn-block" onClick={onSignIn}>
            {phase === "SESSION_REJECTED" ? "Try signing in again" : "Sign in"}
          </button>
          <Link className="btn btn-ghost btn-block" href="/assets">Continue without signing in</Link>
        </div>
      );

    case "NO_SUPPORTED_ASSETS":
      return (
        <div className="stack">
          <Notice title="You are signed in, and hold nothing Usance recognises">
            Usance only lends against assets it has read a Passport for. Your wallet holds none of
            them on {chain.name} yet — which is the normal starting point, not an error.
          </Notice>
          <Link className="btn btn-primary btn-lg btn-block" href="/assets">See what Usance recognises</Link>
          <Link className="btn btn-ghost btn-block" href="/app">Go to your portfolio</Link>
        </div>
      );

    case "SUPPORTED_ASSETS_FOUND":
      return (
        <div className="stack">
          <Notice title="You are ready">
            Usance recognises assets on this network and your session is live.
          </Notice>
          <Link className="btn btn-primary btn-lg btn-block" href="/app/positions">See your position</Link>
          <Link className="btn btn-ghost btn-block" href="/app/collateral/add">Add collateral</Link>
        </div>
      );
  }
}

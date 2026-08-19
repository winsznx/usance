"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { isXLayer } from "@usance/xlayer";
import { Notice } from "@/components/primitives";
import { Illustration, Lockup } from "@/components/kit-icon";
import { activeChain, loadDeployment } from "@/lib/deployments";
import { WalletError, connect, detectProvider, ensureChain, signSession } from "@/lib/wallet";

/**
 * `/app/onboarding` — the one place Usance asks for a wallet.
 *
 * Every signed-in route used to carry its own connect prompt, which meant a user could arrive at
 * four different screens and be asked the same question four different ways. Now the app redirects
 * here once, this page does the whole sequence, and everything past it assumes a session.
 *
 * Two panels. The right does the work; the left explains what Usance is while the wallet dialogs
 * are open. That left column is the reason this is a split rather than a modal: connecting takes
 * three wallet round-trips, and a person staring at a spinner for that long should be reading
 * something rather than waiting.
 */

type Phase =
  | "DISCONNECTED" | "CONNECTING" | "WRONG_NETWORK" | "NETWORK_SWITCH_REJECTED"
  | "SESSION_SIGNATURE_PENDING" | "SESSION_REJECTED" | "READY" | "RPC_DEGRADED";

/** Four things worth knowing, one per step, advancing as the user does. */
const PANELS = [
  {
    illustration: "evidence-to-passport" as const,
    title: "Usance reads the document, not the ticker",
    body: "Every supported asset carries a Passport built from the issuer's own filings: legal rights, custody, redemption terms, transfer restrictions. You can read the evidence it came from.",
  },
  {
    illustration: "collateral-capacity" as const,
    title: "You are shown what is usable, not the market price",
    body: "Recognised value is the lower of the haircut mark and what the position would realise under stress. Every reduction is visible and explained.",
  },
  {
    illustration: "risk-epoch" as const,
    title: "When the evidence changes, the limits change",
    body: "A revised filing or deteriorating liquidity moves the Passport, and your capacity follows automatically. New risk is refused before it is taken, and you are told exactly why.",
  },
  {
    illustration: "mandate-agent-authority" as const,
    title: "Agents act inside limits you sign",
    body: "Delegate a bounded task and revoke it whenever you like. An agent can repay and add collateral. It can never withdraw your collateral.",
  },
];

export default function OnboardingPage() {
  const chain = activeChain();
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("DISCONNECTED");
  const [address, setAddress] = useState<`0x${string}` | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [detail, setDetail] = useState<string | null>(null);
  const [hasProvider, setHasProvider] = useState(true);
  const [panel, setPanel] = useState(0);

  useEffect(() => setHasProvider(detectProvider().provider !== null), []);
  useEffect(() => {
    loadDeployment(chain.id).catch(() => setPhase("RPC_DEGRADED"));
  }, [chain.id]);

  // The left column advances with progress, and idles forward while the user is in a wallet
  // dialog. It never loops back: re-reading panel one after reaching four would feel like a
  // carousel, and this is a briefing.
  useEffect(() => {
    if (phase === "READY") return;
    const t = window.setInterval(() => setPanel((p) => Math.min(p + 1, PANELS.length - 1)), 7000);
    return () => window.clearInterval(t);
  }, [phase]);

  const step = phase === "DISCONNECTED" || phase === "CONNECTING" ? 0
    : phase === "WRONG_NETWORK" || phase === "NETWORK_SWITCH_REJECTED" ? 1
    : phase === "READY" ? 3 : 2;

  useEffect(() => setPanel((p) => Math.max(p, step)), [step]);

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
      setDetail(e instanceof WalletError ? e.message : (e as Error).message);
      setPhase(e instanceof WalletError && e.code === "REJECTED" ? "NETWORK_SWITCH_REJECTED" : "WRONG_NETWORK");
    }
  }, [chain]);

  const doSignIn = useCallback(async () => {
    if (!address || !chainId) return;
    setDetail(null);
    try {
      await signSession(address, chainId, "usance.xyz");
      // Remembered so the app does not send the user back here on the next navigation. The chain
      // is still the authority for everything financial; this only records that they signed in.
      sessionStorage.setItem("usance.session", address);
      setPhase("READY");
      router.push("/app");
    } catch (e) {
      setDetail(e instanceof WalletError ? e.message : (e as Error).message);
      setPhase("SESSION_REJECTED");
    }
  }, [address, chainId, router]);

  const active = PANELS[panel]!;

  return (
    <div className="onboarding">
      {/* ------------------------------------------------------------------ brief */}
      <aside className="onboarding-brief" aria-label="About Usance">
        <Link href="/" className="onboarding-lockup" aria-label="Usance home">
          <Lockup width={116} reversed />
        </Link>

        <div className="onboarding-panel">
          <Illustration name={active.illustration} width={260} height={168} priority={panel === 0} />
          <h2 className="onboarding-panel-title">{active.title}</h2>
          <p className="onboarding-panel-body">{active.body}</p>
        </div>

        <ol className="onboarding-dots" aria-label={`Point ${panel + 1} of ${PANELS.length}`}>
          {PANELS.map((p, i) => (
            <li key={p.title}>
              <button
                type="button"
                className={`onboarding-dot${i === panel ? " onboarding-dot-active" : ""}`}
                onClick={() => setPanel(i)}
                aria-label={p.title}
                aria-current={i === panel ? "true" : undefined}
              />
            </li>
          ))}
        </ol>
      </aside>

      {/* ------------------------------------------------------------------ connect */}
      <main className="onboarding-action">
        <div className="onboarding-form">
          <ol className="onboarding-steps" aria-label="Progress">
            {["Connect", `Switch to ${chain.name}`, "Sign in"].map((label, i) => (
              <li key={label} className={i < step ? "done" : i === step ? "current" : ""}>
                <span className="onboarding-step-index">{i + 1}</span>
                {label}
              </li>
            ))}
          </ol>

          <Panel
            phase={phase}
            chain={chain}
            chainId={chainId}
            detail={detail}
            hasProvider={hasProvider}
            onConnect={doConnect}
            onSwitch={doSwitch}
            onSignIn={doSignIn}
          />

          {chain.id !== 196 ? (
            <p className="onboarding-testnet">
              X LAYER TESTNET · TEST ASSETS HAVE NO REAL VALUE · tUSTB IS NOT FOBXX, OUSG OR ARCOIN
            </p>
          ) : null}
        </div>
      </main>
    </div>
  );
}

function Panel({
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
        <Notice tone="stop" title="Usance cannot reach X Layer">
          There is no point connecting a wallet to an app that cannot read the chain. Nothing is
          wrong with your wallet and there is nothing to retry.
        </Notice>
      );

    case "DISCONNECTED":
    case "CONNECTING":
      return (
        <>
          <h1 className="onboarding-title">Open Usance</h1>
          <p className="onboarding-sub">
            Usance needs your address and your network before it can show you anything. Connecting
            shows Usance your address and nothing else.
          </p>
          {!hasProvider ? (
            <Notice title="No wallet detected">
              Usance works with OKX Wallet and any standard browser wallet. On a phone, open this
              page inside your wallet&rsquo;s own browser.
            </Notice>
          ) : null}
          {detail ? <Notice tone="warn" title="That did not complete">{detail}</Notice> : null}
          <button className="btn btn-primary btn-lg btn-block" onClick={onConnect} disabled={phase === "CONNECTING" || !hasProvider}>
            {phase === "CONNECTING" ? "Waiting for your wallet…" : "Connect wallet"}
          </button>
          <Link className="btn btn-ghost btn-block" href="/assets">Look around without connecting</Link>
        </>
      );

    case "WRONG_NETWORK":
    case "NETWORK_SWITCH_REJECTED":
      return (
        <>
          <h1 className="onboarding-title">Switch to {chain.name}</h1>
          <p className="onboarding-sub">
            {phase === "NETWORK_SWITCH_REJECTED"
              ? "You declined the switch. Nothing happened and nothing is wrong, but Usance can only read your position on the network its contracts are deployed to."
              : `Your wallet is on chain ${chainId}. Usance will switch it, and add the network first if your wallet does not know it yet.`}
          </p>
          {detail ? <Notice tone="warn" title="That did not complete">{detail}</Notice> : null}
          <button className="btn btn-primary btn-lg btn-block" onClick={onSwitch}>Switch network</button>
        </>
      );

    case "SESSION_SIGNATURE_PENDING":
    case "SESSION_REJECTED":
      return (
        <>
          <h1 className="onboarding-title">Sign in</h1>
          <p className="onboarding-sub">
            Your wallet will show a plain-text message rather than a transaction. There is no gas
            estimate on it and no spending limit. Signing proves the address is yours, so Usance can
            show you what it holds.
          </p>
          {phase === "SESSION_REJECTED" ? (
            <Notice tone="warn" title="You declined the signature">
              Nothing was signed and nothing changed. {detail}
            </Notice>
          ) : null}
          <button className="btn btn-primary btn-lg btn-block" onClick={onSignIn}>
            {phase === "SESSION_REJECTED" ? "Try again" : "Sign in"}
          </button>
          <Link className="btn btn-ghost btn-block" href="/assets">Continue without signing in</Link>
        </>
      );

    case "READY":
      return (
        <>
          <h1 className="onboarding-title">You are in</h1>
          <p className="onboarding-sub">Taking you to your portfolio.</p>
        </>
      );
  }
}

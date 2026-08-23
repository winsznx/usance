import Link from "next/link";
import { Notice } from "@/components/primitives";
import { AppShell } from "@/components/app-shell";
import { activeChain, loadDeployment } from "@/lib/deployments";
import { MANDATE_ACTIONS, WITHDRAWAL_IS_NOT_DELEGABLE } from "@/lib/mandate";
import { loadMandate, type MandateDetail } from "@/lib/mandate-read";

/**
 * `/app/mandates/[mandateId]` — everything a signature actually granted.
 *
 * Read from the chain rather than from a cache, because the question this page answers is "what can
 * this agent do to me right now", and an answer that is a few blocks old is the wrong answer at
 * exactly the moment somebody is trying to revoke.
 *
 * Status is computed with expiry folded in. The registry emits no event when a mandate lapses, so a
 * page that only reflected events would show an expired mandate as active indefinitely.
 */

export const dynamic = "force-dynamic";

const TONE: Record<string, { tone: "neutral" | "warn" | "stop"; blurb: string }> = {
  ACTIVE: { tone: "neutral", blurb: "This agent can act on your account right now, within the limits below." },
  PAUSED: { tone: "warn", blurb: "Suspended. The agent cannot act until you resume it. Nothing is lost." },
  REVOKED: { tone: "stop", blurb: "Permanently ended. Revocation cannot be undone, and a new mandate needs a new signature." },
  EXPIRED: { tone: "stop", blurb: "Past its expiry. The agent can no longer act, and a new mandate needs a new signature." },
};

export default async function MandateDetailPage({ params }: { params: Promise<{ mandateId: string }> }) {
  const { mandateId } = await params;
  const chain = activeChain();
  const deployment = await loadDeployment(chain.id);
  const lookup = await loadMandate(mandateId);

  return (
    <AppShell>
      <div style={{ maxWidth: 820, margin: "0 auto" }}>
        <Link href="/app/mandates" className="caption" style={{ textDecoration: "underline" }}>
          ← All mandates
        </Link>

        {!deployment ? (
          <Notice tone="stop" title={`Usance is not deployed on ${chain.name}`}>
            There is no registry to read this mandate from.
          </Notice>
        ) : lookup.outcome === "UNREADABLE" ? (
          <Notice
            tone="warn"
            title="Could not read the registry"
            action={<Link className="btn btn-ghost" href="/app/mandates">Back</Link>}
          >
            {lookup.reason} This does not mean the mandate does not exist. It means Usance could not
            check. Do not sign a replacement on the strength of this screen.
          </Notice>
        ) : lookup.outcome === "NOT_FOUND" ? (
          <Notice
            tone="stop"
            title="No mandate with that id"
            action={<Link className="btn btn-ghost" href="/app/mandates">Back</Link>}
          >
            The registry has no record of <span className="mono">{mandateId.slice(0, 18)}…</span>. A
            mandate id is derived from its owner and nonce, so a typo produces an id that has never
            existed rather than somebody else&rsquo;s mandate.
          </Notice>
        ) : (
          <Detail mandate={lookup.mandate} explorer={chain.explorerUrl} />
        )}
      </div>
    </AppShell>
  );
}

function Detail({ mandate, explorer }: { mandate: MandateDetail; explorer?: string }) {
  const copy = TONE[mandate.status] ?? TONE["ACTIVE"]!;
  const granted = MANDATE_ACTIONS.filter((a) => (mandate.allowedActions & (1 << a.bit)) !== 0);
  const refused = granted.filter((a) => !a.delegable);

  return (
    <div className="stack" style={{ gap: 18, marginTop: 24 }}>
      <div>
        <div className="micro">Mandate</div>
        <h1 className="heading-lg mono" style={{ margin: "10px 0 0", fontSize: 20, wordBreak: "break-all" }}>
          {mandate.mandateId}
        </h1>
      </div>

      <Notice tone={copy.tone} title={mandate.status}>{copy.blurb}</Notice>
      <Notice title="What this mandate can never do">{WITHDRAWAL_IS_NOT_DELEGABLE}</Notice>

      <div className="card">
        <div className="micro" style={{ marginBottom: 12 }}>Who</div>
        <Row label="Owner" value={mandate.owner} mono />
        <Row label="Authorised agent" value={mandate.agent} mono />
        <Row label="Nonce" value={mandate.nonce} />
      </div>

      <div className="card">
        <div className="micro" style={{ marginBottom: 12 }}>What the agent may do</div>
        {granted.length === 0 ? (
          <p className="caption" style={{ margin: 0 }}>Nothing. This mandate grants no actions.</p>
        ) : (
          granted.map((a) => (
            <Row
              key={a.name}
              label={a.label}
              value={a.delegable ? (a.raisesRisk ? "permitted · raises risk" : "permitted") : "granted, refused by the protocol"}
            />
          ))
        )}
      </div>

      {refused.length > 0 ? (
        <Notice tone="warn" title="Granted but not executable">
          {refused.map((a) => a.label).join(", ")} sits inside this signature and Usance refuses it:
          no venue execution path is wired, so the grant authorises an act with nowhere to go. Shown
          so the mandate is not read as conferring more than it does.
        </Notice>
      ) : null}

      <div className="card">
        <div className="micro" style={{ marginBottom: 12 }}>Limits, and what has been used</div>
        <Row label="Debt ceiling" value={`$${mandate.maxDebtUsd}`} />
        <Row label="Drawn against it" value={`$${mandate.debtDrawnUsd18}`} />
        <Row label="Notional ceiling" value={`$${mandate.maxTradeNotionalUsd}`} />
        <Row label="Traded against it" value={`$${mandate.notionalTradedUsd18}`} />
        <Row label="Maximum slippage" value={`${(mandate.maxSlippageBps / 100).toFixed(2)}%`} />
        <Row label="Valid from" value={new Date(mandate.validFrom * 1000).toISOString().replace("T", " ").slice(0, 19)} />
        <Row label="Expires" value={new Date(mandate.expiresAt * 1000).toISOString().replace("T", " ").slice(0, 19)} />
      </div>

      <div className="card">
        <div className="micro" style={{ marginBottom: 12 }}>Advanced</div>
        <Row label="Registry" value={mandate.registry} mono />
        <Row label="Typed-data domain" value={mandate.domainSeparator} mono />
        <p className="caption" style={{ margin: "12px 0 0" }}>
          The domain separator binds this signature to this contract on this chain. The same typed
          data signed for a different chain or a different registry recovers to nothing here.
        </p>
      </div>

      {mandate.status === "REVOKED" ? (
        <Notice tone="stop" title="Revocation is final">
          There is no un-revoke function anywhere in the registry. Authorising this agent again means
          signing a new mandate with a new nonce.
        </Notice>
      ) : (
        <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
          <button className="btn btn-ghost btn-lg" disabled>
            {mandate.status === "PAUSED" ? "Resume" : "Pause"}
          </button>
          <button className="btn btn-lg" disabled style={{ borderColor: "var(--stop)", color: "var(--stop)" }}>
            Revoke
          </button>
          <span className="caption" style={{ alignSelf: "center" }}>
            Not wired to a wallet yet. These would submit transactions, and a disabled control is
            more honest than one that does nothing.
          </span>
        </div>
      )}
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="row-between" style={{ padding: "10px 0", borderTop: "1px solid var(--hairline)", gap: 16 }}>
      <span className="caption">{label}</span>
      <span className={`caption${mono ? " mono" : ""}`} style={{ textAlign: "right", wordBreak: "break-all" }}>
        {value}
      </span>
    </div>
  );
}

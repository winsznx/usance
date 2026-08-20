"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AccountShell } from "@/components/account-shell";
import { Notice } from "@/components/primitives";
import { OnChain } from "@/components/onchain";
import type { InstanceDetail } from "@/lib/sentinel-read";

/** Local, so this client page never imports the server-only sentinels lib (which pulls Node built-ins). */
const short = (h: string): string => (h ? `${h.slice(0, 10)}…${h.slice(-6)}` : "—");

type Load =
  | { outcome: "OK"; instances: InstanceDetail[] }
  | { outcome: "UNREADABLE"; reason: string }
  | null;

/**
 * `/app/sentinels` — the owner's armed agents.
 *
 * Gated by `AccountShell` (a Sentinel is account-bound state), reads the owner's instances through
 * `/api/sentinels`, and every row links to the detail page where it can be paused or revoked.
 */
export default function SentinelsAppPage() {
  return (
    <AccountShell
      title="Sentinels"
      intro="Autonomous agents you have armed. Each acts only through a mandate you signed — you can pause or revoke any of them, and a compromised agent still cannot withdraw your collateral."
    >
      {(account) => <InstanceList account={account} />}
    </AccountShell>
  );
}

function InstanceList({ account }: { account: `0x${string}` }) {
  const [state, setState] = useState<Load>(null);

  useEffect(() => {
    let live = true;
    fetch(`/api/sentinels?owner=${account}`)
      .then((r) => r.json())
      .then((d) => live && setState(d))
      .catch(() => live && setState({ outcome: "UNREADABLE", reason: "Could not load your Sentinels." }));
    return () => {
      live = false;
    };
  }, [account]);

  return (
    <div className="stack">
      <div className="row-between" style={{ alignItems: "center" }}>
        <div className="micro">Your Sentinels</div>
        <Link href="/app/sentinels/new" className="btn btn-primary">Arm a Sentinel</Link>
      </div>

      {state === null ? (
        <div className="skeleton" style={{ height: 140 }} />
      ) : state.outcome === "UNREADABLE" ? (
        <Notice tone="warn" title="Cannot read your Sentinels">{state.reason}</Notice>
      ) : state.instances.length === 0 ? (
        <Notice title="No Sentinels armed yet">
          You have not armed any Sentinels. Browse the{" "}
          <Link href="/sentinels">Sentinel Library</Link> or arm one directly.
        </Notice>
      ) : (
        <div className="stack" style={{ gap: 12 }}>
          {state.instances.map((i) => (
            <InstanceCard key={i.instanceId} inst={i} />
          ))}
        </div>
      )}
    </div>
  );
}

const STATUS_RISK: Record<string, string> = { REGISTERED: "NORMAL", PAUSED: "NO_NEW_RISK", REVOKED: "MARGIN_CALL" };

function InstanceCard({ inst }: { inst: InstanceDetail }) {
  return (
    <Link href={`/app/sentinels/${inst.instanceId}`} className="card" style={{ display: "block", textDecoration: "none" }}>
      <div className="row-between" style={{ alignItems: "baseline" }}>
        <strong style={{ fontWeight: 500 }}>Sentinel</strong>
        <span className={`risk risk-${STATUS_RISK[inst.status] ?? "NORMAL"}`}>{inst.status.toLowerCase()}</span>
      </div>
      <div className="caption" style={{ marginTop: 10 }}>
        template v{inst.templateVersion} · <span className="mono">{short(inst.templateId)}</span>
      </div>
      <div className="row" style={{ gap: 16, marginTop: 12, flexWrap: "wrap" }}>
        <span className="caption">agent <OnChain kind="address" value={inst.agentExecutor as `0x${string}`} /></span>
        <span className="caption">armed {new Date(inst.createdAt * 1000).toISOString().slice(0, 10)}</span>
      </div>
    </Link>
  );
}

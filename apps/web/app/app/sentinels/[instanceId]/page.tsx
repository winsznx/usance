"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { AccountShell } from "@/components/account-shell";
import { Notice, Stat } from "@/components/primitives";
import { OnChain } from "@/components/onchain";
import { TxTimeline } from "@/components/action";
import { activeChain } from "@/lib/deployments";
import { sendTransaction, type TxState } from "@/lib/tx";
import { SENTINEL_INSTANCE_WRITE_ABI, type InstanceDetail } from "@/lib/sentinel-read";

type Load =
  | { outcome: "FOUND"; instance: InstanceDetail }
  | { outcome: "NOT_FOUND" }
  | { outcome: "UNREADABLE"; reason: string }
  | null;

/**
 * `/app/sentinels/[instanceId]` — one Sentinel, with the controls that end it.
 *
 * Pause / Resume / Revoke are the app's first real contract writes: they go through the shared
 * `sendTransaction` funnel (builder-code suffix, `CONFIRMATION_UNKNOWN` on a lost RPC, never a
 * silent retry) and render through `TxTimeline`. Only the owner sees live controls; a guardian
 * pause is called out as something the owner cannot lift.
 */
export default function InstancePage() {
  return (
    <AccountShell title="Sentinel" intro="What this agent points at, and the controls to pause or end it.">
      {(account) => <InstanceDetailView account={account} />}
    </AccountShell>
  );
}

function InstanceDetailView({ account }: { account: `0x${string}` }) {
  const params = useParams<{ instanceId: string }>();
  const instanceId = params.instanceId;
  const chain = activeChain();
  const [state, setState] = useState<Load>(null);
  const [tx, setTx] = useState<TxState>({ stage: "IDLE" });

  const reload = useCallback(() => {
    let live = true;
    fetch(`/api/sentinels/instance?id=${instanceId}`)
      .then((r) => r.json())
      .then((d) => live && setState(d))
      .catch(() => live && setState({ outcome: "UNREADABLE", reason: "Could not read this Sentinel." }));
    return () => {
      live = false;
    };
  }, [instanceId]);

  useEffect(() => reload(), [reload]);

  if (state === null) return <div className="skeleton" style={{ height: 200 }} />;
  if (state.outcome === "NOT_FOUND")
    return <Notice title="No such Sentinel">Nothing is registered under this id.</Notice>;
  if (state.outcome === "UNREADABLE")
    return <Notice tone="warn" title="Cannot read this Sentinel">{state.reason}</Notice>;

  const inst = state.instance;
  const isOwner = account.toLowerCase() === inst.owner.toLowerCase();
  const busy = tx.stage !== "IDLE" && tx.stage !== "COMPLETE" && tx.stage !== "REJECTED" && tx.stage !== "FAILED";

  const act = async (functionName: "pause" | "resume" | "revoke") => {
    await sendTransaction({
      to: inst.registry as `0x${string}`,
      abi: SENTINEL_INSTANCE_WRITE_ABI as never,
      functionName,
      args: [inst.instanceId as `0x${string}`],
      from: account,
      onStage: setTx,
    });
  };

  return (
    <div className="stack">
      <div className="row-between" style={{ alignItems: "baseline" }}>
        <div className="micro">
          <Link href="/app/sentinels" className="muted">Sentinels</Link> · instance
        </div>
        <span className="tag">{inst.status.toLowerCase()}</span>
      </div>

      <div className="card card-flush">
        <Stat label="Status" value={inst.status} />
        <Stat label="Template" value={`v${inst.templateVersion}`} />
        <Stat label="Armed" value={new Date(inst.createdAt * 1000).toISOString().slice(0, 10)} />
      </div>

      <div className="card card-flush">
        <DetailRow label="Owner"><OnChain kind="address" value={inst.owner as `0x${string}`} /></DetailRow>
        <DetailRow label="Agent executor"><OnChain kind="address" value={inst.agentExecutor as `0x${string}`} /></DetailRow>
        <DetailRow label="Template id"><span className="mono">{inst.templateId.slice(0, 18)}…</span></DetailRow>
        <DetailRow label="Manifest hash"><span className="mono">{inst.manifestHash.slice(0, 18)}…</span></DetailRow>
        <DetailRow label="Mandate"><span className="mono">{inst.mandateId.slice(0, 18)}…</span></DetailRow>
        <DetailRow label="Config hash"><span className="mono">{inst.configHash.slice(0, 18)}…</span></DetailRow>
      </div>

      {/* ------------------------------------------------------------------ controls */}
      {!isOwner ? (
        <Notice title="You are not this Sentinel's owner">
          Only the owner can pause or revoke it. You are connected as a different address.
        </Notice>
      ) : inst.status === "REVOKED" ? (
        <Notice title="This Sentinel is revoked">
          Revocation is terminal. Re-arming is a fresh registration over a fresh mandate.
        </Notice>
      ) : (
        <div className="stack-sm">
          {inst.status === "PAUSED" && inst.pausedByGuardian ? (
            <Notice tone="warn" title="Paused by a guardian">
              A guardian paused this Sentinel. You cannot lift a guardian pause; only a guardian or
              governance can. You can still revoke it.
            </Notice>
          ) : null}
          <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
            {inst.status === "REGISTERED" ? (
              <button className="btn" disabled={busy} onClick={() => act("pause")}>Pause</button>
            ) : null}
            {inst.status === "PAUSED" && !inst.pausedByGuardian ? (
              <button className="btn" disabled={busy} onClick={() => act("resume")}>Resume</button>
            ) : null}
            <button className="btn btn-ghost" disabled={busy} onClick={() => act("revoke")}>Revoke</button>
          </div>
        </div>
      )}

      {tx.stage !== "IDLE" ? (
        <div>
          <TxTimeline tx={tx} explorerUrl={chain.explorerUrl} />
          {tx.stage === "COMPLETE" ? (
            <button className="btn btn-ghost" style={{ marginTop: 12 }} onClick={() => { setTx({ stage: "IDLE" }); reload(); }}>
              Refresh
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="row-between" style={{ padding: "12px 0", borderBottom: "1px solid var(--hairline)", gap: 16 }}>
      <span className="caption">{label}</span>
      <span style={{ textAlign: "right" }}>{children}</span>
    </div>
  );
}

"use client";

import { useState } from "react";
import { Notice } from "@/components/primitives";
import { AUTHORITY_PROOFS } from "@/lib/institutional-proof";
import type { TimelineItem } from "@/lib/substitution-evidence-timeline";

type ReceiptOperation = {
  request_id: string;
  replacement_instrument_id?: string;
  requested_units?: number | string;
  state: string;
};

type CurrentRead = {
  outcome: string;
  onChainSubstitutionState?: string;
};

const HASHSCAN_TX = (hash: string) => `https://hashscan.io/testnet/transaction/${hash}`;

function truncate(value: string): string {
  return value.length > 14 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value;
}

function CopyableHash({ value, href }: { value: string; href?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="mono caption" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      {href ? <a href={href} target="_blank" rel="noreferrer">{truncate(value)}</a> : truncate(value)}
      <button
        type="button"
        className="btn btn-ghost"
        style={{ padding: "1px 6px", fontSize: 11 }}
        onClick={async () => {
          try { await navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard unavailable */ }
        }}
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </span>
  );
}

const PROVENANCE_LABEL: Record<TimelineItem["provenance"], string> = {
  DURABLE_EVENT: "Durable record",
  ONCHAIN_EVIDENCE: "Onchain evidence",
  PROOF_MANIFEST: "Proof record",
  CURRENT_STATE: "Current read",
};

/**
 * Renders the completed or release-paused surface for one durable substitution operation. This is
 * a product receipt, not an explorer dashboard: the top summary answers "what happened and is
 * collateral safe" in one glance, and every hash/enum lives in a secondary, expandable spot.
 */
export function SubstitutionReceipt({
  operation,
  current,
  timeline,
  seriesA,
  seriesB,
}: {
  operation: ReceiptOperation;
  current: CurrentRead;
  timeline: TimelineItem[];
  seriesA: { series: string; committed: string | number };
  seriesB: { series: string; committed: string | number };
}) {
  const isCompleted = operation.state === "COMPLETED";
  const isBlocked = operation.state.startsWith("RELEASE_BLOCKED");

  return (
    <div className="stack" style={{ gap: 20 }}>
      <SummaryCard operation={operation} isCompleted={isCompleted} isBlocked={isBlocked} seriesA={seriesA} seriesB={seriesB} />
      {isBlocked ? <BlockedNotice operation={operation} /> : null}

      <section className="grid-3" style={{ gap: 16 }}>
        <EvidenceCard title="Organization authority">
          <EvidenceRow label="ENS delegated role" value={AUTHORITY_PROOFS.ens.role} status="Live testnet evidence" />
          <EvidenceRow label="Organization approval" value={`${AUTHORITY_PROOFS.privy.quorum} · Privy`} status="Recorded" />
        </EvidenceCard>
        <EvidenceCard title="Lender policy">
          <EvidenceRow label="Decision" value={AUTHORITY_PROOFS.cre.decision} status="Chainlink CRE · confidential" />
          <EvidenceRow label="Proof level" value="LIVE_SIMULATION" status="Not a deployed DON" />
        </EvidenceCard>
        <EvidenceCard title="Collateral operations">
          <EvidenceRow label={`Series ${seriesB.series} secured`} value={`${seriesB.committed} units`} status="Hedera ATS hold" />
          <EvidenceRow label={`Series ${seriesA.series} released`} value={isCompleted ? "Existing collateral released" : "Still secured"} status="Hedera ATS" />
        </EvidenceCard>
      </section>

      <SafetyEvents timeline={timeline} />
      <EvidenceTimeline timeline={timeline} />
    </div>
  );
}

function SummaryCard({ operation, isCompleted, isBlocked, seriesA, seriesB }: {
  operation: ReceiptOperation; isCompleted: boolean; isBlocked: boolean;
  seriesA: { series: string; committed: string | number }; seriesB: { series: string; committed: string | number };
}) {
  return (
    <section className="card">
      <div className="row-between">
        <div>
          <div className="micro">Collateral replacement</div>
          <h2 className="heading" style={{ margin: "8px 0 0" }}>
            {isCompleted ? "Completed" : isBlocked ? "Release paused" : operation.state.replace(/_/g, " ").toLowerCase()}
          </h2>
        </div>
        <span className="tag">Financing remains open</span>
      </div>
      <div className="grid-2" style={{ gap: 16, marginTop: 18 }}>
        <div className="stack-sm">
          <div className="stat-label">Facility</div>
          <div className="stat-value">ACTIVE</div>
        </div>
        <div className="stack-sm">
          <div className="stat-label">Previous collateral</div>
          <div className="stat-value">Series {seriesA.series} — {isCompleted ? "RELEASED" : "SECURED"}</div>
        </div>
        <div className="stack-sm">
          <div className="stat-label">Current collateral</div>
          <div className="stat-value">Series {seriesB.series} — {seriesB.committed} SECURED</div>
        </div>
        <div className="stack-sm">
          <div className="stat-label">Financing</div>
          <div className="stat-value">OPEN</div>
        </div>
      </div>
    </section>
  );
}

function BlockedNotice({ operation }: { operation: ReceiptOperation }) {
  const reason = operation.state === "RELEASE_BLOCKED"
    ? "Settlement valuation evidence was stale."
    : operation.state === "RELEASE_BLOCKED_REPLACEMENT_PRICE_STALE"
      ? "Replacement collateral valuation evidence was stale."
      : "A financial-safety check did not pass.";
  return (
    <Notice tone="warn" title="Why release is paused">
      {reason} Existing collateral remains secured and financing remains open. This is a safety control working as intended, not a failed operation.
    </Notice>
  );
}

function EvidenceCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card stack" style={{ gap: 12 }}>
      <div className="micro">{title}</div>
      {children}
    </div>
  );
}

function EvidenceRow({ label, value, status }: { label: string; value: string; status: string }) {
  return (
    <div className="row-between">
      <div>
        <div style={{ fontSize: 14 }}>{label}</div>
        <div className="caption">{value}</div>
      </div>
      <span className="caption" style={{ color: "var(--stone)" }}>{status}</span>
    </div>
  );
}

function SafetyEvents({ timeline }: { timeline: TimelineItem[] }) {
  const safety = timeline.filter((item) =>
    /release paused|reverted because its gas limit/i.test(item.title),
  );
  if (safety.length === 0) return null;
  return (
    <section className="card stack" style={{ gap: 10 }}>
      <div className="micro">Safety events</div>
      {safety.map((item, i) => (
        <Notice key={i} title={item.title}>
          {item.detail ?? "Existing collateral remained secured throughout."}
        </Notice>
      ))}
    </section>
  );
}

function EvidenceTimeline({ timeline }: { timeline: TimelineItem[] }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="card">
      <button type="button" className="btn btn-ghost" onClick={() => setOpen((v) => !v)} style={{ width: "100%", textAlign: "left" }}>
        {open ? "Hide evidence timeline" : "Show evidence timeline"}
      </button>
      {open ? (
        <ol className="steps" style={{ marginTop: 14 }}>
          {timeline.map((item, i) => (
            <li key={i}>
              <span className="step-dot">·</span>
              <span className="stack-sm" style={{ gap: 2 }}>
                <span>{item.title} <span className="caption" style={{ color: "var(--stone)" }}>· {PROVENANCE_LABEL[item.provenance]}</span></span>
                {item.txHash ? <CopyableHash value={item.txHash} href={HASHSCAN_TX(item.txHash)} /> : null}
              </span>
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}

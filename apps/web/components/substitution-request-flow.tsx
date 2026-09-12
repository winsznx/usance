"use client";

import { useEffect, useState } from "react";
import { Notice } from "@/components/primitives";
import { SubstitutionReceipt } from "@/components/substitution-receipt";
import { fetchInstitutionalSession, signIntoInstitutionalWorkspace, type InstitutionalSessionState } from "@/lib/institutional-session-client";
import type { TimelineItem } from "@/lib/substitution-evidence-timeline";
import { WalletError } from "@/lib/wallet";

type Operation = { state: string; request_id: string; replacement_instrument_id?: string; requested_units?: string | number };
const RECEIPT_STATES = new Set(["COMPLETED", "RELEASE_BLOCKED", "RELEASE_BLOCKED_REPLACEMENT_PRICE_STALE"]);
type CreateResult = {
  outcome: string;
  operation?: Operation;
  preparation?: { decisionHash: string; ensDigest: string; orgApprovalHash: string; orgApprover: string } | null;
  readiness?: { current: { facilityStatus: string; substitutionState: string } };
  reason?: string;
};
type CurrentResult = { outcome: "FOUND"; operation: Operation } | { outcome: Exclude<string, "FOUND">; reason?: string };
function foundOperation(result: CurrentResult): Operation | null {
  return result.outcome === "FOUND" ? (result as { outcome: "FOUND"; operation: Operation }).operation : null;
}

const REPLACEMENT_CANDIDATES = ["A", "B", "C"] as const;

/**
 * The authenticated "replace collateral" action. On mount it recovers whatever durable operation
 * already exists for this facility (the DB's one-active-per-facility invariant, not client state)
 * so a refresh never loses or duplicates a request. It creates at most one durable operation
 * through the real HTTP path and shows exactly the stages that pipeline actually reached.
 */
export function SubstitutionRequestFlow({ facilityId, currentSeries }: { facilityId: string; currentSeries: string }) {
  const [session, setSession] = useState<InstitutionalSessionState | null>(null);
  const [signingIn, setSigningIn] = useState(false);
  const [signInError, setSignInError] = useState<string | null>(null);
  const [replacement, setReplacement] = useState(REPLACEMENT_CANDIDATES.find((s) => s !== currentSeries) ?? "B");
  const [units, setUnits] = useState("150000");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<CreateResult | null>(null);
  const [recovered, setRecovered] = useState<Operation | null | undefined>(undefined); // undefined = still checking

  useEffect(() => {
    let active = true;
    fetchInstitutionalSession().then((s) => {
      if (!active) return;
      setSession(s);
      if (!s.authenticated) { setRecovered(null); return; }
      fetch(`/api/facilities/${facilityId}/substitutions/current`)
        .then(async (r) => (await r.json()) as CurrentResult)
        .then((data) => active && setRecovered(foundOperation(data)))
        .catch(() => active && setRecovered(null));
    });
    return () => { active = false; };
  }, [facilityId]);

  async function handleSignIn() {
    setSigningIn(true); setSignInError(null);
    try {
      const s = await signIntoInstitutionalWorkspace();
      setSession(s);
      const current = (await (await fetch(`/api/facilities/${facilityId}/substitutions/current`)).json()) as CurrentResult;
      setRecovered(foundOperation(current));
    } catch (e) {
      setSignInError(e instanceof WalletError ? e.message : "Could not sign in.");
    } finally {
      setSigningIn(false);
    }
  }

  async function handleSubmit() {
    setSubmitting(true); setResult(null);
    const requestId = crypto.getRandomValues(new Uint8Array(32));
    const requestIdHex = `0x${Array.from(requestId, (b) => b.toString(16).padStart(2, "0")).join("")}`;
    try {
      const response = await fetch(`/api/facilities/${facilityId}/substitutions`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ replacement, units, requestId: requestIdHex }),
      });
      const created = (await response.json()) as CreateResult;
      setResult(created);
      if (created.operation) setRecovered(created.operation);
    } catch {
      setResult({ outcome: "NETWORK_ERROR" });
    } finally {
      setSubmitting(false);
    }
  }

  if (session === null) return <section className="card"><div className="micro">Replace collateral</div><div className="skeleton" style={{ height: 18, width: "40%", marginTop: 16 }} /></section>;

  if (!session.authenticated) {
    return (
      <section className="card">
        <div className="micro">Replace collateral</div>
        <p className="caption" style={{ marginTop: 10 }}>Sign in with the institutional operator wallet to prepare a new substitution request. Signing in never moves funds and costs no gas.</p>
        <button className="btn" style={{ marginTop: 14 }} onClick={handleSignIn} disabled={signingIn}>{signingIn ? "Signing in…" : "Sign in as institutional operator"}</button>
        {signInError ? <Notice tone="warn" title="Sign-in failed">{signInError}</Notice> : null}
      </section>
    );
  }

  return (
    <section className="card stack" style={{ gap: 18 }}>
      <div className="row-between"><div className="micro">Replace collateral</div><span className="tag">Signed in · {session.walletAddress.slice(0, 8)}…</span></div>
      {recovered === undefined ? (
        <div className="skeleton" style={{ height: 18, width: "40%" }} />
      ) : recovered ? (
        <>
          {RECEIPT_STATES.has(recovered.state) ? (
            <ReceiptLoader facilityId={facilityId} requestId={recovered.request_id} currentSeries={currentSeries} operation={recovered} />
          ) : (
            <>
              <Notice title="Existing durable operation recovered">This facility already has one active substitution request. A refresh recovers it rather than creating a second — only one may be active at a time.</Notice>
              <ResultTimeline operation={recovered} preparation={result?.preparation} />
            </>
          )}
        </>
      ) : (
        <>
          <div className="grid-2" style={{ gap: 14 }}>
            <label className="stack" style={{ gap: 6 }}>
              <span className="caption">Replacement series</span>
              <select className="input" value={replacement} onChange={(e) => setReplacement(e.target.value as typeof REPLACEMENT_CANDIDATES[number])} disabled={submitting}>
                {REPLACEMENT_CANDIDATES.filter((s) => s !== currentSeries).map((s) => <option key={s} value={s}>Series {s}</option>)}
              </select>
            </label>
            <label className="stack" style={{ gap: 6 }}>
              <span className="caption">Requested units</span>
              <input className="input" value={units} onChange={(e) => setUnits(e.target.value.replace(/[^0-9]/g, ""))} disabled={submitting} />
            </label>
          </div>
          <button className="btn" onClick={handleSubmit} disabled={submitting || !units}>{submitting ? "Creating…" : "Create substitution request"}</button>
          {result && !result.operation ? <Notice tone="warn" title={result.outcome.replace(/_/g, " ")}>{result.reason ?? "The operation could not be created."}</Notice> : null}
        </>
      )}
    </section>
  );
}

type GetOperationResponse = { outcome: "FOUND"; PENDING: { operation: Operation }; CURRENT: { outcome: string }; TIMELINE: TimelineItem[] } | { outcome: string };

/** Fetches the full read model (durable + current + evidence timeline) for a completed or
 *  release-paused operation and renders the demo receipt, rather than the in-progress stage list. */
function ReceiptLoader({ facilityId, requestId, currentSeries, operation }: { facilityId: string; requestId: string; currentSeries: string; operation: Operation }) {
  const [data, setData] = useState<GetOperationResponse | null>(null);
  useEffect(() => {
    let active = true;
    fetch(`/api/facilities/${facilityId}/substitutions/${requestId}`)
      .then((r) => r.json() as Promise<GetOperationResponse>)
      .then((d) => active && setData(d))
      .catch(() => active && setData({ outcome: "NETWORK_ERROR" }));
    return () => { active = false; };
  }, [facilityId, requestId]);

  if (!data) return <div className="skeleton" style={{ height: 120 }} />;
  if (data.outcome !== "FOUND") return <Notice tone="warn" title="Could not load the receipt">Try refreshing.</Notice>;
  const found = data as Extract<GetOperationResponse, { outcome: "FOUND" }>;

  const isCompleted = operation.state === "COMPLETED";
  const replacementSeries = operation.replacement_instrument_id ?? "B";
  // `currentSeries` is the page's static "collateral before any replacement" reference and is not
  // reliable once a replacement has completed. For this operation the prior series is simply
  // whichever of A/B was not the replacement — the only two series this facility's demo lifecycle
  // ever moves between.
  const oldSeries = replacementSeries === currentSeries ? (replacementSeries === "A" ? "B" : "A") : currentSeries;
  const requestedUnits = operation.requested_units ?? "150000";

  return (
    <SubstitutionReceipt
      operation={found.PENDING.operation}
      current={found.CURRENT}
      timeline={found.TIMELINE}
      seriesA={{ series: oldSeries, committed: isCompleted ? 0 : "150,000" }}
      seriesB={{ series: replacementSeries, committed: isCompleted ? requestedUnits : "committing" }}
    />
  );
}

function ResultTimeline({ operation, preparation }: { operation: Operation; preparation?: CreateResult["preparation"] }) {
  const state = operation.state;
  const stages: { label: string; status: "done" | "current" | "blocked" | "pending" }[] = [
    { label: "Session — authenticated", status: "done" },
    { label: "Facility — ACTIVE", status: "done" },
    { label: `Preparation — ${state === "CREATED" ? "starting" : "ready"}`, status: state === "CREATED" ? "current" : "done" },
    { label: `ENS authority — ${authorityLabel(state)}`, status: authorityStatus(state) },
    { label: `Organization approval — ${state === "ORG_APPROVAL_PENDING" ? "awaiting approval" : "not yet requested"}`, status: state === "ORG_APPROVAL_PENDING" ? "current" : "pending" },
    { label: "Lender policy — not yet requested", status: "pending" },
    { label: "ATS commitment — not started", status: "pending" },
    { label: "Final financial safety — enforced at release (preview unavailable)", status: "pending" },
  ];
  return (
    <div className="stack" style={{ gap: 10, marginTop: 6 }}>
      <ol className="steps">
        {stages.map((s) => <li key={s.label} data-state={s.status === "done" ? "done" : s.status === "blocked" ? "stop" : undefined}><span className="step-dot">{s.status === "done" ? "✓" : s.status === "blocked" ? "✕" : "·"}</span><span>{s.label}</span></li>)}
      </ol>
      <p className="mono caption">requestId {operation.request_id}</p>
      {preparation ? (
        <Notice title="Privy quorum approval prepared, not sent">
          The exact digest a two-key Privy quorum would need to sign is computed and stored. This browser does not hold quorum keys and does not submit that approval.
        </Notice>
      ) : null}
      {isBlockedState(state) ? <Notice tone="stop" title="Blocked before any collateral changed">Existing collateral remains secured. {blockedReason(state)}</Notice> : null}
    </div>
  );
}

function authorityLabel(state: string) {
  if (state === "AUTHORITY_VALID" || state === "ORG_APPROVAL_PENDING") return "valid";
  if (state === "AUTHORITY_REVOKED") return "revoked";
  if (state === "AUTHORITY_REQUIRED") return "not configured";
  if (state === "AUTHORITY_UNAVAILABLE") return "unavailable";
  return "resolving";
}
function authorityStatus(state: string): "done" | "current" | "blocked" | "pending" {
  if (state === "AUTHORITY_VALID" || state === "ORG_APPROVAL_PENDING") return "done";
  if (state === "AUTHORITY_REVOKED" || state === "AUTHORITY_REQUIRED" || state === "AUTHORITY_UNAVAILABLE") return "blocked";
  return "current";
}
function isBlockedState(state: string) {
  return ["AUTHORITY_REVOKED", "AUTHORITY_REQUIRED", "AUTHORITY_UNAVAILABLE", "COMMITMENT_UNKNOWN"].includes(state);
}
function blockedReason(state: string) {
  if (state === "AUTHORITY_REVOKED") return "The current ENSv2 role is revoked or its Hedera authority flag is set; a signed-in session does not itself authorize a new request.";
  if (state === "AUTHORITY_REQUIRED") return "No authority verifier is configured for this facility.";
  if (state === "COMMITMENT_UNKNOWN") return "An existing commitment requires authoritative reconciliation before a new request can proceed.";
  return "Current facility/authority state could not be read.";
}

"use client";

import { useEffect, useState } from "react";
import { Notice } from "@/components/primitives";

type Instrument = { symbol: string; rawClaim: string; oracleUpdatedAt: string; oracleAgeSeconds: string; oracleLive: boolean; session: string; admitted: boolean };
type Result =
  | { outcome: "READY"; observedAt: string; observedAtBlock: string; provenance: { facilityAddress: string; facilityType: string }; facility: { status: string; debtUsd18: string; recognisedValueUsd18: string; maxDebtUsd18: string; availableCapacityUsd18: string; riskEpoch: string; policyVersion: string; policyStatus: string; instruments: Instrument[] } }
  | { outcome: "STALE"; observedAt: string; observedAtBlock: string; reason: string; facility: { status: string; debtUsd18: string; riskEpoch: string; policyVersion: string; policyStatus: string; instruments: Instrument[] } }
  | { outcome: "PORTFOLIO_UNKNOWN"; observedAt: string; observedAtBlock: string; reason: string }
  | { outcome: "UNAVAILABLE"; reason: string };

/** Current Base data comes solely from the read API. The lifecycle proof is rendered elsewhere as history. */
export function BaseFacilityLiveState() {
  const [state, setState] = useState<Result | null>(null);
  useEffect(() => {
    let active = true;
    fetch("/api/capital/base-sepolia").then(async (response) => response.json()).then((data: Result) => { if (active) setState(data); }).catch((error: Error) => { if (active) setState({ outcome: "UNAVAILABLE", reason: error.message }); });
    return () => { active = false; };
  }, []);
  if (state === null) return <section className="card"><div className="micro">Current Base Sepolia state</div><div className="skeleton" style={{ height: 18, width: "54%", marginTop: 16 }} /></section>;
  if (state.outcome === "UNAVAILABLE") return <Notice tone="warn" title="Base operational state unavailable">{state.reason} No debt, collateral, recognised value, or capacity is inferred from the recorded lifecycle.</Notice>;
  if (state.outcome === "PORTFOLIO_UNKNOWN") return <Notice tone="warn" title="Base portfolio state unknown">{state.reason} Capacity is unavailable until the deployed facility can provide a complete portfolio read.</Notice>;
  if (state.outcome === "STALE") return <section className="stack" style={{ gap: 14 }}><Notice tone="warn" title="Base market state is stale or restricted">{state.reason}</Notice><LiveTerms facility={state.facility} observedAt={state.observedAt} observedAtBlock={state.observedAtBlock} hideCapacity /></section>;
  return <LiveTerms facility={state.facility} observedAt={state.observedAt} observedAtBlock={state.observedAtBlock} provenance={state.provenance} />;
}

function LiveTerms({ facility, observedAt, observedAtBlock, provenance, hideCapacity = false }: { facility: Extract<Result, { outcome: "READY" }>["facility"] | Extract<Result, { outcome: "STALE" }>["facility"]; observedAt: string; observedAtBlock: string; provenance?: { facilityAddress: string; facilityType: string }; hideCapacity?: boolean }) {
  return <section className="card"><div className="row-between" style={{ alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}><div><div className="micro">Current Base Sepolia facility state</div><p className="caption" style={{ margin: "7px 0 0" }}>Read at Base block {observedAtBlock} · {observedAt}</p></div><span className="tag">{facility.status}</span></div><div className="grid-3" style={{ gap: 16, marginTop: 20 }}><Datum label="Current debt (USD 18)" value={facility.debtUsd18} /><Datum label="Risk epoch" value={facility.riskEpoch} /><Datum label="Policy" value={`${facility.policyStatus} · v${facility.policyVersion}`} />{!hideCapacity && <><Datum label="Recognised value (USD 18)" value={(facility as Extract<Result, { outcome: "READY" }>["facility"]).recognisedValueUsd18} /><Datum label="Base-only max debt (USD 18)" value={(facility as Extract<Result, { outcome: "READY" }>["facility"]).maxDebtUsd18} /><Datum label="Base-only available capacity (USD 18)" value={(facility as Extract<Result, { outcome: "READY" }>["facility"]).availableCapacityUsd18} /></>}</div><div style={{ borderTop: "1px solid var(--hairline)", marginTop: 20, paddingTop: 14 }}><div className="micro">Live collateral and market inputs</div>{facility.instruments.map((instrument) => <div className="row-between" style={{ gap: 12, paddingTop: 10, flexWrap: "wrap" }} key={instrument.symbol}><strong>{instrument.symbol}</strong><span className="caption">Claim {instrument.rawClaim} · session {instrument.session} · oracle {instrument.oracleLive ? "live" : "not live"} · age {instrument.oracleAgeSeconds}s</span></div>)}</div><p className="caption" style={{ margin: "16px 0 0" }}>{provenance ? `Source: ${provenance.facilityType} at ${provenance.facilityAddress}. ` : "Source: pinned Base facility read. "}This is Base Sepolia test capital only; it is never combined with Hedera or X Layer capacity.</p></section>;
}

function Datum({ label, value }: { label: string; value: string }) { return <div><div className="micro">{label}</div><div style={{ fontWeight: 500, marginTop: 6, overflowWrap: "anywhere" }}>{value}</div></div>; }

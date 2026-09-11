"use client";

import { useEffect, useState } from "react";
import { Notice } from "@/components/primitives";

type Result =
  | { outcome: "READY"; observedAtBlock: string; facility: { status: string; outstanding: string; riskEpochAtActivation: string; collateral: { assetId: string; committedUnits: string; passportVersion: string }; substitution: { state: string; authorityExpiry: string } } }
  | { outcome: "UNAVAILABLE"; reason: string };

/** Operational Hedera state is read from the facility API; proof JSON remains separately labelled evidence. */
export function InstitutionalLiveState({ facilityId }: { facilityId: string }) {
  const [state, setState] = useState<Result | null>(null);
  useEffect(() => { let active = true; fetch(`/api/facilities/${facilityId}`).then(async (r) => r.json()).then((data) => active && setState(data)).catch((error) => active && setState({ outcome: "UNAVAILABLE", reason: (error as Error).message })); return () => { active = false; }; }, [facilityId]);
  if (state === null) return <section className="card"><div className="micro">Current Hedera facility state</div><div className="skeleton" style={{ height: 18, width: "50%", marginTop: 16 }} /></section>;
  if (state.outcome === "UNAVAILABLE") return <Notice tone="warn" title="Current facility state unavailable">{state.reason} The completed Phase 07 proof remains inspectable below, but no current debt, collateral, or substitution value is inferred from it.</Notice>;
  return <section className="card"><div className="row-between"><div className="micro">Current Hedera facility state</div><span className="tag">Read at block {state.observedAtBlock}</span></div><div className="grid-3" style={{ gap: 16, marginTop: 18 }}><Datum label="Status" value={state.facility.status}/><Datum label="Outstanding settlement units" value={state.facility.outstanding}/><Datum label="RiskEpoch at activation" value={state.facility.riskEpochAtActivation}/><Datum label="Committed units" value={state.facility.collateral.committedUnits}/><Datum label="Passport version" value={state.facility.collateral.passportVersion}/><Datum label="Substitution state" value={state.facility.substitution.state}/></div><p className="caption" style={{ margin: "16px 0 0" }}>Source: Hedera facility contract through the testnet relay. A failed read is never rendered as zero.</p></section>;
}
function Datum({ label, value }: { label: string; value: string }) { return <div><div className="micro">{label}</div><div style={{ fontWeight: 500, marginTop: 6, overflowWrap: "anywhere" }}>{value}</div></div> }

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Notice } from "@/components/primitives";
import { AccountShell } from "@/components/account-shell";
import { alertsFor, type Alert } from "@/lib/alerts";

/** `/app/alerts` — everything currently true about this account that needs a decision. */
export default function AlertsPage() {
  return (
    <AccountShell
      title="Alerts"
      intro="Derived from your account right now, not from a stored feed. Nothing here is stale."
    >
      {(account) => <Alerts account={account} />}
    </AccountShell>
  );
}

const TONE = { URGENT: "stop", WARN: "warn", INFO: "neutral" } as const;

function Alerts({ account }: { account: `0x${string}` }) {
  const [alerts, setAlerts] = useState<Alert[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetch(`/api/account?account=${account}`)
      .then((r) => r.json())
      .then((d) => {
        if (!live) return;
        if (d.outcome !== "OK") {
          setError(d.reason ?? "Usance is not deployed on this network.");
          return;
        }
        const v = d.view;
        setAlerts(
          alertsFor({
            status: v.status,
            debt: BigInt(v.debt),
            maintenanceLimit: BigInt(v.maintenanceLimit),
            borrowLimit: BigInt(v.borrowLimit),
            reserved: BigInt(v.reserved),
            riskEpoch: v.riskEpoch,
            // Read from this browser only. An epoch alert is about a quote this tab may still be
            // holding, so it is meaningless without a locally remembered epoch.
            lastSeenEpoch: Number(localStorage.getItem("usance.lastSeenEpoch") ?? "") || null,
            gates: v.gates,
            withdrawableNow: 0n,
            queuedForWithdrawal: 0n,
            mandates: [],
            now: Math.floor(Date.now() / 1000),
          }),
        );
        localStorage.setItem("usance.lastSeenEpoch", String(v.riskEpoch));
      })
      .catch((e) => live && setError((e as Error).message));
    return () => {
      live = false;
    };
  }, [account]);

  if (error) {
    return (
      <Notice tone="warn" title="Could not read your account">
        {error} This does not mean nothing is wrong — it means Usance could not check.
      </Notice>
    );
  }

  if (alerts === null) {
    return (
      <div className="card">
        <div className="skeleton" style={{ height: 18, width: "50%" }} />
      </div>
    );
  }

  if (alerts.length === 0) {
    return (
      <Notice title="Nothing needs your attention">
        Your account is within every limit, no inputs are gated, and no capital is reserved. This
        page is derived from live state, so an empty list means there is genuinely nothing to act
        on rather than that no alerts have been generated yet.
      </Notice>
    );
  }

  return (
    <div className="stack" style={{ gap: 14 }}>
      {alerts.map((a) => (
        <div className="card" key={a.id}>
          <Notice tone={TONE[a.severity]} title={a.title}>
            <div className="stack" style={{ gap: 8 }}>
              <span>{a.what}</span>
              <span style={{ color: "var(--graphite)" }}>{a.why}</span>
              {a.action ? (
                <Link className="btn btn-primary" href={a.action.href} style={{ alignSelf: "flex-start" }}>
                  {a.action.label}
                </Link>
              ) : null}
            </div>
          </Notice>
        </div>
      ))}
    </div>
  );
}

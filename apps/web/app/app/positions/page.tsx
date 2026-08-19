"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Notice, RiskBadge } from "@/components/primitives";
import { AccountShell } from "@/components/account-shell";
import { permittedActions, type AccountView } from "@/lib/account";

/**
 * `/app/positions` — the six questions a position has to answer.
 *
 * What do I own, what is recognised, what do I owe, what is reserved, which rules am I under, and
 * what may I do right now. Anything else on this page is decoration.
 *
 * There is deliberately no single liquidation price. An account holding several assets with
 * different exit curves does not have one, and inventing a number by pretending the portfolio is
 * homogeneous produces a figure that is wrong in exactly the direction that hurts — reassuring
 * right up until the asset that actually moves is the illiquid one.
 */

type Loaded =
  | { outcome: "OK"; view: SerialisedView }
  | { outcome: "NOT_DEPLOYED" }
  | { outcome: "UNREADABLE"; reason: string };

type SerialisedView = Omit<AccountView, "recognized" | "borrowLimit" | "maintenanceLimit" | "liquidationLimit" | "debt" | "availableBorrow" | "reserved" | "blockNumber" | "assets"> & {
  recognized: string; borrowLimit: string; maintenanceLimit: string; liquidationLimit: string;
  debt: string; availableBorrow: string; reserved: string; blockNumber: string;
  assets: Array<{ assetId: string; marketValueUsd18: string; haircutMarkUsd18: string; stressedExitUsd18: string; recognizedUsd18: string }>;
};

const money = (v: string): string =>
  (Number(BigInt(v)) / 1e18).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function PositionsPage() {
  return (
    <AccountShell
      title="Your position"
      intro="What you hold, what Usance recognises it as, what you owe, and what you can do right now."
    >
      {(account) => <Position account={account} />}
    </AccountShell>
  );
}

function Position({ account }: { account: `0x${string}` }) {
  const [data, setData] = useState<Loaded | null>(null);

  useEffect(() => {
    let live = true;
    fetch(`/api/account?account=${account}`)
      .then((r) => r.json())
      .then((d) => live && setData(d))
      .catch((e) => live && setData({ outcome: "UNREADABLE", reason: (e as Error).message }));
    return () => {
      live = false;
    };
  }, [account]);

  if (data === null) {
    return (
      <div className="card">
        <div className="skeleton" style={{ height: 18, width: "40%", marginBottom: 12 }} />
        <div className="skeleton" style={{ height: 44, width: "60%" }} />
      </div>
    );
  }

  if (data.outcome === "NOT_DEPLOYED") {
    return (
      <Notice tone="stop" title="Usance is not deployed on this network" action={<Link className="btn btn-ghost" href="/status">Integration status</Link>}>
        There are no contracts to read, so there is no position to show. An empty portfolio here
        would look like an account with nothing in it, which is a different claim.
      </Notice>
    );
  }

  if (data.outcome === "UNREADABLE") {
    return (
      <Notice tone="warn" title="Could not read your position">
        {data.reason} This does not mean your position is empty — it means Usance could not check.
        Nothing has changed on chain and no action is needed.
      </Notice>
    );
  }

  const v = data.view;
  const allowed = permittedActions(v.status);
  const shortfall = BigInt(v.debt) > BigInt(v.maintenanceLimit) ? BigInt(v.debt) - BigInt(v.maintenanceLimit) : 0n;

  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className="card">
        <div className="row-between" style={{ marginBottom: 16, alignItems: "center" }}>
          <div className="micro">Account status</div>
          <RiskBadge status={v.status} />
        </div>
        <div className="grid-2" style={{ gap: 14 }}>
          <Metric label="Recognised collateral" value={`$${money(v.recognized)}`} emphasis />
          <Metric label="Debt" value={`$${money(v.debt)}`} emphasis />
          <Metric label="Available to borrow" value={`$${money(v.availableBorrow)}`} />
          <Metric label="Reserved for in-flight execution" value={`$${money(v.reserved)}`} />
        </div>

        {shortfall > 0n ? (
          <div style={{ marginTop: 16 }}>
            <Notice tone="stop" title="Your debt is above the maintenance limit">
              You are ${money(shortfall.toString())} over. Repaying or adding collateral clears it.
              Seizing collateral removes borrowing capacity as well as debt, so one liquidation may
              not restore the account on its own.
            </Notice>
          </div>
        ) : null}
      </div>

      <div className="card">
        <div className="micro" style={{ marginBottom: 12 }}>Limits</div>
        <Row label="Borrow limit" value={`$${money(v.borrowLimit)}`} />
        <Row label="Maintenance limit" value={`$${money(v.maintenanceLimit)}`} />
        <Row label="Liquidation limit" value={`$${money(v.liquidationLimit)}`} />
        {/*
          Three limits, not one liquidation price. They sit at different distances from the debt and
          crossing each has a different consequence; collapsing them into a single number throws
          away the only warning a user gets before the last one.
        */}
        <p className="caption" style={{ margin: "12px 0 0" }}>
          Crossing the borrow limit blocks new borrowing. Crossing maintenance blocks withdrawal.
          Crossing liquidation makes the account liquidatable. Usance does not publish a single
          liquidation price, because an account holding several assets with different exit curves
          does not have one.
        </p>
      </div>

      {v.assets.length > 0 ? (
        <div className="card">
          <div className="micro" style={{ marginBottom: 12 }}>What you hold, and what it is recognised as</div>
          {v.assets.map((a) => (
            <div key={a.assetId} style={{ padding: "12px 0", borderTop: "1px solid var(--hairline)" }}>
              <div className="row-between">
                <span className="caption mono">{a.assetId.slice(0, 14)}…</span>
                <span className="caption tnum">${money(a.recognizedUsd18)} recognised</span>
              </div>
              <div className="row-between" style={{ marginTop: 6 }}>
                <span className="caption" style={{ color: "var(--graphite)" }}>
                  market ${money(a.marketValueUsd18)} · after haircuts ${money(a.haircutMarkUsd18)} · stressed exit ${money(a.stressedExitUsd18)}
                </span>
              </div>
            </div>
          ))}
          <p className="caption" style={{ margin: "12px 0 0" }}>
            Recognised value is the lower of the haircut mark and the stressed exit. Usance lends
            against what it believes it could realise under stress, not against the screen price.
          </p>
        </div>
      ) : null}

      <div className="card">
        <div className="micro" style={{ marginBottom: 12 }}>Which rules you are under</div>
        <Row label="Risk epoch" value={String(v.riskEpoch)} />
        <Row label="Read at block" value={v.blockNumber} />
        <p className="caption" style={{ margin: "12px 0 0" }}>
          Every quote cites an epoch. If policy moves between a preview and your signature, the
          transaction is refused rather than executed under rules you were never shown.
        </p>
      </div>

      <div className="card">
        <div className="micro" style={{ marginBottom: 12 }}>What you can do right now</div>
        <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
          <Action href="/app/collateral/add" label="Add collateral" allowed={allowed.addCollateral} />
          <Action href="/app/borrow" label="Borrow" allowed={allowed.borrow} />
          <Action href="/app/repay" label="Repay" allowed={allowed.repay} />
          <Action href="/app/withdraw" label="Withdraw" allowed={allowed.withdraw} />
        </div>
        <p className="caption" style={{ margin: "14px 0 0" }}>
          These are derived from your account status, so this page cannot offer an action the
          protocol would refuse.
        </p>
      </div>
    </div>
  );
}

function Action({ href, label, allowed }: { href: string; label: string; allowed: boolean }) {
  if (!allowed) {
    return (
      <span className="btn btn-ghost" aria-disabled="true" style={{ opacity: 0.45, cursor: "not-allowed" }}>
        {label} · unavailable
      </span>
    );
  }
  return (
    <Link className="btn btn-ghost" href={href}>
      {label}
    </Link>
  );
}

function Metric({ label, value, emphasis }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <div className="panel">
      <div className="stat-label">{label}</div>
      <div className="tnum" style={{ fontSize: emphasis ? 24 : 19, marginTop: 6 }}>{value}</div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="row-between" style={{ padding: "10px 0", borderTop: "1px solid var(--hairline)" }}>
      <span className="caption">{label}</span>
      <span className="caption tnum">{value}</span>
    </div>
  );
}

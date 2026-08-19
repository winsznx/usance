"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { CapacityDerivation, StatusLadder } from "@/components/capacity";
import { SafetyBuffer } from "@/components/buffer";
import { Advanced } from "@/components/mode";
import { Copyable } from "@/components/copyable";
import { TransactionHistory, type TxRow } from "@/components/transactions";
import { Icon } from "@/components/icon";
import { Notice, RiskBadge } from "@/components/primitives";
import { activeChain } from "@/lib/deployments";
import { alertsFor, type Alert } from "@/lib/alerts";
import { permittedActions } from "@/lib/account";
import { detectProvider } from "@/lib/wallet";
import { useRouter } from "next/navigation";
import type { AccountStatus } from "@usance/domain";

/**
 * `/app` — the overview.
 *
 * Built around the one question a Usance user has that a generic lending dashboard cannot answer:
 * *why* is my capacity this number. Four figures across the top, the derivation underneath, the
 * status ladder beside it, and whatever currently needs a decision.
 *
 * Deliberately absent: a greeting, a revenue chart, an activity feed of things that are not
 * financial events. There is no time series in this product, and a chart drawn from data that does
 * not exist is the one thing a risk interface must never do.
 */

interface Serialised {
  recognized: string; borrowLimit: string; maintenanceLimit: string; liquidationLimit: string;
  debt: string; availableBorrow: string; reserved: string; blockNumber: string;
  status: AccountStatus; gates: number; riskEpoch: number;
  assets: Array<{ assetId: string; marketValueUsd18: string; haircutMarkUsd18: string; stressedExitUsd18: string; recognizedUsd18: string }>;
}

type Loaded =
  | { outcome: "OK"; view: Serialised }
  | { outcome: "NOT_DEPLOYED" }
  | { outcome: "UNREADABLE"; reason: string };

const money = (v: string | bigint): string =>
  (Number(BigInt(v)) / 1e18).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function AppOverview() {
  const chain = activeChain();
  const [address, setAddress] = useState<`0x${string}` | null>(null);
  const [data, setData] = useState<Loaded | null>(null);
  const [checked, setChecked] = useState(false);
  const router = useRouter();
  const [txs, setTxs] = useState<TxRow[]>([]);

  /**
   * The overview does not ask for a wallet either.
   *
   * This route had its own connect card while every other account route redirected, which meant the
   * one screen a user actually lands on still prompted — the exact duplication the redirect was
   * meant to remove.
   */
  useEffect(() => {
    const { provider } = detectProvider();
    if (!provider) {
      setChecked(true);
      router.replace("/app/onboarding");
      return;
    }
    provider
      .request({ method: "eth_accounts" })
      .then((accts) => {
        const found = (accts as string[])[0] as `0x${string}` | undefined;
        if (found) setAddress(found);
        else router.replace("/app/onboarding");
      })
      .catch(() => router.replace("/app/onboarding"))
      .finally(() => setChecked(true));
  }, [router]);

  useEffect(() => {
    const { provider } = detectProvider();
    if (!provider?.on) return;
    const onAccounts = (a: string[]) => {
      const next = (a[0] as `0x${string}`) ?? null;
      setAddress(next);
      setData(null);
      if (!next) router.replace("/app/onboarding");
    };
    provider.on("accountsChanged", onAccounts);
    return () => provider.removeListener?.("accountsChanged", onAccounts);
  }, [router]);

  useEffect(() => {
    if (!address) return;
    let live = true;
    fetch(`/api/account?account=${address}`)
      .then((r) => r.json())
      .then((d) => live && setData(d))
      .catch((e) => live && setData({ outcome: "UNREADABLE", reason: (e as Error).message }));
    return () => {
      live = false;
    };
  }, [address]);

  // History lives on the overview rather than behind a link. "What has happened to my money" is one
  // of the four questions this page exists to answer, and sending somebody elsewhere defers it.
  useEffect(() => {
    if (!address) return;
    let live = true;
    fetch(`/api/activity?account=${address}`)
      .then((r) => r.json())
      .then((d) => live && setTxs(d.rows ?? []))
      .catch(() => live && setTxs([]));
    return () => {
      live = false;
    };
  }, [address]);


  const alertCount = data?.outcome === "OK" ? countAlerts(data.view) : 0;

  return (
    <AppShell account={address} alertCount={alertCount}>
      <div className="stack" style={{ gap: 20 }}>
        <div>
          <h1 className="heading-lg" style={{ margin: 0, fontSize: 26 }}>Overview</h1>
          <p className="muted" style={{ margin: "6px 0 0" }}>
            What Usance recognises, what you owe, and why the numbers are what they are.
          </p>
        </div>

        {!checked ? (
          <Skeleton />
        ) : address === null ? (
          /* Momentary: the redirect is already in flight. */
          <Notice title="Taking you to sign in">
            Usance asks for a wallet once, on its own screen, rather than on every page.
          </Notice>
        ) : data === null ? (
          <Skeleton />
        ) : data.outcome === "NOT_DEPLOYED" ? (
          <Notice tone="stop" title={`Usance is not deployed on ${chain.name}`} action={<Link className="btn btn-ghost" href="/status">Integration status</Link>}>
            There are no contracts to read. An empty overview here would look like an account with
            nothing in it, which is a different claim.
          </Notice>
        ) : data.outcome === "UNREADABLE" ? (
          <Notice tone="warn" title="Could not read your account">
            {data.reason} This does not mean your position is empty. Nothing has changed on chain
            and no action is needed.
          </Notice>
        ) : (
          <Dashboard view={data.view} txs={txs} />
        )}
      </div>
    </AppShell>
  );
}

/** Shared with the shell so the rail badge and the panel can never disagree. */
function countAlerts(view: Serialised): number {
  return alertsFor({
    status: view.status,
    debt: BigInt(view.debt),
    maintenanceLimit: BigInt(view.maintenanceLimit),
    borrowLimit: BigInt(view.borrowLimit),
    reserved: BigInt(view.reserved),
    riskEpoch: view.riskEpoch,
    lastSeenEpoch: null,
    gates: view.gates,
    withdrawableNow: 0n,
    queuedForWithdrawal: 0n,
    mandates: [],
    now: Math.floor(Date.now() / 1000),
  }).length;
}

function Dashboard({ view, txs }: { view: Serialised; txs: TxRow[] }) {
  const allowed = permittedActions(view.status);
  const totals = view.assets.reduce(
    (acc, a) => ({
      market: acc.market + BigInt(a.marketValueUsd18),
      haircut: acc.haircut + BigInt(a.haircutMarkUsd18),
      stressed: acc.stressed + BigInt(a.stressedExitUsd18),
      recognised: acc.recognised + BigInt(a.recognizedUsd18),
    }),
    { market: 0n, haircut: 0n, stressed: 0n, recognised: 0n },
  );

  const alerts: Alert[] = alertsFor({
    status: view.status,
    debt: BigInt(view.debt),
    maintenanceLimit: BigInt(view.maintenanceLimit),
    borrowLimit: BigInt(view.borrowLimit),
    reserved: BigInt(view.reserved),
    riskEpoch: view.riskEpoch,
    lastSeenEpoch: null,
    gates: view.gates,
    withdrawableNow: 0n,
    queuedForWithdrawal: 0n,
    mandates: [],
    now: Math.floor(Date.now() / 1000),
  });

  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className="kpi-row">
        <Kpi icon="collateral" value={`$${money(view.recognized)}`} label="Recognised collateral" />
        <Kpi icon="borrow" value={`$${money(view.debt)}`} label="Debt outstanding" />
        <Kpi icon="repay" value={`$${money(view.availableBorrow)}`} label="Available to borrow" />
        <Kpi icon="clock" value={`$${money(view.reserved)}`} label="Reserved for execution" />
      </div>

      <div className="dash-grid">
        <div className="stack" style={{ gap: 18 }}>
          {totals.market > 0n ? (
            <CapacityDerivation
              marketValue={totals.market}
              haircutMark={totals.haircut}
              stressedExit={totals.stressed}
              recognised={totals.recognised}
            />
          ) : (
            <Notice title="You hold no collateral Usance recognises">
              Add an admitted asset and this becomes a full derivation: market value, the haircuts
              applied to it, what it would realise under stress, and the lower of the two.
            </Notice>
          )}

          {view.assets.length > 1 ? (
            <section className="card" aria-labelledby="holdings-heading">
              <h2 id="holdings-heading" className="heading" style={{ fontSize: 17, margin: "0 0 4px" }}>
                What each holding contributes
              </h2>
              <p className="caption" style={{ margin: "0 0 14px", color: "var(--graphite)" }}>
                The derivation above is the total. This is where it comes from, so a capacity that
                moved can be traced to the asset that moved it.
              </p>
              {view.assets.map((a) => {
                const market = BigInt(a.marketValueUsd18);
                const recognised = BigInt(a.recognizedUsd18);
                // How much of this asset's market value survives to become capacity. The single
                // number that says whether a holding is pulling its weight as collateral.
                const kept = market === 0n ? 0 : Number((recognised * 1000n) / market) / 10;
                return (
                  <div key={a.assetId} style={{ padding: "12px 0", borderTop: "1px solid var(--hairline)" }}>
                    <div className="row-between" style={{ gap: 12 }}>
                      <span className="caption mono">{a.assetId.slice(0, 14)}…</span>
                      <span className="tnum">${money(a.recognizedUsd18)}</span>
                    </div>
                    <div className="row-between" style={{ marginTop: 4 }}>
                      <span className="caption" style={{ color: "var(--graphite)" }}>
                        ${money(a.marketValueUsd18)} at market
                      </span>
                      <span className="caption" style={{ color: "var(--graphite)" }}>
                        {kept.toFixed(1)}% recognised
                      </span>
                    </div>
                  </div>
                );
              })}
            </section>
          ) : null}

          <SafetyBuffer
            debt={BigInt(view.debt)}
            borrowLimit={BigInt(view.borrowLimit)}
            maintenanceLimit={BigInt(view.maintenanceLimit)}
          />

          <section className="card">
            <h2 className="heading" style={{ fontSize: 17, margin: "0 0 4px" }}>What you can do now</h2>
            <p className="caption" style={{ margin: "0 0 14px", color: "var(--graphite)" }}>
              Derived from your account status, so nothing here is offered that the protocol would
              refuse.
            </p>
            <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
              <ActionLink href="/app/collateral/add" icon="collateral" label="Add collateral" allowed={allowed.addCollateral} />
              <ActionLink href="/app/borrow" icon="borrow" label="Borrow" allowed={allowed.borrow} />
              <ActionLink href="/app/repay" icon="repay" label="Repay" allowed={allowed.repay} />
              <ActionLink href="/app/withdraw" icon="withdraw" label="Withdraw" allowed={allowed.withdraw} />
            </div>
          </section>
        </div>

        <div className="stack" style={{ gap: 18 }}>
          <section className="card">
            <div className="row-between" style={{ marginBottom: 14 }}>
              <span className="micro">Governed by</span>
              <RiskBadge status={view.status} />
            </div>
            <Row label="Risk epoch" value={String(view.riskEpoch)} />
            <Row label="Maintenance limit" value={`$${money(view.maintenanceLimit)}`} />
            <Row label="Liquidation limit" value={`$${money(view.liquidationLimit)}`} />
            {/* Provenance: what a reader needs to verify the figures above, not the figures. */}
            <Advanced>
              <Row label="Read at block" value={view.blockNumber} />
              {view.assets.map((a) => (
                <div key={a.assetId} className="row-between" style={{ padding: "9px 0", borderTop: "1px solid var(--hairline)" }}>
                  <span className="caption">Asset</span>
                  <Copyable value={a.assetId} label="asset id" />
                </div>
              ))}
            </Advanced>
            <p className="caption" style={{ margin: "12px 0 0", color: "var(--graphite)" }}>
              Every quote cites an epoch. If policy moves between a preview and your signature, the
              transaction is refused rather than executed under rules you never saw.
            </p>
          </section>

          <StatusLadder current={view.status} />

          <section className="card">
            <h2 className="heading" style={{ fontSize: 17, margin: "0 0 12px" }}>
              {alerts.length === 0 ? "Nothing needs a decision" : `${alerts.length} thing${alerts.length === 1 ? "" : "s"} to decide`}
            </h2>
            {alerts.length === 0 ? (
              <p className="caption" style={{ margin: 0, color: "var(--graphite)" }}>
                Within every limit, no gated inputs, nothing reserved. Derived live, so an empty list
                means there is genuinely nothing rather than that nothing has been generated yet.
              </p>
            ) : (
              <ul className="stack" style={{ gap: 12, listStyle: "none", margin: 0, padding: 0 }}>
                {alerts.slice(0, 3).map((a) => (
                  <li key={a.id}>
                    <div className="row" style={{ gap: 10, alignItems: "flex-start" }}>
                      <Icon name={a.severity === "URGENT" ? "stop" : a.severity === "WARN" ? "warn" : "clock"} size={17} />
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 500 }}>{a.title}</div>
                        <p className="caption" style={{ margin: "3px 0 0", color: "var(--graphite)" }}>{a.what}</p>
                        {a.action ? (
                          <Link href={a.action.href} className="caption" style={{ textDecoration: "underline", display: "inline-block", marginTop: 6 }}>
                            {a.action.label}
                          </Link>
                        ) : null}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {alerts.length > 3 ? (
              <Link href="/app/alerts" className="caption" style={{ textDecoration: "underline", display: "inline-block", marginTop: 12 }}>
                See all {alerts.length}
              </Link>
            ) : null}
          </section>
        </div>
      </div>

      <TransactionHistory rows={txs} explorer={activeChain().explorerUrl} />
    </div>
  );
}

function Kpi({ icon, value, label }: { icon: Parameters<typeof Icon>[0]["name"]; value: string; label: string }) {
  return (
    <div className="kpi">
      <Icon name={icon} size={19} />
      <div className="kpi-value">{value}</div>
      <div className="kpi-label">{label}</div>
    </div>
  );
}

function ActionLink({
  href, icon, label, allowed,
}: { href: string; icon: Parameters<typeof Icon>[0]["name"]; label: string; allowed: boolean }) {
  if (!allowed) {
    // Present but visibly unavailable, rather than removed. A user whose options silently shrink
    // cannot tell whether the action is gone or the interface is broken.
    return (
      <span className="btn btn-ghost" aria-disabled="true" style={{ opacity: 0.42, cursor: "not-allowed", gap: 8 }}>
        <Icon name={icon} size={17} />
        {label} · unavailable
      </span>
    );
  }
  return (
    <Link className="btn btn-ghost" href={href} style={{ gap: 8 }}>
      <Icon name={icon} size={17} />
      {label}
    </Link>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="row-between" style={{ padding: "9px 0", borderTop: "1px solid var(--hairline)" }}>
      <span className="caption">{label}</span>
      <span className="caption tnum">{value}</span>
    </div>
  );
}

function Skeleton() {
  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className="kpi-row">
        {[0, 1, 2, 3].map((i) => (
          <div className="kpi" key={i}>
            <div className="skeleton" style={{ height: 19, width: 19 }} />
            <div className="skeleton" style={{ height: 26, width: "70%", marginTop: 12 }} />
            <div className="skeleton" style={{ height: 12, width: "50%", marginTop: 8 }} />
          </div>
        ))}
      </div>
      <div className="card"><div className="skeleton" style={{ height: 160 }} /></div>
    </div>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { CapacityDerivation, StatusLadder } from "@/components/capacity";
import { Icon } from "@/components/icon";
import { Notice, RiskBadge } from "@/components/primitives";
import { activeChain } from "@/lib/deployments";
import { alertsFor, type Alert } from "@/lib/alerts";
import { permittedActions } from "@/lib/account";
import { connect, detectProvider, WalletError } from "@/lib/wallet";
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
  const [error, setError] = useState<{ message: string; code: string } | null>(null);
  const [hasProvider, setHasProvider] = useState(true);
  const [connecting, setConnecting] = useState(false);

  useEffect(() => setHasProvider(detectProvider().provider !== null), []);

  useEffect(() => {
    const { provider } = detectProvider();
    if (!provider?.on) return;
    const onAccounts = (a: string[]) => {
      setAddress((a[0] as `0x${string}`) ?? null);
      setData(null);
    };
    provider.on("accountsChanged", onAccounts);
    return () => provider.removeListener?.("accountsChanged", onAccounts);
  }, []);

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

  const doConnect = useCallback(async () => {
    setError(null);
    setConnecting(true);
    try {
      setAddress((await connect()).address);
    } catch (e) {
      setError(e instanceof WalletError ? { message: e.message, code: e.code } : { message: (e as Error).message, code: "UNKNOWN" });
    } finally {
      setConnecting(false);
    }
  }, []);

  return (
    <AppShell account={address}>
      <div className="stack" style={{ gap: 20 }}>
        <div>
          <h1 className="heading-lg" style={{ margin: 0, fontSize: 26 }}>Overview</h1>
          <p className="muted" style={{ margin: "6px 0 0" }}>
            What Usance recognises, what you owe, and why the numbers are what they are.
          </p>
        </div>

        {error ? (
          <Notice
            tone={error.code === "REJECTED" ? "warn" : "stop"}
            title={error.code === "REJECTED" ? "Declined in your wallet" : "Could not connect"}
            action={<button className="btn btn-ghost" onClick={() => setError(null)}>Dismiss</button>}
          >
            {error.message}
          </Notice>
        ) : null}

        {address === null ? (
          <div className="card stack" style={{ maxWidth: 520 }}>
            {!hasProvider ? (
              <Notice title="No wallet detected">
                Usance works with OKX Wallet and any standard browser wallet. On a phone, open this
                page inside your wallet&rsquo;s own browser.
              </Notice>
            ) : null}
            <p className="caption" style={{ margin: 0 }}>
              Usance needs your address and your network before it can show you anything. Connecting
              shows Usance your address and nothing else.
            </p>
            <button className="btn btn-primary btn-lg btn-block" onClick={doConnect} disabled={connecting || !hasProvider}>
              {connecting ? "Waiting for your wallet…" : "Connect wallet"}
            </button>
            <Link className="btn btn-ghost btn-block" href="/assets">Browse assets without connecting</Link>
          </div>
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
          <Dashboard view={data.view} />
        )}
      </div>
    </AppShell>
  );
}

function Dashboard({ view }: { view: Serialised }) {
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
            <Row label="Read at block" value={view.blockNumber} />
            <Row label="Maintenance limit" value={`$${money(view.maintenanceLimit)}`} />
            <Row label="Liquidation limit" value={`$${money(view.liquidationLimit)}`} />
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

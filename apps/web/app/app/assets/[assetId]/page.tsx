"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { Notice, RiskBadge } from "@/components/primitives";
import { OnChain } from "@/components/onchain";
import { ActionPanel } from "@/components/action-panel";
import { activeChain } from "@/lib/deployments";
import { readSession } from "@/lib/session";
import { permittedActions } from "@/lib/account";
import { resolveBinding, type ResolvedInstrument } from "@/lib/instrument-binding";
import type { AccountStatus } from "@usance/domain";

/**
 * `/app/assets/[assetId]` — one asset, from this account.
 *
 * Not the public Passport behind a login. That page argues admissibility to a sceptic. This one
 * answers an account holder's questions: how many units are in custody, what the asset resolves
 * to under Phase 01, and which of four different numbers actually governs a decision.
 *
 * The four numbers are kept apart on purpose. Market value is what the position is worth at the
 * mark. Recognised value is what Usance will lend against. Available-to-borrow is account-wide,
 * not a property of this asset. Debt is what is owed. Blurring any two of them is how a screen
 * tells someone they can draw money they cannot.
 */

interface Serialised {
  account: string;
  assetId: string;
  token: string | null;
  symbol: string | null;
  name: string | null;
  decimals: number | null;
  isTestFixture: boolean;
  isSettlementAsset: boolean;
  depositedUnits: string;
  totalDeposited: string;
  account_debt: string;
  account_availableBorrow: string;
  account_recognized: string;
  reserved: string;
  status: AccountStatus;
  riskEpoch: number;
  position: {
    assetId: string;
    marketValueUsd18: string;
    haircutMarkUsd18: string;
    stressedExitUsd18: string;
    recognizedUsd18: string;
  } | null;
}

type Loaded =
  | { outcome: "OK"; view: Serialised }
  | { outcome: "NOT_DEPLOYED" }
  | { outcome: "UNKNOWN_ASSET" }
  | { outcome: "UNREADABLE"; reason: string }
  | { outcome: "BAD_REQUEST"; reason: string };

const usd = (v: string): string =>
  (Number(BigInt(v)) / 1e18).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function units(v: string, decimals: number | null): string {
  if (decimals == null) return v;
  const n = BigInt(v);
  const base = 10n ** BigInt(decimals);
  const whole = n / base;
  const frac = (n % base).toString().padStart(decimals, "0").replace(/0+$/, "").slice(0, 6);
  return frac ? `${whole.toLocaleString()}.${frac}` : whole.toLocaleString();
}

const IS_HEX32 = /^0x[0-9a-fA-F]{64}$/;

export default function AssetDetailPage({ params }: { params: Promise<{ assetId: string }> }) {
  const { assetId } = use(params);
  const chain = activeChain();
  const router = useRouter();
  const [address, setAddress] = useState<`0x${string}` | null>(null);
  const [checked, setChecked] = useState(false);
  const [data, setData] = useState<Loaded | null>(null);

  const resolved = IS_HEX32.test(assetId) ? resolveBinding(assetId) : null;

  useEffect(() => {
    let live = true;
    readSession().then((state) => {
      if (!live) return;
      setChecked(true);
      if (state.status === "ACTIVE") setAddress(state.address);
      else router.replace("/app/onboarding");
    });
    return () => {
      live = false;
    };
  }, [router]);

  useEffect(() => {
    if (!address || !IS_HEX32.test(assetId)) return;
    let live = true;
    fetch(`/api/asset-position?account=${address}&assetId=${assetId}`)
      .then((r) => r.json())
      .then((d) => live && setData(d))
      .catch((e) => live && setData({ outcome: "UNREADABLE", reason: (e as Error).message }));
    return () => {
      live = false;
    };
  }, [address, assetId]);

  return (
    <AppShell account={address}>
      <div style={{ maxWidth: 820, margin: "0 auto" }}>
        <Link href="/app" className="caption" style={{ textDecoration: "underline" }}>
          ← Back to portfolio
        </Link>

        {!IS_HEX32.test(assetId) ? (
          <div style={{ marginTop: 24 }}>
            <Notice tone="stop" title="That is not an on-chain asset id">
              This page is addressed by the 32-byte <span className="mono">assetId</span> the
              protocol uses in calldata, not by a name or a Passport slug. Open an asset from your
              holdings on the overview.
            </Notice>
          </div>
        ) : !checked || (address && data === null) ? (
          <div className="card" style={{ marginTop: 24 }}>
            <div className="skeleton" style={{ height: 20, width: "40%", marginBottom: 14 }} />
            <div className="skeleton" style={{ height: 48 }} />
          </div>
        ) : address === null ? (
          <Notice title="Taking you to sign in">
            Usance asks for a wallet once, on its own screen.
          </Notice>
        ) : (
          <Body data={data!} resolved={resolved} assetId={assetId} explorer={chain.explorerUrl} chainName={chain.name} />
        )}
      </div>
    </AppShell>
  );
}

function Body({
  data,
  resolved,
  assetId,
  explorer,
  chainName,
}: {
  data: Loaded;
  resolved: ResolvedInstrument | null;
  assetId: string;
  explorer?: string;
  chainName: string;
}) {
  if (data.outcome === "NOT_DEPLOYED") {
    return (
      <div style={{ marginTop: 24 }}>
        <Notice tone="stop" title={`Usance is not deployed on ${chainName}`}>
          There are no contracts to read this asset from.
        </Notice>
      </div>
    );
  }
  if (data.outcome === "UNKNOWN_ASSET") {
    return (
      <div style={{ marginTop: 24 }}>
        <Notice tone="stop" title="No asset with that id in this deployment">
          The manifest for {chainName} lists no asset under{" "}
          <span className="mono">{assetId.slice(0, 18)}…</span>. A wrong character produces an id
          that was never registered rather than a different asset.
        </Notice>
      </div>
    );
  }
  if (data.outcome === "UNREADABLE" || data.outcome === "BAD_REQUEST") {
    return (
      <div style={{ marginTop: 24 }}>
        <Notice tone="warn" title="Could not read this asset">
          {data.reason} Nothing has changed on chain and no action is needed.
        </Notice>
      </div>
    );
  }

  const v = data.view;
  const p = v.position;
  const market = p ? BigInt(p.marketValueUsd18) : 0n;
  const recognised = p ? BigInt(p.recognizedUsd18) : 0n;
  const kept = market === 0n ? 0 : Number((recognised * 1000n) / market) / 10;
  const held = BigInt(v.depositedUnits) > 0n;
  const allowed = permittedActions(v.status);

  return (
    <div className="stack" style={{ gap: 18, marginTop: 24 }}>
      <div>
        <div className="micro">Asset · this account</div>
        <div className="row" style={{ gap: 12, flexWrap: "wrap", alignItems: "center", marginTop: 10 }}>
          <h1 className="heading-lg" style={{ margin: 0, fontSize: 22 }}>
            {v.symbol ?? "Unknown symbol"}
          </h1>
          <RiskBadge status={v.status} />
          {v.isSettlementAsset ? <span className="risk risk-NO_NEW_RISK">settlement asset</span> : null}
        </div>
        {v.name ? <p className="muted" style={{ margin: "6px 0 0" }}>{v.name}</p> : null}
      </div>

      {v.isTestFixture ? (
        <Notice tone="warn" title="Testnet fixture — no real value">
          {v.symbol} on {chainName} is a stand-in token deployed for testing. It is not FOBXX, OUSG,
          ARCOIN or any issuer&rsquo;s security, whatever a resolved identity below reads. Balances
          here move real testnet tokens and nothing else.
        </Notice>
      ) : null}

      {/* --------------------------------------------------------------- the four numbers */}
      <div className="card">
        <div className="micro" style={{ marginBottom: 12 }}>Four numbers, kept apart</div>
        {held ? (
          <>
            <div className="grid-2" style={{ gap: 14 }}>
              <Panel label="Market value" value={`$${usd(p!.marketValueUsd18)}`} note="What your units are worth at the current mark." />
              <Panel label="Recognised as collateral" value={`$${usd(p!.recognizedUsd18)}`} note={`Lower of haircut mark and stressed exit. ${kept.toFixed(1)}% of market survives.`} />
              <Panel label="Your account can draw" value={`$${usd(v.account_availableBorrow)}`} note="Account-wide headroom, not this asset alone." />
              <Panel label="Your debt" value={`$${usd(v.account_debt)}`} note="Owed across the whole account." />
            </div>
            <p className="caption" style={{ margin: "14px 0 0", color: "var(--graphite)" }}>
              This position is worth <strong>${usd(p!.marketValueUsd18)}</strong> at the current
              mark, Usance recognises <strong>${usd(p!.recognizedUsd18)}</strong> of it for
              collateral, and your account can draw <strong>${usd(v.account_availableBorrow)}</strong>{" "}
              more.
            </p>
            <div style={{ marginTop: 14 }}>
              <Row label="After haircuts" value={`$${usd(p!.haircutMarkUsd18)}`} />
              <Row label="Stressed exit" value={`$${usd(p!.stressedExitUsd18)}`} />
              <Row label="Bound by" value={BigInt(p!.stressedExitUsd18) < BigInt(p!.haircutMarkUsd18) ? "position size" : "risk policy"} />
            </div>
          </>
        ) : (
          <Notice title="You hold none of this asset">
            Nothing is in custody for your account, so it contributes nothing to recognised
            collateral. The identity and policy below still apply if you deposit it.
          </Notice>
        )}
      </div>

      {/* --------------------------------------------------------------- custody */}
      <div className="card">
        <div className="micro" style={{ marginBottom: 12 }}>In custody</div>
        <Row label="Your units" value={v.decimals != null ? `${units(v.depositedUnits, v.decimals)} ${v.symbol ?? ""}`.trim() : v.depositedUnits} />
        <Row label="Total deposited (all accounts)" value={v.decimals != null ? `${units(v.totalDeposited, v.decimals)} ${v.symbol ?? ""}`.trim() : v.totalDeposited} />
        <Row label="Token decimals" value={v.decimals != null ? String(v.decimals) : "unknown"} />
        {v.token ? (
          <div className="row-between" style={{ padding: "9px 0", borderTop: "1px solid var(--hairline)" }}>
            <span className="caption">Token</span>
            <OnChain kind="address" value={v.token} label="token contract" />
          </div>
        ) : null}
        <div className="row-between" style={{ padding: "9px 0", borderTop: "1px solid var(--hairline)" }}>
          <span className="caption">Asset id (calldata)</span>
          <OnChain kind="address" value={v.assetId} label="asset id" />
        </div>
      </div>

      {/* --------------------------------------------------------------- Phase 01 identity */}
      <div className="card">
        <div className="micro" style={{ marginBottom: 12 }}>What Phase 01 resolves this to</div>
        {resolved ? (
          <>
            <Row label="Instrument id" value={`${resolved.instrument.instrumentId.slice(0, 18)}…`} mono />
            <Row label="Domain" value={resolved.instrument.caip2} />
            <Row label="Issuer" value={`${resolved.instrument.issuerLegalName} · ${resolved.instrument.issuerJurisdiction}`} />
            <Row label="Underlying" value={`${resolved.instrument.underlying.name}${resolved.instrument.underlying.ticker ? ` (${resolved.instrument.underlying.ticker})` : ""}`} />
            <Row label="Asset class" value={resolved.instrument.underlying.assetClass} />
            <Row label="Standard" value={`${resolved.instrument.instrumentStandard} · v${resolved.instrument.instrumentVersion}`} />
            <Row label="Accounting mode" value={resolved.instrument.accountingMode} />
            <Row label="Binding kind" value={resolved.binding.legacyAssetIdKind} />
            <Row label="Bound by" value={resolved.binding.boundBy} />
            <p className="caption" style={{ margin: "12px 0 0", color: "var(--graphite)" }}>
              {resolved.binding.note}
            </p>
            <p className="caption" style={{ margin: "10px 0 0", color: "var(--stone)" }}>
              Resolution is display-only. Transactions still carry the legacy asset id above, never
              the instrument id.
            </p>
          </>
        ) : (
          <Notice title="No instrument binding on record">
            <span className="mono">{assetId.slice(0, 18)}…</span> is not in
            {" "}<span className="mono">deployments/instrument-bindings.json</span>. It is still a
            valid calldata id; it just has no forward-resolved identity yet.
          </Notice>
        )}
      </div>

      {/* --------------------------------------------------------------- governing state */}
      <div className="card">
        <div className="row-between" style={{ marginBottom: 12 }}>
          <span className="micro">Governing state</span>
          <RiskBadge status={v.status} />
        </div>
        <Row label="Risk epoch" value={String(v.riskEpoch)} />
        <Row label="Reserved for execution" value={`$${usd(v.reserved)}`} />
        <Row label="Account recognised collateral" value={`$${usd(v.account_recognized)}`} />
        <p className="caption" style={{ margin: "12px 0 0", color: "var(--graphite)" }}>
          Every quote cites this epoch. If policy moves between a preview and your signature, the
          transaction is refused rather than run under rules you never saw.
        </p>
      </div>

      {/* --------------------------------------------------------------- what you can do */}
      <div className="card">
        <div className="micro" style={{ marginBottom: 12 }}>What you can do with this asset now</div>
        <Row label="Add collateral" value={allowed.addCollateral ? "available" : "unavailable in this state"} />
        <Row label="Withdraw" value={allowed.withdraw ? "available" : "unavailable in this state"} />
        <Row label="Borrow against it" value={allowed.borrow ? "available" : "unavailable in this state"} />
        <Row label="Repay" value={allowed.repay ? "available" : "unavailable in this state"} />
        <div style={{ marginTop: 14 }}>
          <ActionPanel status={v.status} />
        </div>
      </div>

      <p className="caption" style={{ color: "var(--stone)" }}>
        Read at the same block as your portfolio.{" "}
        {explorer ? (
          <a className="hashlink" href={`${explorer.replace(/\/$/, "")}/address/${v.token ?? v.assetId}`} target="_blank" rel="noreferrer">
            View on the explorer
          </a>
        ) : null}
      </p>
    </div>
  );
}

function Panel({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="panel">
      <div className="stat-label">{label}</div>
      <div className="tnum" style={{ fontSize: 22, marginTop: 6 }}>{value}</div>
      <p className="caption" style={{ margin: "6px 0 0", color: "var(--graphite)" }}>{note}</p>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="row-between" style={{ padding: "10px 0", borderTop: "1px solid var(--hairline)", gap: 16 }}>
      <span className="caption">{label}</span>
      <span className={`caption${mono ? " mono" : ""}`} style={{ textAlign: "right", wordBreak: "break-all" }}>
        {value}
      </span>
    </div>
  );
}

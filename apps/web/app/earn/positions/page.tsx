"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Footer, Logo, Notice } from "@/components/primitives";
import { activeChain } from "@/lib/deployments";
import { connect, detectProvider, WalletError } from "@/lib/wallet";
import type { LenderPosition, VaultView } from "@/lib/vault";

/**
 * `/earn/positions` — what you supplied, and how to get it back.
 *
 * The queue is the reason this page exists as something other than a balance. A lender needs to
 * know three different numbers that a single "your balance" figure would blur together: what they
 * hold, what they could withdraw right now, and what they have already asked for and are waiting
 * on. Only the second is spendable today, and only the third is unaffected by a future default.
 */

interface Loaded {
  vault: VaultView;
  position: LenderPosition;
}

export default function PositionsPage() {
  const chain = activeChain();
  const [address, setAddress] = useState<`0x${string}` | null>(null);
  const [data, setData] = useState<Loaded | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [hasProvider, setHasProvider] = useState(true);

  useEffect(() => setHasProvider(detectProvider().provider !== null), []);

  const load = useCallback(async (who: `0x${string}`) => {
    setError(null);
    try {
      const res = await fetch(`/api/earn/position?account=${who}`);
      if (!res.ok) throw new Error(await res.text());
      setData(await res.json());
    } catch (e) {
      setData(null);
      setError((e as Error).message);
    }
  }, []);

  const doConnect = useCallback(async () => {
    try {
      const r = await connect();
      setAddress(r.address);
      await load(r.address);
    } catch (e) {
      setError(e instanceof WalletError ? e.message : (e as Error).message);
    }
  }, [load]);

  return (
    <>
      <header style={{ background: "var(--paper)", borderBottom: "1px solid var(--hairline)" }}>
        <div className="shell row-between" style={{ height: 68 }}>
          <Logo />
          <span className="tag">{chain.name}</span>
        </div>
      </header>

      <main className="shell" style={{ padding: "48px 24px 80px", maxWidth: 780 }}>
        <h1 className="heading-lg" style={{ marginBottom: 10 }}>Your position</h1>
        <p className="muted" style={{ marginTop: 0, marginBottom: 30 }}>
          What you supplied, what you can take out today, and anything you are queued for.
        </p>

        {error ? (
          <div style={{ marginBottom: 20 }}>
            <Notice tone="stop" title="Could not read your position">{error}</Notice>
          </div>
        ) : null}

        {address === null ? (
          <div className="card stack">
            {!hasProvider ? (
              <Notice title="No wallet detected">
                Usance works with OKX Wallet and any standard browser wallet.
              </Notice>
            ) : null}
            <button className="btn btn-primary btn-lg btn-block" onClick={doConnect} disabled={!hasProvider}>
              Connect wallet
            </button>
            <p className="caption" style={{ margin: 0, textAlign: "center" }}>
              You can{" "}
              <Link href="/earn" style={{ textDecoration: "underline" }}>
                see the vault
              </Link>{" "}
              without connecting.
            </p>
          </div>
        ) : data === undefined ? (
          <div className="card">
            <div className="skeleton" style={{ height: 18, width: "40%", marginBottom: 12 }} />
            <div className="skeleton" style={{ height: 44, width: "60%" }} />
          </div>
        ) : data === null ? (
          <Notice tone="stop" title="No vault on this network">
            There is nothing to read here.
          </Notice>
        ) : (
          <Position data={data} />
        )}
      </main>
      <Footer />
    </>
  );
}

function fmt(v: string | bigint, decimals: number): string {
  const n = BigInt(v);
  const whole = n / 10n ** BigInt(decimals);
  const frac = (n % 10n ** BigInt(decimals)).toString().padStart(decimals, "0").slice(0, 2);
  return `${whole.toLocaleString()}.${frac}`;
}

function Position({ data }: { data: Loaded }) {
  const { vault, position } = data;
  const d = vault.decimals;
  const sym = vault.settlementSymbol;
  const queued = position.requests.filter((r) => !r.claimed);

  if (BigInt(position.shares) === 0n && queued.length === 0) {
    return (
      <Notice
        title="You have not supplied to this vault"
        action={<Link className="btn btn-primary" href="/earn">See the vault</Link>}
      >
        Nothing to show yet.
      </Notice>
    );
  }

  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className="card">
        <div className="grid-2" style={{ gap: 14 }}>
          <div className="panel">
            <div className="stat-label">Your position</div>
            <div className="tnum" style={{ fontSize: 24, marginTop: 6 }}>
              {fmt(position.value, d)} {sym}
            </div>
          </div>
          <div className="panel">
            <div className="stat-label">Withdrawable now</div>
            <div className="tnum" style={{ fontSize: 24, marginTop: 6 }}>
              {fmt(position.withdrawableNow, d)} {sym}
            </div>
          </div>
        </div>

        {BigInt(position.withdrawableNow) < BigInt(position.value) ? (
          <div style={{ marginTop: 16 }}>
            {/*
              The honest version of "insufficient liquidity". It names the cause, the remedy, and
              the consequence of taking the remedy — rather than greying out a button.
            */}
            <Notice tone="warn" title="Part of your capital is lent out">
              You can withdraw {fmt(position.withdrawableNow, d)} {sym} immediately. The rest is
              financing borrowers and comes back as they repay. You can queue for it — your shares
              are burned when you do, which fixes your claim at today&rsquo;s value and stops it
              earning from that moment.
            </Notice>
          </div>
        ) : null}
      </div>

      {queued.length > 0 ? (
        <div className="card">
          <div className="micro" style={{ marginBottom: 12 }}>In the withdrawal queue</div>
          {queued.map((r) => (
            <div key={r.id} style={{ padding: "12px 0", borderTop: "1px solid var(--hairline)" }}>
              <div className="row-between">
                <span className="caption">Request #{r.id}</span>
                <span className="tag">{r.claimable ? "Ready to claim" : "Waiting"}</span>
              </div>
              <div className="row-between" style={{ marginTop: 6 }}>
                <span className="caption tnum">
                  {fmt(r.funded, d)} of {fmt(r.amount, d)} {sym} funded
                </span>
                <span className="caption">
                  requested {new Date(r.requestedAt * 1000).toISOString().slice(0, 10)}
                </span>
              </div>
            </div>
          ))}
          <p className="caption" style={{ margin: "14px 0 0" }}>
            The queue is paid in the order requests were made and takes priority over new lending.
            A request can be cancelled while it is still waiting; cancelling reissues shares at
            today&rsquo;s value, because leaving the queue means taking the risk back on.
          </p>
        </div>
      ) : null}
    </div>
  );
}

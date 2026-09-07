"use client";

import { useCallback, useEffect, useState } from "react";
import { type Address } from "viem";
import { AmountField, TxTimeline, useAmount } from "@/components/action";
import { Notice } from "@/components/primitives";
import { activeChain } from "@/lib/deployments";
import { sendTransaction, type TxState } from "@/lib/tx";
import {
  connectedLender,
  depositQuote,
  withdrawPreview,
  ERC20_WRITE_ABI,
  VAULT_WRITE_ABI,
  type DepositQuote,
  type WithdrawPreview,
} from "@/lib/earn-actions";

/**
 * The lender write surface, over the real `LiquidityVault` lifecycle.
 *
 *   supply:   approve exact amount to the vault  ->  supply(amount, self)
 *   withdraw: withdraw(shares, self)     — bounded by availableCash; the rest must queue
 *   queue:    requestWithdrawal(shares)  — shares burn now, claim fixed at today's price
 *   claim:    claimWithdrawal(id, self)  — only when fully funded
 *   cancel:   cancelWithdrawal(id)       — refund the funded part, reissue the rest at today's price
 *
 * No APY. No projection. Every figure is read from the contract.
 */

function done(r: TxState): boolean {
  return r.stage === "COMPLETE" || r.stage === "RECONCILING";
}
const fmt = (v: bigint, d: number) => {
  const whole = v / 10n ** BigInt(d);
  const frac = (v % 10n ** BigInt(d)).toString().padStart(d, "0").slice(0, 2);
  return `${whole.toLocaleString()}.${frac}`;
};

export function SupplyForm({ onDone }: { onDone?: () => void }) {
  const chain = activeChain();
  const [account, setAccount] = useState<Address | null | undefined>(undefined);
  const [q, setQ] = useState<DepositQuote | null | undefined>(undefined);
  const [tx, setTx] = useState<TxState>({ stage: "IDLE" });

  const refresh = useCallback(async () => {
    const a = await connectedLender();
    setAccount(a);
    if (a) setQ(await depositQuote(a));
  }, []);
  useEffect(() => void refresh(), [refresh]);

  const amount = useAmount(q?.walletBalance);
  const needsApproval = q ? q.allowance < amount.parsed : false;

  const [preview, setPreview] = useState<bigint | null>(null);
  useEffect(() => {
    if (!account || amount.isEmpty) {
      setPreview(null);
      return;
    }
    let live = true;
    void depositQuote(account, amount.parsed).then((d) => {
      if (live) setPreview(d?.previewShares ?? null);
    });
    return () => {
      live = false;
    };
  }, [account, amount.parsed, amount.isEmpty]);

  async function submit() {
    if (!account || !q || amount.isEmpty || amount.overMax) return;
    if (needsApproval) {
      const a = await sendTransaction({
        to: q.settlementToken,
        abi: ERC20_WRITE_ABI,
        functionName: "approve",
        args: [q.vault, amount.parsed],
        from: account,
        onStage: setTx,
      });
      if (!done(a)) return;
    }
    const r = await sendTransaction({
      to: q.vault,
      abi: VAULT_WRITE_ABI,
      functionName: "supply",
      args: [amount.parsed, account],
      from: account,
      onStage: setTx,
    });
    if (done(r)) {
      amount.setRaw("");
      await refresh();
      onDone?.();
    }
  }

  if (account === null) {
    return (
      <Notice title="Connect and sign in to supply">
        Supplying capital needs a signed session so the vault credits shares to the address you
        signed for.
      </Notice>
    );
  }
  if (account === undefined || q === undefined) {
    return <div className="skeleton" style={{ height: 200 }} />;
  }
  if (q === null) {
    return <Notice tone="stop" title={`No vault on ${chain.name}`}>Nothing to supply to here.</Notice>;
  }

  return (
    <div className="stack" style={{ gap: 16 }}>
      <AmountField
        label={`Amount to supply`}
        value={amount.raw}
        onChange={amount.setRaw}
        suffix={q.symbol}
        max={q.walletBalance}
        maxLabel="In your wallet"
        hint={`${fmt(q.walletBalance, q.decimals)} ${q.symbol} in your wallet.`}
      />

      {needsApproval && !amount.isEmpty ? (
        <Notice title="Two signatures">
          Supplying takes an approval and then the deposit. Usance asks for an allowance of exactly
          this amount, to the vault, so nothing can be moved later without you signing again.
        </Notice>
      ) : null}

      {preview !== null ? (
        <div className="row-between" style={{ padding: "8px 0" }}>
          <span className="caption">You would receive</span>
          <span className="caption tnum">{fmt(preview, q.decimals)} vault shares</span>
        </div>
      ) : null}

      <button
        className="btn btn-primary btn-lg btn-block"
        disabled={amount.isEmpty || amount.overMax || tx.stage === "AWAITING_WALLET" || tx.stage === "SUBMITTED"}
        onClick={submit}
      >
        {amount.isEmpty
          ? "Enter an amount"
          : needsApproval
            ? `Approve and supply ${amount.raw} ${q.symbol}`
            : `Supply ${amount.raw} ${q.symbol}`}
      </button>

      {tx.stage !== "IDLE" ? <TxTimeline tx={tx} explorerUrl={chain.explorerUrl} /> : null}

      <p className="caption" style={{ margin: 0 }}>
        Your capital is lent to borrowers, so it is not always redeemable on demand — see below for
        how getting it back works.
      </p>
    </div>
  );
}

export function WithdrawControls({
  requests,
  onDone,
}: {
  requests: Array<{ id: number; amount: string; funded: string; claimed: boolean; claimable: boolean }>;
  onDone?: () => void;
}) {
  const chain = activeChain();
  const [account, setAccount] = useState<Address | null | undefined>(undefined);
  const [p, setP] = useState<WithdrawPreview | null | undefined>(undefined);
  const [tx, setTx] = useState<TxState>({ stage: "IDLE" });

  const refresh = useCallback(async () => {
    const a = await connectedLender();
    setAccount(a);
    if (a) setP(await withdrawPreview(a));
  }, []);
  useEffect(() => void refresh(), [refresh]);

  const shares = useAmount(p?.shares);
  const [prev, setPrev] = useState<WithdrawPreview | null>(null);
  useEffect(() => {
    if (!account || shares.isEmpty) {
      setPrev(null);
      return;
    }
    let live = true;
    void withdrawPreview(account, shares.parsed).then((r) => live && setPrev(r ?? null));
    return () => {
      live = false;
    };
  }, [account, shares.parsed, shares.isEmpty]);

  async function run(functionName: "withdraw" | "requestWithdrawal", args: readonly unknown[]) {
    if (!account || !p) return;
    const r = await sendTransaction({ to: p.vault, abi: VAULT_WRITE_ABI, functionName, args, from: account, onStage: setTx });
    if (done(r)) {
      shares.setRaw("");
      await refresh();
      onDone?.();
    }
  }
  async function claimOrCancel(functionName: "claimWithdrawal" | "cancelWithdrawal", id: number) {
    if (!account || !p) return;
    const args = functionName === "claimWithdrawal" ? [BigInt(id), account] : [BigInt(id)];
    const r = await sendTransaction({ to: p.vault, abi: VAULT_WRITE_ABI, functionName, args, from: account, onStage: setTx });
    if (done(r)) {
      await refresh();
      onDone?.();
    }
  }

  if (account === null) return <Notice title="Connect and sign in to withdraw">Reading and moving your position needs a signed session.</Notice>;
  if (account === undefined || p === undefined) return <div className="skeleton" style={{ height: 160 }} />;
  if (p === null) return <Notice tone="stop" title={`No vault on ${chain.name}`}>Nothing to withdraw here.</Notice>;

  const mustQueue = prev?.mustQueue ?? false;
  const immediateCeiling = p.withdrawableNow;

  return (
    <div className="stack" style={{ gap: 16 }}>
      {p.shares > 0n ? (
        <>
          <AmountField
            label="Shares to redeem"
            value={shares.raw}
            onChange={shares.setRaw}
            suffix="shares"
            max={p.shares}
            maxLabel="Your shares"
            hint={`${fmt(p.shares, p.decimals)} shares · worth ${fmt(p.value, p.decimals)} ${p.symbol} now.`}
          />

          {prev?.previewAmount != null ? (
            <div className="row-between" style={{ padding: "8px 0" }}>
              <span className="caption">Redemption value</span>
              <span className="caption tnum">
                {fmt(prev.previewAmount, p.decimals)} {p.symbol}
              </span>
            </div>
          ) : null}

          {mustQueue ? (
            <Notice tone="warn" title="This is more than the vault can pay right now">
              Up to {fmt(immediateCeiling, p.decimals)} {p.symbol} is redeemable immediately. Redeeming
              more joins the withdrawal queue: your shares are burned now, which fixes the claim at
              today&rsquo;s value and stops it earning, and it is paid in order as borrowers repay.
            </Notice>
          ) : null}

          <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
            <button
              className="btn btn-primary btn-lg"
              disabled={shares.isEmpty || shares.overMax || mustQueue || tx.stage === "AWAITING_WALLET" || tx.stage === "SUBMITTED"}
              onClick={() => run("withdraw", [shares.parsed, account])}
            >
              {shares.isEmpty ? "Enter an amount" : `Withdraw now`}
            </button>
            <button
              className="btn btn-ghost btn-lg"
              disabled={shares.isEmpty || shares.overMax || tx.stage === "AWAITING_WALLET" || tx.stage === "SUBMITTED"}
              onClick={() => run("requestWithdrawal", [shares.parsed])}
            >
              Queue redemption
            </button>
          </div>
        </>
      ) : null}

      {requests.filter((r) => !r.claimed).length > 0 ? (
        <div className="stack" style={{ gap: 10 }}>
          <div className="micro">Your queued redemptions</div>
          {requests
            .filter((r) => !r.claimed)
            .map((r) => (
              <div key={r.id} className="row-between" style={{ padding: "10px 0", borderTop: "1px solid var(--hairline)" }}>
                <span className="caption tnum">
                  #{r.id} · {r.funded} of {r.amount} funded
                </span>
                <span className="row" style={{ gap: 8 }}>
                  <button
                    className="btn btn-sm btn-primary"
                    disabled={!r.claimable || tx.stage === "AWAITING_WALLET" || tx.stage === "SUBMITTED"}
                    onClick={() => claimOrCancel("claimWithdrawal", r.id)}
                  >
                    Claim
                  </button>
                  <button
                    className="btn btn-sm btn-ghost"
                    disabled={tx.stage === "AWAITING_WALLET" || tx.stage === "SUBMITTED"}
                    onClick={() => claimOrCancel("cancelWithdrawal", r.id)}
                  >
                    Cancel
                  </button>
                </span>
              </div>
            ))}
          <p className="caption" style={{ margin: 0 }}>
            Cancelling refunds the funded part now and reissues the rest as shares at today&rsquo;s
            value — leaving the queue means taking the risk back on.
          </p>
        </div>
      ) : null}

      {tx.stage !== "IDLE" ? <TxTimeline tx={tx} explorerUrl={chain.explorerUrl} /> : null}
    </div>
  );
}

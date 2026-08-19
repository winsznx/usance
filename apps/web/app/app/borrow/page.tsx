"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { formatUsd, type AccountStatus, type Gate } from "@usance/domain";
import { ActionShell, AmountField, GateBanners, NotDeployedNotice, PreviewRow, TxTimeline, useAmount } from "@/components/action";
import {Notice, RiskBadge} from "@/components/primitives";
import { activeChain, loadDeployment, type Deployment } from "@/lib/deployments";
import type { TxState } from "@/lib/tx";

/**
 * `/app/borrow` — get cash against recognised collateral.
 *
 * The single most important thing this page does is keep two different limits visibly separate.
 * "Your collateral supports $8,300" and "lenders currently have $400 of deployable cash" are
 * different constraints with different remedies, and a UI that shows only their minimum leaves
 * the user with no idea whether to add collateral or wait.
 *
 * The second most important thing: the amount is quoted under a specific risk epoch, and that
 * epoch is passed to the contract. If policy moves between the preview and the signature the
 * transaction reverts rather than executing under rules the user never saw.
 */

interface Quote {
  byRisk: bigint;
  byLiquidity: bigint;
  limitedByLiquidity: boolean;
  debtNow: bigint;
  borrowLimit: bigint;
  maintenanceLimit: bigint;
  rateBps: number;
  epoch: bigint;
  status: AccountStatus;
  gates: Gate[];
}

export default function BorrowPage() {
  const chain = activeChain();
  const [deployment, setDeployment] = useState<Deployment | null | undefined>(undefined);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [tx, setTx] = useState<TxState>({ stage: "IDLE" });

  useEffect(() => {
    let live = true;
    loadDeployment(chain.id).then((d) => {
      if (!live) return;
      setDeployment(d);
      // A quote is only meaningful against deployed contracts. Without one there is nothing to
      // read, and inventing a plausible number here would be exactly the lie this app avoids.
      if (d) setQuote(null);
    });
    return () => {
      live = false;
    };
  }, [chain.id]);

  const max = quote ? (quote.limitedByLiquidity ? quote.byLiquidity : quote.byRisk) : undefined;
  const amount = useAmount(max);

  const preview = useMemo(() => {
    if (!quote || amount.isEmpty) return null;
    const debtAfter = quote.debtNow + amount.parsed;
    const availableAfter = quote.borrowLimit > debtAfter ? quote.borrowLimit - debtAfter : 0n;
    // Annualised cost at the current rate. Shown as a yearly figure because a daily number on a
    // revolving credit line reads as smaller than it is.
    const annualCost = (amount.parsed * BigInt(quote.rateBps)) / 10_000n;
    const buffer = quote.maintenanceLimit > debtAfter ? quote.maintenanceLimit - debtAfter : 0n;
    return { debtAfter, availableAfter, annualCost, buffer };
  }, [quote, amount.parsed, amount.isEmpty]);

  const blocked = quote?.status !== "NORMAL";

  return (
    <>

      <ActionShell
        title="Get cash"
        intro="Borrow against the collateral Usance already recognises. Your assets stay yours."
      >
        <div className="stack" style={{ gap: 22 }}>
          {quote ? <GateBanners gates={quote.gates} /> : null}

          {quote && blocked ? (
            <Notice tone="stop" title="New borrowing is paused on this account">
              Your account is currently <RiskBadge status={quote.status} />. You can still repay,
              add collateral, or reduce exposure.
            </Notice>
          ) : null}

          <div className="card stack" style={{ gap: 20 }}>
            {/*
              Both limits, always, even when one is not binding. The user needs to know which
              constraint they are actually up against before they can do anything about it.
            */}
            {/*
              Rendered whether or not there is an account to read. These two limits have opposite
              remedies — add collateral, or wait for lenders — and understanding that is what a
              visitor needs in order to decide whether to connect at all. Gating the explanation
              behind a connection shows it only to people who no longer need it.
            */}
            <div className="grid-2" style={{ gap: 14 }}>
              <div className="panel">
                <div className="stat-label">Your collateral supports</div>
                <div className="tnum" style={{ fontSize: 24, marginTop: 6 }}>
                  {quote ? `$${formatUsd(quote.byRisk)}` : "—"}
                </div>
                <p className="caption" style={{ marginTop: 6 }}>
                  Raised by depositing more collateral.
                </p>
              </div>
              <div className="panel">
                <div className="stat-label">Lenders can fund</div>
                <div className="tnum" style={{ fontSize: 24, marginTop: 6 }}>
                  {quote ? `$${formatUsd(quote.byLiquidity)}` : "—"}
                </div>
                <p className="caption" style={{ marginTop: 6 }}>
                  Adding collateral will not raise this. It moves when lenders supply more.
                </p>
              </div>
            </div>

            {quote?.limitedByLiquidity ? (
              <Notice tone="warn" title="Limited by available lender cash, not by your collateral">
                Your collateral would support more. Borrow a smaller amount now, or wait for
                lenders to supply more liquidity. Adding collateral will not raise this number.
              </Notice>
            ) : null}

            <AmountField
              label="Amount to borrow"
              value={amount.raw}
              onChange={amount.setRaw}
              suffix={deployment?.settlementAsset.symbol ?? "USD"}
              max={max}
              maxLabel="Available"
              disabled={!deployment || blocked}
              hint={
                quote
                  ? `Rate ${(quote.rateBps / 100).toFixed(2)}% per year, variable. Quoted under risk epoch ${quote.epoch}.`
                  : undefined
              }
            />

            {amount.overMax && max !== undefined ? (
              <Notice tone="warn" title="That is more than you can borrow right now">
                Your current maximum is ${formatUsd(max)}.{" "}
                {quote?.limitedByLiquidity
                  ? "This is a liquidity limit — waiting will raise it."
                  : "Add collateral to raise it."}
              </Notice>
            ) : null}

            {preview ? (
              <div>
                <div className="micro" style={{ marginBottom: 4 }}>
                  What changes
                </div>
                <PreviewRow
                  label="Debt"
                  before={`$${formatUsd(quote!.debtNow)}`}
                  after={`$${formatUsd(preview.debtAfter)}`}
                  emphasis
                />
                <PreviewRow label="Financing cost" after={`~$${formatUsd(preview.annualCost)} / year`} />
                <PreviewRow
                  label="Still available after"
                  before={`$${formatUsd(max!)}`}
                  after={`$${formatUsd(preview.availableAfter)}`}
                />
                <PreviewRow
                  label="Buffer before maintenance"
                  after={`$${formatUsd(preview.buffer)}`}
                />
              </div>
            ) : null}

            <button
              className="btn btn-primary btn-lg btn-block"
              disabled={!deployment || blocked || amount.isEmpty || amount.overMax}
              onClick={() => setTx({ stage: "AWAITING_WALLET" })}
            >
              {amount.isEmpty ? "Enter an amount" : `Borrow $${formatUsd(amount.parsed)}`}
            </button>

            {tx.stage !== "IDLE" ? <TxTimeline tx={tx} explorerUrl={chain.explorerUrl} /> : null}
          </div>

          {deployment === null ? <NotDeployedNotice chainName={chain.name} /> : null}

          <p className="caption" style={{ margin: 0 }}>
            Borrowing is secured against your collateral. If its recognised value falls, your
            account can enter a restricted state.{" "}
            <Link href="/simulate" style={{ textDecoration: "underline" }}>
              See how recognised value is calculated
            </Link>
            .
          </p>
        </div>
      </ActionShell>
    </>
  );
}

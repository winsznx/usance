"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { formatUsd, type AccountStatus } from "@usance/domain";
import { ActionShell, AmountField, NotDeployedNotice, PreviewRow, TxTimeline, useAmount } from "@/components/action";
import {Notice, RiskBadge} from "@/components/primitives";
import { activeChain, loadDeployment, type Deployment } from "@/lib/deployments";
import type { TxState } from "@/lib/tx";

/**
 * `/app/repay` — pay down debt.
 *
 * Repaying must work when nothing else does. It is the action that gets an account out of a
 * restricted state, so it is never gated on account status and never blocked by a risk epoch: a
 * protocol that refuses repayment because the account looks unhealthy has invented a trap.
 *
 * The load-bearing detail is the shortfall. Debt is principal plus accrued interest, and the
 * account was only ever handed the principal, so "repay everything" always needs more settlement
 * token than borrowing produced. A live run failed exactly this way — the account held precisely
 * what it had borrowed and the repay-all reverted with ERC20InsufficientBalance. The number a user
 * needs is the payoff amount, not the principal, and it is quoted here before they choose.
 */

interface Quote {
  debtUsd: bigint;
  principalUsd: bigint;
  interestUsd: bigint;
  walletBalance: bigint;
  recognisedUsd: bigint;
  maintenanceLimitUsd: bigint;
  status: AccountStatus;
  symbol: string;
}

export default function RepayPage() {
  const chain = activeChain();
  const [deployment, setDeployment] = useState<Deployment | null | undefined>(undefined);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [payoff, setPayoff] = useState(false);
  const [tx, setTx] = useState<TxState>({ stage: "IDLE" });

  useEffect(() => {
    let live = true;
    loadDeployment(chain.id).then((d) => {
      if (!live) return;
      setDeployment(d);
      setQuote(null);
    });
    return () => {
      live = false;
    };
  }, [chain.id]);

  const amount = useAmount(quote?.debtUsd);
  const applied = payoff && quote ? quote.debtUsd : amount.parsed;

  const preview = useMemo(() => {
    if (!quote || applied === 0n) return null;
    const debtAfter = quote.debtUsd > applied ? quote.debtUsd - applied : 0n;
    const shortfall = applied > quote.walletBalance ? applied - quote.walletBalance : 0n;
    const bufferAfter = quote.maintenanceLimitUsd > debtAfter ? quote.maintenanceLimitUsd - debtAfter : 0n;
    return { debtAfter, shortfall, bufferAfter, clears: debtAfter === 0n };
  }, [quote, applied]);

  return (
    <>

      <ActionShell title="Repay" intro="Pay down what you owe. This always works, whatever state your account is in.">
        <div className="stack" style={{ gap: 22 }}>
          {quote && quote.status !== "NORMAL" ? (
            <Notice title="Repaying is always available">
              Your account is <RiskBadge status={quote.status} />, which pauses new borrowing.
              Repaying reduces risk, so it is never blocked — this is the action that returns the
              account to normal.
            </Notice>
          ) : null}

          <div className="card stack" style={{ gap: 20 }}>
            {quote ? (
              <div className="grid-2" style={{ gap: 14 }}>
                <div className="panel">
                  <div className="stat-label">You owe</div>
                  <div className="tnum" style={{ fontSize: 24, marginTop: 6 }}>
                    ${formatUsd(quote.debtUsd)}
                  </div>
                  <div className="caption" style={{ marginTop: 6 }}>
                    ${formatUsd(quote.principalUsd)} borrowed + ${formatUsd(quote.interestUsd)}{" "}
                    interest
                  </div>
                </div>
                <div className="panel">
                  <div className="stat-label">In your wallet</div>
                  <div className="tnum" style={{ fontSize: 24, marginTop: 6 }}>
                    ${formatUsd(quote.walletBalance)}
                  </div>
                  <div className="caption" style={{ marginTop: 6 }}>{quote.symbol}</div>
                </div>
              </div>
            ) : null}

            {/*
              Stated up front. A live run reverted on exactly this: the account held precisely what
              it had borrowed and could not clear the loan, because debt is principal plus interest
              and only the principal was ever paid out.
            */}
            <Notice title="Closing a loan costs more than you borrowed">
              Your debt is the amount you drew plus the interest it has accrued, and only the amount
              you drew was ever paid out to you. Repaying in full therefore needs more settlement
              token than borrowing produced.
            </Notice>

            <label className="row" style={{ gap: 10, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={payoff}
                disabled={!quote}
                onChange={(e) => setPayoff(e.target.checked)}
              />
              <span className="caption">
                Repay everything and close the loan
                {quote ? ` — $${formatUsd(quote.debtUsd)}` : ""}
              </span>
            </label>

            {!payoff ? (
              <AmountField
                label="Amount to repay"
                value={amount.raw}
                onChange={amount.setRaw}
                suffix={quote?.symbol ?? deployment?.settlementAsset.symbol ?? "USD"}
                max={quote?.debtUsd}
                maxLabel="Total owed"
                disabled={!deployment || !quote}
              />
            ) : null}

            {/*
              Interest accrues per block, so a payoff quoted now is stale by the time it is signed.
              The contract is told "repay all" rather than a number, which is why this is a checkbox
              and not a pre-filled amount: a fixed figure would leave dust behind and the account
              would still be open.
            */}
            {payoff ? (
              <Notice title="Quoted now, settled on chain">
                Interest accrues every block, so this figure moves between now and your signature.
                Usance sends the instruction &ldquo;repay everything&rdquo; rather than a fixed
                amount, so the loan closes exactly rather than leaving a few cents outstanding.
              </Notice>
            ) : null}

            {preview && preview.shortfall > 0n ? (
              <Notice tone="warn" title={`You need $${formatUsd(preview.shortfall)} more ${quote!.symbol}`}>
                Your debt is principal plus the interest it has accrued, and only the principal was
                ever paid out to you. Repaying in full therefore costs more than you received. Add{" "}
                ${formatUsd(preview.shortfall)} to your wallet, or repay a smaller amount now.
              </Notice>
            ) : null}

            {preview ? (
              <div>
                <div className="micro" style={{ marginBottom: 4 }}>
                  What changes
                </div>
                <PreviewRow
                  label="Debt"
                  before={`$${formatUsd(quote!.debtUsd)}`}
                  after={`$${formatUsd(preview.debtAfter)}`}
                  emphasis
                />
                {preview.clears ? (
                  <PreviewRow label="Loan" after="Closed" />
                ) : (
                  <PreviewRow label="Buffer before maintenance" after={`$${formatUsd(preview.bufferAfter)}`} />
                )}
                <PreviewRow label="Your collateral" after={`$${formatUsd(quote!.recognisedUsd)} — unchanged`} />
              </div>
            ) : null}

            <button
              className="btn btn-primary btn-lg btn-block"
              disabled={!deployment || !quote || applied === 0n || (preview?.shortfall ?? 0n) > 0n}
              onClick={() => setTx({ stage: "AWAITING_WALLET" })}
            >
              {applied === 0n
                ? "Enter an amount"
                : payoff
                  ? "Repay everything"
                  : `Repay $${formatUsd(applied)}`}
            </button>

            {tx.stage !== "IDLE" ? <TxTimeline tx={tx} explorerUrl={chain.explorerUrl} /> : null}
          </div>

          {deployment === null ? <NotDeployedNotice chainName={chain.name} /> : null}

          <p className="caption" style={{ margin: 0 }}>
            Once your debt is clear you can{" "}
            <Link href="/app/withdraw" style={{ textDecoration: "underline" }}>
              withdraw your collateral
            </Link>{" "}
            in full.
          </p>
        </div>
      </ActionShell>
    </>
  );
}

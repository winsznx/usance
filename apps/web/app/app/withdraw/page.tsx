"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { formatUsd, type AccountStatus, type Gate } from "@usance/domain";
import { ActionShell, AmountField, GateBanners, NotDeployedNotice, PreviewRow, TxTimeline, useAmount } from "@/components/action";
import { Logo, Notice, RiskBadge } from "@/components/primitives";
import { activeChain, loadDeployment, type Deployment } from "@/lib/deployments";
import type { TxState } from "@/lib/tx";

/**
 * `/app/withdraw` — take collateral back out.
 *
 * Withdrawal is the action most likely to be quietly wrong, because two different things can stop
 * it and they have opposite remedies. Either the account owes too much for the remaining collateral
 * to cover, which repayment fixes, or the account is in a state that forbids increasing risk, which
 * repayment also fixes but for a different reason. Showing one number with no explanation leaves
 * the user guessing at which.
 *
 * Withdrawing while in debt increases risk, so unlike repay it is genuinely gated. What is never
 * gated is withdrawing when nothing is owed: an account with no debt owns its collateral outright,
 * and any state machine that refuses to hand it back has stopped being custody-free.
 */

interface Quote {
  depositedUsd: bigint;
  recognisedUsd: bigint;
  withdrawableUsd: bigint;
  debtUsd: bigint;
  maintenanceLimitUsd: bigint;
  status: AccountStatus;
  gates: Gate[];
  epoch: bigint;
  symbol: string;
}

export default function WithdrawPage() {
  const chain = activeChain();
  const [deployment, setDeployment] = useState<Deployment | null | undefined>(undefined);
  const [quote, setQuote] = useState<Quote | null>(null);
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

  const amount = useAmount(quote?.withdrawableUsd);

  const preview = useMemo(() => {
    if (!quote || amount.isEmpty || quote.depositedUsd === 0n) return null;
    const recognisedDelta = (amount.parsed * quote.recognisedUsd) / quote.depositedUsd;
    const recognisedAfter = quote.recognisedUsd > recognisedDelta ? quote.recognisedUsd - recognisedDelta : 0n;
    const maintenanceAfter = (recognisedAfter * 9_000n) / 10_000n;
    const bufferAfter = maintenanceAfter > quote.debtUsd ? maintenanceAfter - quote.debtUsd : 0n;
    return { recognisedAfter, bufferAfter, closesPosition: amount.parsed >= quote.depositedUsd };
  }, [quote, amount.parsed, amount.isEmpty]);

  const debtFree = quote !== null && quote.debtUsd === 0n;
  // Only debt makes a withdrawal risk-increasing. With nothing owed there is nothing to gate.
  const blocked = quote !== null && !debtFree && quote.status !== "NORMAL";

  return (
    <>
      <header style={{ background: "var(--paper)", borderBottom: "1px solid var(--hairline)" }}>
        <div className="shell row-between" style={{ height: 68 }}>
          <Logo />
          <span className="tag">{chain.name}</span>
        </div>
      </header>

      <ActionShell title="Withdraw collateral" intro="Take your assets back out. What you can withdraw depends on what you still owe.">
        <div className="stack" style={{ gap: 22 }}>
          {quote ? <GateBanners gates={quote.gates} /> : null}

          {debtFree ? (
            <Notice title="You owe nothing">
              With no debt outstanding your collateral is yours to withdraw in full, whatever state
              the rest of the protocol is in.
            </Notice>
          ) : null}

          {blocked ? (
            <Notice tone="stop" title="Withdrawing is paused while your account is restricted">
              Your account is <RiskBadge status={quote!.status} />. Taking collateral out would
              increase risk, so it is blocked until you{" "}
              <Link href="/app/repay" style={{ textDecoration: "underline" }}>
                repay
              </Link>{" "}
              or add more collateral.
            </Notice>
          ) : null}

          <div className="card stack" style={{ gap: 20 }}>
            {/*
              Two different things stop a withdrawal and they have different remedies: debt holding
              the collateral, and a restricted account status. Naming both before an account is
              connected is what stops a blocked user guessing at which one they are hitting.
            */}
            <div className="grid-2" style={{ gap: 14 }}>
              <div className="panel">
                <div className="stat-label">You have deposited</div>
                <div className="tnum" style={{ fontSize: 24, marginTop: 6 }}>
                  {quote ? `$${formatUsd(quote.depositedUsd)}` : "—"}
                </div>
              </div>
              <div className="panel">
                <div className="stat-label">Free to withdraw</div>
                <div className="tnum" style={{ fontSize: 24, marginTop: 6 }}>
                  {quote ? `$${formatUsd(quote.withdrawableUsd)}` : "—"}
                </div>
                <p className="caption" style={{ marginTop: 6 }}>
                  {quote && quote.debtUsd > 0n
                    ? `$${formatUsd(quote.debtUsd)} of debt is holding the rest`
                    : "Debt holding your collateral limits this. A restricted account status pauses it entirely."}
                </p>
              </div>
            </div>

            <AmountField
              label="Amount to withdraw"
              value={amount.raw}
              onChange={amount.setRaw}
              suffix={quote?.symbol ?? deployment?.assets[0]?.symbol ?? "—"}
              max={quote?.withdrawableUsd}
              maxLabel="Free"
              disabled={!deployment || !quote || blocked}
              hint={quote ? `Quoted under risk epoch ${quote.epoch}.` : undefined}
            />

            {amount.overMax && quote ? (
              <Notice tone="warn" title="That is more than you can take out right now">
                You can withdraw ${formatUsd(quote.withdrawableUsd)}. The rest is backing your{" "}
                ${formatUsd(quote.debtUsd)} of debt.{" "}
                <Link href="/app/repay" style={{ textDecoration: "underline" }}>
                  Repay to free more
                </Link>
                .
              </Notice>
            ) : null}

            {preview ? (
              <div>
                <div className="micro" style={{ marginBottom: 4 }}>
                  What changes
                </div>
                <PreviewRow
                  label="Recognised collateral"
                  before={`$${formatUsd(quote!.recognisedUsd)}`}
                  after={`$${formatUsd(preview.recognisedAfter)}`}
                  emphasis
                />
                <PreviewRow label="Debt" after={`$${formatUsd(quote!.debtUsd)} — unchanged`} />
                {quote!.debtUsd > 0n ? (
                  <PreviewRow label="Buffer before maintenance" after={`$${formatUsd(preview.bufferAfter)}`} />
                ) : null}
                {preview.closesPosition ? <PreviewRow label="Position" after="Closed" /> : null}
              </div>
            ) : null}

            {preview && quote!.debtUsd > 0n && preview.bufferAfter === 0n ? (
              <Notice tone="warn" title="This leaves you with no margin">
                After this withdrawal any fall in your collateral's recognised value puts the
                account straight into a restricted state. Withdrawing less keeps a buffer.
              </Notice>
            ) : null}

            <button
              className="btn btn-primary btn-lg btn-block"
              disabled={!deployment || !quote || blocked || amount.isEmpty || amount.overMax}
              onClick={() => setTx({ stage: "AWAITING_WALLET" })}
            >
              {amount.isEmpty ? "Enter an amount" : `Withdraw ${amount.raw}`}
            </button>

            {tx.stage !== "IDLE" ? <TxTimeline tx={tx} explorerUrl={chain.explorerUrl} /> : null}
          </div>

          {deployment === null ? <NotDeployedNotice chainName={chain.name} /> : null}
        </div>
      </ActionShell>
    </>
  );
}

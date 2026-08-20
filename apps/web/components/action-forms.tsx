"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { formatUsd, type AccountStatus, type Gate } from "@usance/domain";
import { AmountField, GateBanners, NotDeployedNotice, PreviewRow, TxTimeline, useAmount } from "@/components/action";
import { Notice, RiskBadge } from "@/components/primitives";
import { activeChain, loadDeployment, type Deployment } from "@/lib/deployments";
import type { TxState } from "@/lib/tx";

/**
 * The four account actions as self-contained forms, decoupled from any route.
 *
 * Each of these was the body of its own page. Pulling them out lets the same form appear in two
 * places without drifting: on its deep-linkable route (wrapped in `ActionShell`), and inline in the
 * overview's action panel, where acting on a position no longer costs you the view of it.
 *
 * A form owns its own quote, amount and transaction state. It renders the form card and the
 * surrounding notices, but not the page chrome — title, intro, back link — which belongs to
 * whatever hosts it.
 */

// ================================================================= add collateral

interface AddQuote {
  marketValueUsd: bigint;
  recognisedUsd: bigint;
  borrowLimitUsd: bigint;
  status: AccountStatus;
  epoch: bigint;
  walletBalance: bigint;
  allowance: bigint;
  decimals: number;
  symbol: string;
}

export function AddCollateralForm() {
  const chain = activeChain();
  const [deployment, setDeployment] = useState<Deployment | null | undefined>(undefined);
  const [quote, setQuote] = useState<AddQuote | null>(null);
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

  const amount = useAmount(quote?.walletBalance);

  const preview = useMemo(() => {
    if (!quote || amount.isEmpty || quote.marketValueUsd === 0n) return null;
    const recognisedDelta = (amount.parsed * quote.recognisedUsd) / quote.marketValueUsd;
    const haircut = amount.parsed - recognisedDelta;
    const haircutBps = amount.parsed === 0n ? 0n : (haircut * 10_000n) / amount.parsed;
    return {
      recognisedDelta,
      haircut,
      haircutBps,
      recognisedAfter: quote.recognisedUsd + recognisedDelta,
      borrowableAfter: quote.borrowLimitUsd + (recognisedDelta * 8_500n) / 10_000n,
    };
  }, [quote, amount.parsed, amount.isEmpty]);

  const needsApproval = quote !== null && !amount.isEmpty && quote.allowance < amount.parsed;

  return (
    <div className="stack" style={{ gap: 22 }}>
      <div className="card stack" style={{ gap: 20 }}>
        <Notice title="Recognised value is lower than market value, and the difference is not a fee">
          Nobody takes it. It stays in your deposit and you can withdraw it. Usance will not lend
          against the part of the value it could not realise quickly under stress, so the smaller
          number is the one every limit is built on.{" "}
          <Link href="/simulate" style={{ textDecoration: "underline" }}>See how it is calculated</Link>.
        </Notice>

        <AmountField
          label="Amount to deposit"
          value={amount.raw}
          onChange={amount.setRaw}
          suffix={quote?.symbol ?? deployment?.assets[0]?.symbol ?? "—"}
          max={quote?.walletBalance}
          maxLabel="In your wallet"
          disabled={!deployment || !quote}
          hint={quote ? `Quoted under risk epoch ${quote.epoch}.` : undefined}
        />

        {preview ? (
          <>
            <div>
              <div className="micro" style={{ marginBottom: 4 }}>What Usance will recognise</div>
              <PreviewRow label="Market value of your deposit" after={`$${formatUsd(amount.parsed)}`} />
              <PreviewRow
                label="Held back for risk"
                after={`−$${formatUsd(preview.haircut)} (${(Number(preview.haircutBps) / 100).toFixed(2)}%)`}
              />
              <PreviewRow label="Recognised collateral" after={`$${formatUsd(preview.recognisedDelta)}`} emphasis />
            </div>
            <div>
              <div className="micro" style={{ marginBottom: 4 }}>Your account after</div>
              <PreviewRow
                label="Recognised collateral"
                before={`$${formatUsd(quote!.recognisedUsd)}`}
                after={`$${formatUsd(preview.recognisedAfter)}`}
                emphasis
              />
              <PreviewRow
                label="You could borrow up to"
                before={`$${formatUsd(quote!.borrowLimitUsd)}`}
                after={`$${formatUsd(preview.borrowableAfter)}`}
              />
            </div>
          </>
        ) : null}

        {needsApproval ? (
          <Notice title="Two signatures">
            Depositing takes an approval and then the deposit itself. Usance asks for an allowance of
            exactly this amount rather than an unlimited one, so nothing can be moved later without
            you signing again.
          </Notice>
        ) : null}

        <button
          className="btn btn-primary btn-lg btn-block"
          disabled={!deployment || !quote || amount.isEmpty || amount.overMax}
          onClick={() => setTx({ stage: "AWAITING_WALLET" })}
        >
          {amount.isEmpty ? "Enter an amount" : needsApproval ? `Approve and deposit ${amount.raw}` : `Deposit ${amount.raw}`}
        </button>

        {tx.stage !== "IDLE" ? <TxTimeline tx={tx} explorerUrl={chain.explorerUrl} /> : null}
      </div>

      {deployment === null ? <NotDeployedNotice chainName={chain.name} /> : null}

      <p className="caption" style={{ margin: 0 }}>
        Deposited collateral can be withdrawn at any time, as long as what remains still covers what
        you owe.{" "}
        <Link href="/app/withdraw" style={{ textDecoration: "underline" }}>Withdraw collateral</Link>.
      </p>
    </div>
  );
}

// ================================================================= borrow

interface BorrowQuote {
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

export function BorrowForm() {
  const chain = activeChain();
  const [deployment, setDeployment] = useState<Deployment | null | undefined>(undefined);
  const [quote, setQuote] = useState<BorrowQuote | null>(null);
  const [tx, setTx] = useState<TxState>({ stage: "IDLE" });

  useEffect(() => {
    let live = true;
    loadDeployment(chain.id).then((d) => {
      if (!live) return;
      setDeployment(d);
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
    const annualCost = (amount.parsed * BigInt(quote.rateBps)) / 10_000n;
    const buffer = quote.maintenanceLimit > debtAfter ? quote.maintenanceLimit - debtAfter : 0n;
    return { debtAfter, availableAfter, annualCost, buffer };
  }, [quote, amount.parsed, amount.isEmpty]);

  const blocked = quote?.status !== "NORMAL";

  return (
    <div className="stack" style={{ gap: 22 }}>
      {quote ? <GateBanners gates={quote.gates} /> : null}

      {quote && blocked ? (
        <Notice tone="stop" title="New borrowing is paused on this account">
          Your account is currently <RiskBadge status={quote.status} />. You can still repay, add
          collateral, or reduce exposure.
        </Notice>
      ) : null}

      <div className="card stack" style={{ gap: 20 }}>
        <div className="grid-2" style={{ gap: 14 }}>
          <div className="panel">
            <div className="stat-label">Your collateral supports</div>
            <div className="tnum" style={{ fontSize: 24, marginTop: 6 }}>{quote ? `$${formatUsd(quote.byRisk)}` : "—"}</div>
            <p className="caption" style={{ marginTop: 6 }}>Raised by depositing more collateral.</p>
          </div>
          <div className="panel">
            <div className="stat-label">Lenders can fund</div>
            <div className="tnum" style={{ fontSize: 24, marginTop: 6 }}>{quote ? `$${formatUsd(quote.byLiquidity)}` : "—"}</div>
            <p className="caption" style={{ marginTop: 6 }}>Adding collateral will not raise this. It moves when lenders supply more.</p>
          </div>
        </div>

        {quote?.limitedByLiquidity ? (
          <Notice tone="warn" title="Limited by available lender cash, not by your collateral">
            Your collateral would support more. Borrow a smaller amount now, or wait for lenders to
            supply more liquidity. Adding collateral will not raise this number.
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
            {quote?.limitedByLiquidity ? "This is a liquidity limit — waiting will raise it." : "Add collateral to raise it."}
          </Notice>
        ) : null}

        {preview ? (
          <div>
            <div className="micro" style={{ marginBottom: 4 }}>What changes</div>
            <PreviewRow label="Debt" before={`$${formatUsd(quote!.debtNow)}`} after={`$${formatUsd(preview.debtAfter)}`} emphasis />
            <PreviewRow label="Financing cost" after={`~$${formatUsd(preview.annualCost)} / year`} />
            <PreviewRow label="Still available after" before={`$${formatUsd(max!)}`} after={`$${formatUsd(preview.availableAfter)}`} />
            <PreviewRow label="Buffer before maintenance" after={`$${formatUsd(preview.buffer)}`} />
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
        Borrowing is secured against your collateral. If its recognised value falls, your account
        can enter a restricted state.{" "}
        <Link href="/simulate" style={{ textDecoration: "underline" }}>See how recognised value is calculated</Link>.
      </p>
    </div>
  );
}

// ================================================================= repay

interface RepayQuote {
  debtUsd: bigint;
  principalUsd: bigint;
  interestUsd: bigint;
  walletBalance: bigint;
  recognisedUsd: bigint;
  maintenanceLimitUsd: bigint;
  status: AccountStatus;
  symbol: string;
}

export function RepayForm() {
  const chain = activeChain();
  const [deployment, setDeployment] = useState<Deployment | null | undefined>(undefined);
  const [quote, setQuote] = useState<RepayQuote | null>(null);
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
    <div className="stack" style={{ gap: 22 }}>
      {quote && quote.status !== "NORMAL" ? (
        <Notice title="Repaying is always available">
          Your account is <RiskBadge status={quote.status} />, which pauses new borrowing. Repaying
          reduces risk, so it is never blocked — this is the action that returns the account to normal.
        </Notice>
      ) : null}

      <div className="card stack" style={{ gap: 20 }}>
        {quote ? (
          <div className="grid-2" style={{ gap: 14 }}>
            <div className="panel">
              <div className="stat-label">You owe</div>
              <div className="tnum" style={{ fontSize: 24, marginTop: 6 }}>${formatUsd(quote.debtUsd)}</div>
              <div className="caption" style={{ marginTop: 6 }}>
                ${formatUsd(quote.principalUsd)} borrowed + ${formatUsd(quote.interestUsd)} interest
              </div>
            </div>
            <div className="panel">
              <div className="stat-label">In your wallet</div>
              <div className="tnum" style={{ fontSize: 24, marginTop: 6 }}>${formatUsd(quote.walletBalance)}</div>
              <div className="caption" style={{ marginTop: 6 }}>{quote.symbol}</div>
            </div>
          </div>
        ) : null}

        <Notice title="Closing a loan costs more than you borrowed">
          Your debt is the amount you drew plus the interest it has accrued, and only the amount you
          drew was ever paid out to you. Repaying in full therefore needs more settlement token than
          borrowing produced.
        </Notice>

        <label className="row" style={{ gap: 10, cursor: "pointer" }}>
          <input type="checkbox" checked={payoff} disabled={!quote} onChange={(e) => setPayoff(e.target.checked)} />
          <span className="caption">
            Repay everything and close the loan{quote ? ` — $${formatUsd(quote.debtUsd)}` : ""}
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

        {payoff ? (
          <Notice title="Quoted now, settled on chain">
            Interest accrues every block, so this figure moves between now and your signature. Usance
            sends the instruction &ldquo;repay everything&rdquo; rather than a fixed amount, so the
            loan closes exactly rather than leaving a few cents outstanding.
          </Notice>
        ) : null}

        {preview && preview.shortfall > 0n ? (
          <Notice tone="warn" title={`You need $${formatUsd(preview.shortfall)} more ${quote!.symbol}`}>
            Your debt is principal plus the interest it has accrued, and only the principal was ever
            paid out to you. Repaying in full therefore costs more than you received. Add{" "}
            ${formatUsd(preview.shortfall)} to your wallet, or repay a smaller amount now.
          </Notice>
        ) : null}

        {preview ? (
          <div>
            <div className="micro" style={{ marginBottom: 4 }}>What changes</div>
            <PreviewRow label="Debt" before={`$${formatUsd(quote!.debtUsd)}`} after={`$${formatUsd(preview.debtAfter)}`} emphasis />
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
          {applied === 0n ? "Enter an amount" : payoff ? "Repay everything" : `Repay $${formatUsd(applied)}`}
        </button>

        {tx.stage !== "IDLE" ? <TxTimeline tx={tx} explorerUrl={chain.explorerUrl} /> : null}
      </div>

      {deployment === null ? <NotDeployedNotice chainName={chain.name} /> : null}

      <p className="caption" style={{ margin: 0 }}>
        Once your debt is clear you can{" "}
        <Link href="/app/withdraw" style={{ textDecoration: "underline" }}>withdraw your collateral</Link> in full.
      </p>
    </div>
  );
}

// ================================================================= withdraw

interface WithdrawQuote {
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

export function WithdrawForm() {
  const chain = activeChain();
  const [deployment, setDeployment] = useState<Deployment | null | undefined>(undefined);
  const [quote, setQuote] = useState<WithdrawQuote | null>(null);
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
  const blocked = quote !== null && !debtFree && quote.status !== "NORMAL";

  return (
    <div className="stack" style={{ gap: 22 }}>
      {quote ? <GateBanners gates={quote.gates} /> : null}

      {debtFree ? (
        <Notice title="You owe nothing">
          With no debt outstanding your collateral is yours to withdraw in full, whatever state the
          rest of the protocol is in.
        </Notice>
      ) : null}

      {blocked ? (
        <Notice tone="stop" title="Withdrawing is paused while your account is restricted">
          Your account is <RiskBadge status={quote!.status} />. Taking collateral out would increase
          risk, so it is blocked until you{" "}
          <Link href="/app/repay" style={{ textDecoration: "underline" }}>repay</Link> or add more collateral.
        </Notice>
      ) : null}

      <div className="card stack" style={{ gap: 20 }}>
        <div className="grid-2" style={{ gap: 14 }}>
          <div className="panel">
            <div className="stat-label">You have deposited</div>
            <div className="tnum" style={{ fontSize: 24, marginTop: 6 }}>{quote ? `$${formatUsd(quote.depositedUsd)}` : "—"}</div>
          </div>
          <div className="panel">
            <div className="stat-label">Free to withdraw</div>
            <div className="tnum" style={{ fontSize: 24, marginTop: 6 }}>{quote ? `$${formatUsd(quote.withdrawableUsd)}` : "—"}</div>
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
            <Link href="/app/repay" style={{ textDecoration: "underline" }}>Repay to free more</Link>.
          </Notice>
        ) : null}

        {preview ? (
          <div>
            <div className="micro" style={{ marginBottom: 4 }}>What changes</div>
            <PreviewRow
              label="Recognised collateral"
              before={`$${formatUsd(quote!.recognisedUsd)}`}
              after={`$${formatUsd(preview.recognisedAfter)}`}
              emphasis
            />
            <PreviewRow label="Debt" after={`$${formatUsd(quote!.debtUsd)} — unchanged`} />
            {quote!.debtUsd > 0n ? <PreviewRow label="Buffer before maintenance" after={`$${formatUsd(preview.bufferAfter)}`} /> : null}
            {preview.closesPosition ? <PreviewRow label="Position" after="Closed" /> : null}
          </div>
        ) : null}

        {preview && quote!.debtUsd > 0n && preview.bufferAfter === 0n ? (
          <Notice tone="warn" title="This leaves you with no margin">
            After this withdrawal any fall in your collateral&rsquo;s recognised value puts the
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
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { Address } from "viem";
import { formatUsd } from "@usance/domain";
import { AmountField, NotDeployedNotice, PreviewRow, TxTimeline, useAmount } from "@/components/action";
import { Notice, RiskBadge } from "@/components/primitives";
import { activeChain } from "@/lib/deployments";
import { sendTransaction, type TxState } from "@/lib/tx";
import {
  CH_ACTION_ABI, ERC20_ABI, connectedAccount, usd18ToToken, tokenToUsd18,
  addCollateralQuote, borrowQuote, repayQuote, withdrawQuote,
  type AddQuote, type BorrowQuote, type RepayQuote, type WithdrawQuote,
} from "@/lib/actions";

/**
 * The four account actions, wired for real.
 *
 * Each form reads its own live quote from the deployed contracts, then submits through the shared
 * `sendTransaction` funnel — which carries the builder-code suffix, decodes a protocol revert into
 * the exact reason, and treats a lost RPC as CONFIRMATION_UNKNOWN rather than asking for a second
 * signature. Deposits and repayments approve exactly the amount they need, to the exact contract
 * that pulls the tokens, and nothing more.
 *
 * The same components render on the deep-linkable routes (via ActionShell) and inline in the
 * overview's action panel, so there is one implementation of each action, not two that drift.
 */

// ---------------------------------------------------------------- shared states

function Skeleton() {
  return <div className="skeleton" style={{ height: 240 }} />;
}

function ConnectPrompt() {
  return (
    <Notice
      tone="warn"
      title="Sign in to act on your account"
      action={<Link className="btn btn-primary" href="/app/onboarding">Connect &amp; sign in</Link>}
    >
      Reading and moving your position needs a signed session. Connect your wallet and sign in, then
      this action becomes available.
    </Notice>
  );
}

const done = (s: TxState) => s.stage === "COMPLETE";

// ================================================================= add collateral

export function AddCollateralForm() {
  const chain = activeChain();
  const [account, setAccount] = useState<Address | null | undefined>(undefined);
  const [q, setQ] = useState<AddQuote | null | undefined>(undefined);
  const [tx, setTx] = useState<TxState>({ stage: "IDLE" });
  const amount = useAmount(q?.walletBalance);

  const refresh = useCallback(async () => {
    const acc = await connectedAccount();
    setAccount(acc);
    if (acc) setQ(await addCollateralQuote(acc));
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const needsApproval = q !== null && q !== undefined && !amount.isEmpty && q.allowance < amount.parsed;

  async function submit() {
    if (!account || !q) return;
    if (q.allowance < amount.parsed) {
      const a = await sendTransaction({
        to: q.token, abi: ERC20_ABI, functionName: "approve",
        args: [q.collateralVault, amount.parsed], from: account, onStage: setTx,
      });
      if (!done(a)) return;
    }
    const r = await sendTransaction({
      to: q.clearingHouse, abi: CH_ACTION_ABI, functionName: "addCollateral",
      args: [q.assetId, amount.parsed], from: account, onStage: setTx,
    });
    if (done(r)) { amount.setRaw(""); void refresh(); }
  }

  if (account === null) return <ConnectPrompt />;
  if (account === undefined || q === undefined) return <Skeleton />;
  if (q === null) return <NotDeployedNotice chainName={chain.name} />;

  return (
    <div className="stack" style={{ gap: 22 }}>
      <div className="card stack" style={{ gap: 20 }}>
        <Notice title="Recognised value is lower than market value, and the difference is not a fee">
          Nobody takes it. It stays in your deposit and you can withdraw it. Usance will not lend
          against the part it could not realise under stress, so the smaller number is the one every
          limit is built on. Your recognised collateral updates on your overview once the deposit
          confirms.
        </Notice>

        <AmountField
          label="Amount to deposit"
          value={amount.raw}
          onChange={amount.setRaw}
          suffix={q.symbol}
          max={q.walletBalance}
          maxLabel="In your wallet"
          hint={`${formatUsd(q.walletBalance)} ${q.symbol} available.`}
        />

        {needsApproval ? (
          <Notice title="Two signatures">
            Depositing takes an approval and then the deposit. Usance asks for an allowance of
            exactly this amount, to the collateral vault, so nothing can be moved later without you
            signing again.
          </Notice>
        ) : null}

        <button
          className="btn btn-primary btn-lg btn-block"
          disabled={amount.isEmpty || amount.overMax || tx.stage === "AWAITING_WALLET" || tx.stage === "SUBMITTED"}
          onClick={submit}
        >
          {amount.isEmpty ? "Enter an amount" : needsApproval ? `Approve and deposit ${amount.raw} ${q.symbol}` : `Deposit ${amount.raw} ${q.symbol}`}
        </button>

        {tx.stage !== "IDLE" ? <TxTimeline tx={tx} explorerUrl={chain.explorerUrl} /> : null}
      </div>

      <p className="caption" style={{ margin: 0 }}>
        Deposited collateral can be withdrawn at any time, as long as what remains still covers what
        you owe. <Link href="/app/withdraw" style={{ textDecoration: "underline" }}>Withdraw collateral</Link>.
      </p>
    </div>
  );
}

// ================================================================= borrow

export function BorrowForm() {
  const chain = activeChain();
  const [account, setAccount] = useState<Address | null | undefined>(undefined);
  const [q, setQ] = useState<BorrowQuote | null | undefined>(undefined);
  const [tx, setTx] = useState<TxState>({ stage: "IDLE" });

  const refresh = useCallback(async () => {
    const acc = await connectedAccount();
    setAccount(acc);
    if (acc) setQ(await borrowQuote(acc));
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const max = q ? (q.limitedByLiquidity ? q.byLiquidity : q.byRisk) : undefined;
  const amount = useAmount(max);
  const blocked = q ? q.status !== "NORMAL" : false;

  async function submit() {
    if (!account || !q) return;
    const r = await sendTransaction({
      to: q.clearingHouse, abi: CH_ACTION_ABI, functionName: "borrow",
      args: [amount.parsed, BigInt(q.epoch)], from: account, onStage: setTx,
    });
    if (done(r)) { amount.setRaw(""); void refresh(); }
  }

  if (account === null) return <ConnectPrompt />;
  if (account === undefined || q === undefined) return <Skeleton />;
  if (q === null) return <NotDeployedNotice chainName={chain.name} />;

  const debtAfter = q.debtNow + amount.parsed;
  const availableAfter = q.borrowLimit > debtAfter ? q.borrowLimit - debtAfter : 0n;
  const buffer = q.maintenanceLimit > debtAfter ? q.maintenanceLimit - debtAfter : 0n;
  const annualCost = q.rateBps !== null ? (amount.parsed * BigInt(q.rateBps)) / 10_000n : null;

  return (
    <div className="stack" style={{ gap: 22 }}>
      {blocked ? (
        <Notice tone="stop" title="New borrowing is paused on this account">
          Your account is currently <RiskBadge status={q.status} />. You can still repay, add
          collateral, or reduce exposure.
        </Notice>
      ) : null}

      <div className="card stack" style={{ gap: 20 }}>
        <div className="grid-2" style={{ gap: 14 }}>
          <div className="panel">
            <div className="stat-label">Your collateral supports</div>
            <div className="tnum" style={{ fontSize: 24, marginTop: 6 }}>${formatUsd(q.byRisk)}</div>
            <p className="caption" style={{ marginTop: 6 }}>Raised by depositing more collateral.</p>
          </div>
          <div className="panel">
            <div className="stat-label">Lenders can fund</div>
            <div className="tnum" style={{ fontSize: 24, marginTop: 6 }}>${formatUsd(q.byLiquidity)}</div>
            <p className="caption" style={{ marginTop: 6 }}>Moves when lenders supply more, not with your collateral.</p>
          </div>
        </div>

        {q.limitedByLiquidity ? (
          <Notice tone="warn" title="Limited by available lender cash, not by your collateral">
            Your collateral would support more. Borrow a smaller amount now, or wait for lenders to
            supply more liquidity.
          </Notice>
        ) : null}

        <AmountField
          label="Amount to borrow"
          value={amount.raw}
          onChange={amount.setRaw}
          suffix={q.settlementSymbol}
          max={max}
          maxLabel="Available"
          disabled={blocked}
          hint={q.rateBps !== null ? `Rate ${(q.rateBps / 100).toFixed(2)}% per year, variable. Quoted under risk epoch ${q.epoch}.` : `Quoted under risk epoch ${q.epoch}.`}
        />

        {amount.overMax && max !== undefined ? (
          <Notice tone="warn" title="That is more than you can borrow right now">
            Your current maximum is ${formatUsd(max)}.{" "}
            {q.limitedByLiquidity ? "This is a liquidity limit — waiting will raise it." : "Add collateral to raise it."}
          </Notice>
        ) : null}

        {!amount.isEmpty ? (
          <div>
            <div className="micro" style={{ marginBottom: 4 }}>What changes</div>
            <PreviewRow label="Debt" before={`$${formatUsd(q.debtNow)}`} after={`$${formatUsd(debtAfter)}`} emphasis />
            {annualCost !== null ? <PreviewRow label="Financing cost" after={`~$${formatUsd(annualCost)} / year`} /> : null}
            <PreviewRow label="Buffer before maintenance" after={`$${formatUsd(buffer)}`} />
            <PreviewRow label="Still available after" after={`$${formatUsd(availableAfter)}`} />
          </div>
        ) : null}

        <button
          className="btn btn-primary btn-lg btn-block"
          disabled={blocked || amount.isEmpty || amount.overMax || tx.stage === "AWAITING_WALLET" || tx.stage === "SUBMITTED"}
          onClick={submit}
        >
          {amount.isEmpty ? "Enter an amount" : `Borrow $${formatUsd(amount.parsed)}`}
        </button>

        {tx.stage !== "IDLE" ? <TxTimeline tx={tx} explorerUrl={chain.explorerUrl} /> : null}
      </div>

      <p className="caption" style={{ margin: 0 }}>
        Borrowing is secured against your collateral. If its recognised value falls, your account
        can enter a restricted state. <Link href="/simulate" style={{ textDecoration: "underline" }}>How recognised value is calculated</Link>.
      </p>
    </div>
  );
}

// ================================================================= repay

export function RepayForm() {
  const chain = activeChain();
  const [account, setAccount] = useState<Address | null | undefined>(undefined);
  const [q, setQ] = useState<RepayQuote | null | undefined>(undefined);
  const [payoff, setPayoff] = useState(false);
  const [tx, setTx] = useState<TxState>({ stage: "IDLE" });
  const amount = useAmount(q?.debt);

  const refresh = useCallback(async () => {
    const acc = await connectedAccount();
    setAccount(acc);
    if (acc) setQ(await repayQuote(acc));
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  async function submit() {
    if (!account || !q) return;
    const target = payoff ? q.debt : amount.parsed;
    const neededTokens = usd18ToToken(target, q.settlementDecimals);
    // Payoff clears against the live debt, which has accrued since the quote — approve a hair over
    // so the second transaction is never one unit short of what the contract pulls.
    const approveTokens = payoff ? neededTokens + neededTokens / 500n + 1n : neededTokens;
    if (q.allowance < approveTokens) {
      const a = await sendTransaction({
        to: q.settlementToken, abi: ERC20_ABI, functionName: "approve",
        args: [q.liquidityVault, approveTokens], from: account, onStage: setTx,
      });
      if (!done(a)) return;
    }
    const r = await sendTransaction({
      to: q.clearingHouse, abi: CH_ACTION_ABI, functionName: "repay",
      args: [payoff ? q.debt : amount.parsed, payoff], from: account, onStage: setTx,
    });
    if (done(r)) { amount.setRaw(""); setPayoff(false); void refresh(); }
  }

  if (account === null) return <ConnectPrompt />;
  if (account === undefined || q === undefined) return <Skeleton />;
  if (q === null) return <NotDeployedNotice chainName={chain.name} />;

  const applied = payoff ? q.debt : amount.parsed;
  const neededTokens = usd18ToToken(applied, q.settlementDecimals);
  const shortfallTokens = neededTokens > q.walletBalance ? neededTokens - q.walletBalance : 0n;
  const debtAfter = q.debt > applied ? q.debt - applied : 0n;
  const walletUsd = tokenToUsd18(q.walletBalance, q.settlementDecimals);

  return (
    <div className="stack" style={{ gap: 22 }}>
      {q.status !== "NORMAL" ? (
        <Notice title="Repaying is always available">
          Your account is <RiskBadge status={q.status} />, which pauses new borrowing. Repaying
          reduces risk, so it is never blocked — this is the action that returns the account to normal.
        </Notice>
      ) : null}

      <div className="card stack" style={{ gap: 20 }}>
        <div className="grid-2" style={{ gap: 14 }}>
          <div className="panel">
            <div className="stat-label">You owe</div>
            <div className="tnum" style={{ fontSize: 24, marginTop: 6 }}>${formatUsd(q.debt)}</div>
            <div className="caption" style={{ marginTop: 6 }}>Principal plus accrued interest.</div>
          </div>
          <div className="panel">
            <div className="stat-label">In your wallet</div>
            <div className="tnum" style={{ fontSize: 24, marginTop: 6 }}>${formatUsd(walletUsd)}</div>
            <div className="caption" style={{ marginTop: 6 }}>{q.settlementSymbol}</div>
          </div>
        </div>

        <label className="row" style={{ gap: 10, cursor: "pointer" }}>
          <input type="checkbox" checked={payoff} onChange={(e) => setPayoff(e.target.checked)} />
          <span className="caption">Repay everything and close the loan — ${formatUsd(q.debt)}</span>
        </label>

        {!payoff ? (
          <AmountField
            label="Amount to repay"
            value={amount.raw}
            onChange={amount.setRaw}
            suffix={q.settlementSymbol}
            max={q.debt}
            maxLabel="Total owed"
          />
        ) : (
          <Notice title="Quoted now, settled on chain">
            Interest accrues every block. Usance sends &ldquo;repay everything&rdquo; rather than a
            fixed amount, so the loan closes exactly, and approves a hair over the current figure to
            cover the seconds in between.
          </Notice>
        )}

        {shortfallTokens > 0n ? (
          <Notice tone="warn" title={`You need $${formatUsd(tokenToUsd18(shortfallTokens, q.settlementDecimals))} more ${q.settlementSymbol}`}>
            Closing a loan needs principal plus the interest it accrued, and only the principal was
            paid out to you. Add {q.settlementSymbol} to your wallet, or repay a smaller amount.
          </Notice>
        ) : null}

        {applied > 0n ? (
          <div>
            <div className="micro" style={{ marginBottom: 4 }}>What changes</div>
            <PreviewRow label="Debt" before={`$${formatUsd(q.debt)}`} after={`$${formatUsd(debtAfter)}`} emphasis />
            <PreviewRow label={debtAfter === 0n ? "Loan" : "Remaining"} after={debtAfter === 0n ? "Closed" : `$${formatUsd(debtAfter)}`} />
          </div>
        ) : null}

        <button
          className="btn btn-primary btn-lg btn-block"
          disabled={applied === 0n || shortfallTokens > 0n || tx.stage === "AWAITING_WALLET" || tx.stage === "SUBMITTED"}
          onClick={submit}
        >
          {applied === 0n ? "Enter an amount" : payoff ? "Repay everything" : `Repay $${formatUsd(applied)}`}
        </button>

        {tx.stage !== "IDLE" ? <TxTimeline tx={tx} explorerUrl={chain.explorerUrl} /> : null}
      </div>
    </div>
  );
}

// ================================================================= withdraw

export function WithdrawForm() {
  const chain = activeChain();
  const [account, setAccount] = useState<Address | null | undefined>(undefined);
  const [q, setQ] = useState<WithdrawQuote | null | undefined>(undefined);
  const [tx, setTx] = useState<TxState>({ stage: "IDLE" });
  const amount = useAmount(q?.withdrawable);

  const refresh = useCallback(async () => {
    const acc = await connectedAccount();
    setAccount(acc);
    if (acc) setQ(await withdrawQuote(acc));
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const blocked = q ? !q.debtFree && q.status !== "NORMAL" : false;

  async function submit() {
    if (!account || !q) return;
    const r = await sendTransaction({
      to: q.clearingHouse, abi: CH_ACTION_ABI, functionName: "withdrawCollateral",
      args: [q.assetId, amount.parsed], from: account, onStage: setTx,
    });
    if (done(r)) { amount.setRaw(""); void refresh(); }
  }

  if (account === null) return <ConnectPrompt />;
  if (account === undefined || q === undefined) return <Skeleton />;
  if (q === null) return <NotDeployedNotice chainName={chain.name} />;

  return (
    <div className="stack" style={{ gap: 22 }}>
      {q.debtFree ? (
        <Notice title="You owe nothing">
          With no debt outstanding your collateral is yours to withdraw in full, whatever state the
          rest of the protocol is in.
        </Notice>
      ) : null}
      {blocked ? (
        <Notice tone="stop" title="Withdrawing is paused while your account is restricted">
          Your account is <RiskBadge status={q.status} />. Taking collateral out would increase risk,
          so it is blocked until you <Link href="/app/repay" style={{ textDecoration: "underline" }}>repay</Link> or add more collateral.
        </Notice>
      ) : null}

      <div className="card stack" style={{ gap: 20 }}>
        <div className="grid-2" style={{ gap: 14 }}>
          <div className="panel">
            <div className="stat-label">You have deposited</div>
            <div className="tnum" style={{ fontSize: 24, marginTop: 6 }}>{formatUsd(q.deposited)} {q.symbol}</div>
          </div>
          <div className="panel">
            <div className="stat-label">Free to withdraw</div>
            <div className="tnum" style={{ fontSize: 24, marginTop: 6 }}>{formatUsd(q.withdrawable)} {q.symbol}</div>
            <p className="caption" style={{ marginTop: 6 }}>
              {q.debtUsd > 0n ? `$${formatUsd(q.debtUsd)} of debt is holding the rest.` : "No debt is holding your collateral."}
            </p>
          </div>
        </div>

        <AmountField
          label="Amount to withdraw"
          value={amount.raw}
          onChange={amount.setRaw}
          suffix={q.symbol}
          max={q.withdrawable}
          maxLabel="Free"
          disabled={blocked}
          hint={`Quoted under risk epoch ${q.epoch}.`}
        />

        {amount.overMax ? (
          <Notice tone="warn" title="That is more than you can take out right now">
            You can withdraw {formatUsd(q.withdrawable)} {q.symbol}. The rest is backing your debt.{" "}
            <Link href="/app/repay" style={{ textDecoration: "underline" }}>Repay to free more</Link>.
          </Notice>
        ) : null}

        <button
          className="btn btn-primary btn-lg btn-block"
          disabled={blocked || amount.isEmpty || amount.overMax || tx.stage === "AWAITING_WALLET" || tx.stage === "SUBMITTED"}
          onClick={submit}
        >
          {amount.isEmpty ? "Enter an amount" : `Withdraw ${amount.raw} ${q.symbol}`}
        </button>

        {tx.stage !== "IDLE" ? <TxTimeline tx={tx} explorerUrl={chain.explorerUrl} /> : null}
      </div>
    </div>
  );
}

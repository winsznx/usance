"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { formatUsd, type AccountStatus } from "@usance/domain";
import { ActionShell, AmountField, NotDeployedNotice, PreviewRow, TxTimeline, useAmount } from "@/components/action";
import {Notice} from "@/components/primitives";
import { activeChain, loadDeployment, type Deployment } from "@/lib/deployments";
import type { TxState } from "@/lib/tx";

/**
 * `/app/collateral/add` — deposit an asset Usance recognises.
 *
 * The single job of this page is to make the haircut visible before anybody signs. Everywhere else
 * in DeFi, depositing $1,000 of something means you have $1,000 of collateral. Here it does not,
 * and the difference is the product: Usance recognises what it can defend, which is market value
 * minus five haircuts applied in a frozen order, floored by the worse of a stressed exit and, where
 * one exists, a redemption floor.
 *
 * Surfacing that only after the deposit lands would make the protocol look like it shortchanged
 * the user. Surfacing it before makes it the reason to trust the number.
 */

interface Quote {
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

export default function AddCollateralPage() {
  const chain = activeChain();
  const [deployment, setDeployment] = useState<Deployment | null | undefined>(undefined);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [tx, setTx] = useState<TxState>({ stage: "IDLE" });

  useEffect(() => {
    let live = true;
    loadDeployment(chain.id).then((d) => {
      if (!live) return;
      setDeployment(d);
      // A quote has to come from the chain. There is no plausible-looking placeholder that would
      // not be a lie about somebody's balance.
      setQuote(null);
    });
    return () => {
      live = false;
    };
  }, [chain.id]);

  const amount = useAmount(quote?.walletBalance);

  const preview = useMemo(() => {
    if (!quote || amount.isEmpty || quote.marketValueUsd === 0n) return null;

    // The recognition ratio is read from the account's existing position rather than recomputed
    // here. A second implementation of the valuation formula in the browser is a second thing that
    // can disagree with the contract, and the contract is the one that decides.
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
    <>

      <ActionShell
        title="Add collateral"
        intro="Deposit an admitted asset. It stays yours, and Usance tells you exactly how much of it it will stand behind."
      >
        <div className="stack" style={{ gap: 22 }}>
          <div className="card stack" style={{ gap: 20 }}>
            {/*
              Always visible. This is the single most surprising thing about depositing into Usance
              and the most likely to read as a hidden charge, so it is explained before anybody
              types an amount rather than after.
            */}
            <Notice title="Recognised value is lower than market value, and the difference is not a fee">
              Nobody takes it. It stays in your deposit and you can withdraw it. Usance will not lend
              against the part of the value it could not realise quickly under stress, so the smaller
              number is the one every limit is built on.{" "}
              <Link href="/simulate" style={{ textDecoration: "underline" }}>
                See how it is calculated
              </Link>
              .
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
                  <div className="micro" style={{ marginBottom: 4 }}>
                    What Usance will recognise
                  </div>
                  <PreviewRow label="Market value of your deposit" after={`$${formatUsd(amount.parsed)}`} />
                  <PreviewRow
                    label="Held back for risk"
                    after={`−$${formatUsd(preview.haircut)} (${(Number(preview.haircutBps) / 100).toFixed(2)}%)`}
                  />
                  <PreviewRow
                    label="Recognised collateral"
                    after={`$${formatUsd(preview.recognisedDelta)}`}
                    emphasis
                  />
                </div>

                {/*
                  The gap is not a fee and does not go anywhere. Saying so plainly here is cheaper
                  than a support conversation and more honest than hiding the market figure.
                */}

                <div>
                  <div className="micro" style={{ marginBottom: 4 }}>
                    Your account after
                  </div>
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
                Depositing takes an approval and then the deposit itself. Usance asks for an
                allowance of exactly this amount rather than an unlimited one, so nothing can be
                moved later without you signing again.
              </Notice>
            ) : null}

            <button
              className="btn btn-primary btn-lg btn-block"
              disabled={!deployment || !quote || amount.isEmpty || amount.overMax}
              onClick={() => setTx({ stage: "AWAITING_WALLET" })}
            >
              {amount.isEmpty
                ? "Enter an amount"
                : needsApproval
                  ? `Approve and deposit ${amount.raw}`
                  : `Deposit ${amount.raw}`}
            </button>

            {tx.stage !== "IDLE" ? <TxTimeline tx={tx} explorerUrl={chain.explorerUrl} /> : null}
          </div>

          {deployment === null ? <NotDeployedNotice chainName={chain.name} /> : null}

          <p className="caption" style={{ margin: 0 }}>
            Deposited collateral can be withdrawn at any time, as long as what remains still covers
            what you owe.{" "}
            <Link href="/app/withdraw" style={{ textDecoration: "underline" }}>
              Withdraw collateral
            </Link>
            .
          </p>
        </div>
      </ActionShell>
    </>
  );
}

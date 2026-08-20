"use client";

import Link from "next/link";
import { OnChain } from "@/components/onchain";
import { Advanced } from "@/components/mode";

/**
 * Every holding, and what each one contributes to capacity.
 *
 * A table rather than cards, because the question is comparative: which of these is carrying the
 * position and which is being discounted hardest. Cards make that comparison a memory exercise.
 *
 * The column that matters is the last one. Market value tells you what you own; the share that
 * survives to recognised value tells you whether owning it here is doing anything for you, and
 * that is the number nothing else on the dashboard states directly.
 */

export interface Holding {
  assetId: string;
  symbol?: string;
  marketValueUsd18: string;
  haircutMarkUsd18: string;
  stressedExitUsd18: string;
  recognizedUsd18: string;
}

const money = (v: string): string =>
  (Number(BigInt(v)) / 1e18).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function Holdings({ assets }: { assets: Holding[] }) {
  if (assets.length === 0) {
    return (
      <section className="card">
        <h2 className="heading" style={{ fontSize: 17, margin: "0 0 8px" }}>Your holdings</h2>
        <p className="caption" style={{ margin: "0 0 16px", color: "var(--graphite)" }}>
          Nothing deposited yet. Once you add an admitted asset this becomes the full breakdown:
          what it is marked at, what each haircut takes, and what survives as capacity.
        </p>
        <Link className="btn btn-ghost" href="/assets" target="_blank" rel="noreferrer">See what Usance admits</Link>
      </section>
    );
  }

  return (
    <section className="card" aria-labelledby="holdings-heading">
      <h2 id="holdings-heading" className="heading" style={{ fontSize: 17, margin: "0 0 4px" }}>
        Your holdings
      </h2>
      <p className="caption" style={{ margin: "0 0 16px", color: "var(--graphite)" }}>
        The share that survives is the number worth watching. It says whether an asset is pulling
        its weight as collateral, which its market value alone never does.
      </p>

      {/* Scrolls inside its own container rather than widening the page. */}
      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">Asset</th>
              <th scope="col" className="num">Market</th>
              <th scope="col" className="num">After haircuts</th>
              <th scope="col" className="num">Stressed exit</th>
              <th scope="col" className="num">Recognised</th>
              <th scope="col" className="num">Survives</th>
            </tr>
          </thead>
          <tbody>
            {assets.map((a) => {
              const market = BigInt(a.marketValueUsd18);
              const recognised = BigInt(a.recognizedUsd18);
              const kept = market === 0n ? 0 : Number((recognised * 1000n) / market) / 10;
              // Which of the two candidates actually bound this asset. Policy and size are
              // different problems with different remedies, so the row says which one it is.
              const bound = BigInt(a.stressedExitUsd18) < BigInt(a.haircutMarkUsd18) ? "size" : "policy";

              return (
                <tr key={a.assetId}>
                  <th scope="row">
                    <OnChain kind="address" value={a.assetId} label="asset id" copyable={false} />
                    <Advanced>
                      <span className="caption" style={{ display: "block", color: "var(--stone)", marginTop: 2 }}>
                        bound by {bound}
                      </span>
                    </Advanced>
                  </th>
                  <td className="num">${money(a.marketValueUsd18)}</td>
                  <td className="num">${money(a.haircutMarkUsd18)}</td>
                  <td className="num">${money(a.stressedExitUsd18)}</td>
                  <td className="num strong">${money(a.recognizedUsd18)}</td>
                  <td className="num">
                    <span className="survives">{kept.toFixed(1)}%</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

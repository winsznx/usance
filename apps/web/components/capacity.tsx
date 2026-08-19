"use client";

import { Icon } from "@/components/icon";

/**
 * Why your capacity is what it is.
 *
 * Every lending dashboard shows a balance and a limit. Usance can show the step between them, and
 * that step is the entire product: market value is reduced by haircuts, compared against what the
 * position would realise if it had to be sold under stress, and the lower of the two is what gets
 * lent against.
 *
 * Rendered as a descending sequence rather than a chart. There is no time series here and inventing
 * one would be a lie; what exists is a derivation, and a derivation reads as steps.
 *
 * The bars are proportional to real values and every figure is labelled, so the visual is a second
 * channel for something already stated in words rather than the only way to read the number.
 */

export interface HaircutStep {
  label: string;
  value: bigint;
  note: string;
}

const money = (v: bigint): string =>
  (Number(v) / 1e18).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function CapacityDerivation({
  marketValue,
  haircutMark,
  stressedExit,
  recognised,
}: {
  marketValue: bigint;
  haircutMark: bigint;
  stressedExit: bigint;
  recognised: bigint;
}) {
  const steps: HaircutStep[] = [
    { label: "Market value", value: marketValue, note: "What the price feed says your collateral is worth." },
    { label: "After haircuts", value: haircutMark, note: "Reduced for market, liquidity, issuer, settlement and cross-chain risk, in that order." },
    { label: "Stressed exit", value: stressedExit, note: "What the exit curve says this size would realise if it had to be sold under stress." },
    { label: "Recognised", value: recognised, note: "The lower of the two above. This is what Usance lends against." },
  ];

  const max = steps.reduce((m, s) => (s.value > m ? s.value : m), 1n);
  // Which of the two candidates actually bound the result. Saying so turns a number into an
  // explanation somebody can act on: one is fixed by policy, the other by position size.
  const boundBy = recognised === stressedExit && stressedExit < haircutMark ? "stressed exit" : "haircuts";

  return (
    <section className="card" aria-labelledby="derivation-heading">
      <div className="row-between" style={{ alignItems: "baseline", marginBottom: 4 }}>
        <h2 id="derivation-heading" className="heading" style={{ fontSize: 17, margin: 0 }}>
          How your capacity is derived
        </h2>
        <span className="caption" style={{ color: "var(--graphite)" }}>bound by {boundBy}</span>
      </div>
      <p className="caption" style={{ margin: "6px 0 18px", color: "var(--graphite)" }}>
        Usance lends against what it believes it could realise under stress, not against the screen
        price. Every step below is computed on chain.
      </p>

      <ol className="derivation">
        {steps.map((s, i) => {
          const pct = max === 0n ? 0 : Number((s.value * 1000n) / max) / 10;
          const last = i === steps.length - 1;
          return (
            <li key={s.label} className={`derivation-step${last ? " derivation-step-final" : ""}`}>
              <div className="row-between" style={{ gap: 12 }}>
                <span className="caption" style={{ fontWeight: last ? 500 : 400 }}>{s.label}</span>
                <span className="tnum" style={{ fontSize: last ? 17 : 14 }}>${money(s.value)}</span>
              </div>
              <div className="derivation-track" aria-hidden="true">
                <div className="derivation-fill" style={{ width: `${Math.max(pct, 0.6)}%` }} />
              </div>
              <p className="caption derivation-note">{s.note}</p>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/**
 * The status ladder, with the account's position on it.
 *
 * Shown as a sequence rather than a single badge because the useful information is not which rung
 * you are on but which one is next and what it costs. A badge saying NO_NEW_RISK tells somebody
 * they have a problem; this tells them what happens if it gets worse.
 */
const LADDER = [
  { status: "NORMAL", label: "Normal", loses: "Nothing restricted." },
  { status: "NO_NEW_RISK", label: "No new risk", loses: "New borrowing stops. Everything else stays open." },
  { status: "REDUCE_ONLY", label: "Reduce only", loses: "Withdrawal stops too. Repay and add collateral remain." },
  { status: "MARGIN_CALL", label: "Action required", loses: "A liquidator may sell part of your collateral." },
  { status: "LIQUIDATING", label: "Liquidating", loses: "Collateral is being sold to reduce the debt." },
] as const;

export function StatusLadder({ current }: { current: string }) {
  const at = LADDER.findIndex((r) => r.status === current);
  const index = at === -1 ? 0 : at;

  return (
    <section className="card" aria-labelledby="ladder-heading">
      <h2 id="ladder-heading" className="heading" style={{ fontSize: 17, margin: "0 0 4px" }}>
        Where your account stands
      </h2>
      <p className="caption" style={{ margin: "0 0 16px", color: "var(--graphite)" }}>
        Recomputed from live inputs on every read. There is no cached status that could disagree
        with the chain.
      </p>

      <ol className="ladder">
        {LADDER.map((rung, i) => {
          const state = i < index ? "past" : i === index ? "current" : "ahead";
          return (
            <li key={rung.status} className={`ladder-rung ladder-${state}`}>
              <span className="ladder-dot" aria-hidden="true">
                {state === "current" ? <Icon name="check" size={12} /> : null}
              </span>
              <div>
                <div className="row" style={{ gap: 8, alignItems: "baseline" }}>
                  <span style={{ fontWeight: state === "current" ? 500 : 400, fontSize: 14 }}>{rung.label}</span>
                  {state === "current" ? <span className="caption" style={{ color: "var(--graphite)" }}>you are here</span> : null}
                </div>
                <p className="caption ladder-note">{rung.loses}</p>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

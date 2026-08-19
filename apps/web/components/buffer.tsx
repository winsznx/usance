"use client";

import { Advanced } from "@/components/mode";

/**
 * How far the account is from the next restriction.
 *
 * The number people actually want is not "how healthy am I" on some invented scale — it is "how
 * much room have I got, and what happens when it runs out". So the meter is anchored to the two
 * real thresholds the protocol enforces, and the caption names the consequence.
 *
 * Deliberately not a time series. There is no history of this figure in the product, and drawing a
 * trend line through one datum would be inventing the past.
 */

const money = (v: bigint): string =>
  (Number(v) / 1e18).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function SafetyBuffer({
  debt,
  borrowLimit,
  maintenanceLimit,
}: {
  debt: bigint;
  borrowLimit: bigint;
  maintenanceLimit: bigint;
}) {
  const toBorrowLimit = borrowLimit > debt ? borrowLimit - debt : 0n;
  const toMaintenance = maintenanceLimit > debt ? maintenanceLimit - debt : 0n;
  const breached = debt > maintenanceLimit;

  // Position of the debt along the run to the maintenance limit. Clamped, because a breached
  // account would otherwise render a bar longer than its track.
  const used = maintenanceLimit === 0n ? 0 : Math.min(100, Number((debt * 1000n) / maintenanceLimit) / 10);
  const borrowMark = maintenanceLimit === 0n ? 0 : Math.min(100, Number((borrowLimit * 1000n) / maintenanceLimit) / 10);

  return (
    <section className="card" aria-labelledby="buffer-heading">
      <div className="row-between" style={{ alignItems: "baseline", marginBottom: 4 }}>
        <h2 id="buffer-heading" className="heading" style={{ fontSize: 17, margin: 0 }}>Safety buffer</h2>
        <span className="tnum" style={{ fontSize: 17 }}>
          {breached ? `-$${money(debt - maintenanceLimit)}` : `$${money(toMaintenance)}`}
        </span>
      </div>
      <p className="caption" style={{ margin: "0 0 16px", color: "var(--graphite)" }}>
        {breached
          ? "Your debt is past the maintenance limit. A liquidator may sell part of your collateral until it is back under."
          : toBorrowLimit === 0n
            ? "You are at your borrow limit. Repaying or adding collateral opens room again."
            : "How much your debt can grow, or your collateral fall, before withdrawal stops."}
      </p>

      <div className="buffer-track" role="img" aria-label={`Debt is ${used.toFixed(0)} percent of the maintenance limit`}>
        <div className={`buffer-fill${breached ? " buffer-fill-breached" : ""}`} style={{ width: `${Math.max(used, 0.8)}%` }} />
        {/* The borrow limit sits inside the run to maintenance. Showing it explains why borrowing
            can stop while withdrawal is still available. */}
        {borrowMark > 0 && borrowMark < 100 ? (
          <div className="buffer-mark" style={{ left: `${borrowMark}%` }} aria-hidden="true" />
        ) : null}
      </div>

      <div className="row-between" style={{ marginTop: 10 }}>
        <span className="caption" style={{ color: "var(--graphite)" }}>
          {toBorrowLimit > 0n ? `$${money(toBorrowLimit)} before borrowing stops` : "Borrowing stopped"}
        </span>
        <span className="caption" style={{ color: "var(--graphite)" }}>maintenance limit</span>
      </div>

      <Advanced>
        <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--hairline)" }}>
          <Row label="Debt" value={`$${money(debt)}`} />
          <Row label="Borrow limit" value={`$${money(borrowLimit)}`} />
          <Row label="Maintenance limit" value={`$${money(maintenanceLimit)}`} />
        </div>
      </Advanced>
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="row-between" style={{ padding: "6px 0" }}>
      <span className="caption">{label}</span>
      <span className="caption tnum">{value}</span>
    </div>
  );
}

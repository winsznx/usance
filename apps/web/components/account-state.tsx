"use client";

import Link from "next/link";
import { formatUsd, type AccountStatus } from "@usance/domain";
import { Notice, RiskBadge, Steps } from "./primitives";

/**
 * What each account status means, and what to do about it.
 *
 * The rule this file exists to enforce: never show a warning without the number that clears it.
 * "Your position is at risk" tells a user they have a problem and leaves them to guess the size of
 * it, which is how a margin call becomes a liquidation. Every restricted state here names the
 * amount, the actions that move it, and what happens if nothing is done.
 */

export interface AccountView {
  status: AccountStatus;
  recognisedUsd: bigint;
  debtUsd: bigint;
  borrowLimitUsd: bigint;
  maintenanceLimitUsd: bigint;
  liquidationLimitUsd: bigint;
  epoch: bigint;
}

/** The shortfall between what is owed and what the account must keep covered. */
export function shortfall(a: AccountView): bigint {
  return a.debtUsd > a.maintenanceLimitUsd ? a.debtUsd - a.maintenanceLimitUsd : 0n;
}

/**
 * How much must be repaid to clear a margin call.
 *
 * Repaying reduces debt without touching the limit, so a dollar repaid closes a dollar of the gap.
 * That is not true of liquidation, and it is the reason repaying is always the cheaper cure — a
 * distinction the UI states rather than leaving the user to discover after the fact.
 */
export function repairByRepaying(a: AccountView): bigint {
  return shortfall(a);
}

/**
 * How much collateral value must be added instead.
 *
 * Added collateral raises the maintenance limit by its recognised value times the maintenance LTV,
 * so it takes more than a dollar of collateral to close a dollar of gap. The ratio is read from the
 * account rather than assumed, because with several assets there is no single configured number.
 */
export function repairByAddingCollateral(a: AccountView): bigint {
  if (a.recognisedUsd === 0n) return 0n;
  const maintenanceBps = (a.maintenanceLimitUsd * 10_000n) / a.recognisedUsd;
  if (maintenanceBps === 0n) return 0n;
  return (shortfall(a) * 10_000n) / maintenanceBps;
}

const COPY: Record<AccountStatus, { title: string; body: string; tone: "neutral" | "warn" | "stop" }> = {
  NORMAL: {
    title: "Healthy",
    body: "Everything is available.",
    tone: "neutral",
  },
  NO_NEW_RISK: {
    title: "No new borrowing",
    body:
      "Your debt is above the level Usance will lend new money against. Nothing is at risk yet and " +
      "nothing will be taken. Repaying, adding collateral, or withdrawing within your limit all " +
      "still work.",
    tone: "warn",
  },
  REDUCE_ONLY: {
    title: "Reduce only",
    body:
      "Your debt has passed the maintenance level, so withdrawing is paused as well as borrowing. " +
      "Repaying and adding collateral are unaffected and both move you back.",
    tone: "warn",
  },
  MARGIN_CALL: {
    title: "Action required",
    body:
      "Your collateral no longer covers what you owe. If this is not repaired, Usance will sell part " +
      "of your collateral to reduce the position.",
    tone: "stop",
  },
  LIQUIDATING: {
    title: "Liquidating",
    body:
      "Usance is selling part of your collateral. You can still add collateral, and doing so may stop " +
      "further sales.",
    tone: "stop",
  },
  SETTLED: {
    title: "Settled",
    body: "The position is closed. Any remaining equity is yours to withdraw.",
    tone: "neutral",
  },
  BAD_DEBT: {
    title: "Bad debt",
    body: "The position closed for less than it owed. The shortfall is recorded against the protocol.",
    tone: "stop",
  },
};

export function AccountStatusPanel({ account }: { account: AccountView }) {
  const copy = COPY[account.status];
  const gap = shortfall(account);

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="row" style={{ gap: 12, alignItems: "center" }}>
        <RiskBadge status={account.status} />
        <span style={{ fontWeight: 500 }}>{copy.title}</span>
      </div>

      {account.status === "NORMAL" ? null : (
        <Notice tone={copy.tone === "neutral" ? undefined : copy.tone} title={copy.title}>
          {copy.body}
        </Notice>
      )}

      {gap > 0n ? <RepairPanel account={account} /> : null}
    </div>
  );
}

/**
 * The exact repair, both ways.
 *
 * Two numbers rather than one, because they are genuinely different and the cheaper one is not
 * obvious: repaying closes the gap dollar for dollar, adding collateral does not.
 */
export function RepairPanel({ account }: { account: AccountView }) {
  const gap = shortfall(account);
  const byRepaying = repairByRepaying(account);
  const byCollateral = repairByAddingCollateral(account);

  return (
    <div className="card stack" style={{ gap: 16 }}>
      <div>
        <div className="stat-label">Shortfall</div>
        <div className="tnum" style={{ fontSize: 28, marginTop: 6 }}>
          ${formatUsd(gap)}
        </div>
        <p className="caption" style={{ marginTop: 8 }}>
          You owe ${formatUsd(account.debtUsd)} against a maintenance requirement of $
          {formatUsd(account.maintenanceLimitUsd)}.
        </p>
      </div>

      <hr className="divider" />

      <div className="micro">Either of these clears it</div>

      <div className="grid-2" style={{ gap: 14 }}>
        <div className="panel">
          <div className="stat-label">Repay</div>
          <div className="tnum" style={{ fontSize: 22, marginTop: 6 }}>
            ${formatUsd(byRepaying)}
          </div>
          <p className="caption" style={{ marginTop: 8 }}>
            Repaying reduces what you owe without changing your limit, so every dollar closes a
            dollar of the gap.
          </p>
          <Link className="btn btn-primary btn-block" href="/app/repay" style={{ marginTop: 12 }}>
            Repay
          </Link>
        </div>

        <div className="panel">
          <div className="stat-label">Add collateral</div>
          <div className="tnum" style={{ fontSize: 22, marginTop: 6 }}>
            ${formatUsd(byCollateral)}
          </div>
          <p className="caption" style={{ marginTop: 8 }}>
            More than the shortfall, because Usance only lends against part of what you deposit. This
            is the recognised value needed, not the market value.
          </p>
          <Link className="btn btn-ghost btn-block" href="/app/collateral/add" style={{ marginTop: 12 }}>
            Add collateral
          </Link>
        </div>
      </div>

      {account.status === "MARGIN_CALL" ? (
        <Notice tone="stop" title="If this is not repaired">
          Usance will sell part of your collateral and use the proceeds to reduce your debt. It takes
          only what the shortfall requires and leaves the rest of the position with you. Because
          selling collateral also lowers your borrowing limit, one sale may not clear the shortfall
          on its own.
        </Notice>
      ) : null}
    </div>
  );
}

/**
 * The stages of a liquidation in progress.
 *
 * Shown as a timeline rather than a banner because a liquidation is a sequence a user is living
 * through, and "your account is being liquidated" with no indication of where it has got to is the
 * least useful true statement a product can make.
 */
export function LiquidationTimeline({
  stage,
  fills,
}: {
  stage: "STARTED" | "ROUTE_SELECTED" | "SEIZED" | "APPLIED" | "RECALCULATED" | "COMPLETE";
  fills?: Array<{ txHash: string; seized: string; recovered: string; blockNumber: number }>;
}) {
  const order = ["STARTED", "ROUTE_SELECTED", "SEIZED", "APPLIED", "RECALCULATED", "COMPLETE"] as const;
  const labels: Record<(typeof order)[number], string> = {
    STARTED: "Liquidation started",
    ROUTE_SELECTED: "Exit route selected",
    SEIZED: "Collateral sold",
    APPLIED: "Proceeds applied to your debt",
    RECALCULATED: "Account recalculated",
    COMPLETE: "Complete",
  };
  const at = order.indexOf(stage);

  return (
    <div className="stack" style={{ gap: 16 }}>
      <Steps
        steps={order.map((s, i) => ({
          label: labels[s],
          state: i < at ? "done" : i === at ? "active" : "pending",
        }))}
      />

      {/* Each fill separately. A liquidation can take several rounds, and collapsing them into one
          summary hides how much was taken and when. */}
      {fills && fills.length > 0 ? (
        <div className="card">
          <div className="micro" style={{ marginBottom: 8 }}>
            {fills.length} fill{fills.length === 1 ? "" : "s"}
          </div>
          {fills.map((f) => (
            <div key={f.txHash} className="row-between" style={{ padding: "9px 0", borderTop: "1px solid var(--hairline)" }}>
              <span className="caption">Block {f.blockNumber.toLocaleString()}</span>
              <span className="caption tnum">
                {f.seized} sold &rarr; {f.recovered} applied
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

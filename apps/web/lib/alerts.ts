import type { AccountStatus } from "@usance/domain";

/**
 * Alerts derived from account state, not stored as a feed.
 *
 * Derived on read for one reason: a stored alert can disagree with the chain. An account that
 * cured its margin call an hour ago should not still be told it is in one, and a feed that needs a
 * job to mark alerts resolved is a feed that shows stale panic whenever the job is behind.
 *
 * Every alert answers three questions. What changed, why it matters, and what you can do — with a
 * link to the surface that repairs it. "Something changed" is not an alert.
 */

export type AlertSeverity = "INFO" | "WARN" | "URGENT";

export interface Alert {
  id: string;
  severity: AlertSeverity;
  title: string;
  what: string;
  why: string;
  action: { label: string; href: string } | null;
}

export interface AlertInputs {
  status: AccountStatus;
  debt: bigint;
  maintenanceLimit: bigint;
  borrowLimit: bigint;
  reserved: bigint;
  riskEpoch: number;
  /** Epoch the last quote this browser produced was stamped with, if any. */
  lastSeenEpoch: number | null;
  gates: number;
  withdrawableNow: bigint;
  queuedForWithdrawal: bigint;
  mandates: Array<{ mandateId: string; status: string; expiresAt: number; agent: string }>;
  now: number;
}

const money = (v: bigint): string =>
  (Number(v) / 1e18).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function alertsFor(i: AlertInputs): Alert[] {
  const out: Alert[] = [];

  // ---- account status. The ladder, in the user's words rather than the enum's.
  if (i.status === "MARGIN_CALL" || i.status === "LIQUIDATING") {
    const shortfall = i.debt > i.maintenanceLimit ? i.debt - i.maintenanceLimit : 0n;
    out.push({
      id: "margin-call",
      severity: "URGENT",
      title: i.status === "LIQUIDATING" ? "Your position is being liquidated" : "Action required on your account",
      what: `Your debt is $${money(shortfall)} above the maintenance limit.`,
      why:
        "Below this limit the protocol will let a liquidator sell part of your collateral to reduce " +
        "the debt. You keep the rest, and you can stop it by repairing the shortfall yourself.",
      action: { label: `Repay $${money(shortfall)}`, href: "/app/repay" },
    });
  } else if (i.status === "REDUCE_ONLY") {
    out.push({
      id: "reduce-only",
      severity: "WARN",
      title: "Withdrawal is paused on your account",
      what: "Your debt is above the level where Usance will let collateral leave.",
      why: "Repaying or adding collateral restores it. Nothing is being sold and no deadline is running.",
      action: { label: "Add collateral", href: "/app/collateral/add" },
    });
  } else if (i.status === "NO_NEW_RISK") {
    out.push({
      id: "no-new-risk",
      severity: "WARN",
      title: "New borrowing is paused on your account",
      what: "Recognised collateral fell, or an input the protocol depends on became untrustworthy.",
      why:
        "You can still repay, add collateral and withdraw within the maintenance limit. This is a " +
        "restriction, not a liquidation.",
      action: { label: "See your position", href: "/app/positions" },
    });
  }

  // ---- gates. A non-zero gate means an input was refused, which is different from a price move.
  if (i.gates !== 0) {
    out.push({
      id: "input-gated",
      severity: "WARN",
      title: "An input the protocol depends on was refused",
      what: "A price feed, sequencer check or asset status gate is currently failing.",
      why:
        "Usance refuses to take on new risk against an input it cannot trust. Every risk-reducing " +
        "action stays open. This usually clears itself when the input recovers.",
      action: { label: "Integration status", href: "/status" },
    });
  }

  // ---- risk epoch. Only when this browser has actually seen an older one.
  if (i.lastSeenEpoch !== null && i.riskEpoch > i.lastSeenEpoch) {
    out.push({
      id: "epoch-changed",
      severity: "INFO",
      title: "Risk policy changed since you last looked",
      what: `The risk epoch moved from ${i.lastSeenEpoch} to ${i.riskEpoch}.`,
      why:
        "Any quote you were holding is now refused rather than executed under rules you were never " +
        "shown. Re-open the action to get current numbers.",
      action: { label: "Refresh your position", href: "/app/positions" },
    });
  }

  // ---- reservations
  if (i.reserved > 0n) {
    out.push({
      id: "capital-reserved",
      severity: "INFO",
      title: "Capital is reserved for an in-flight execution",
      what: `$${money(i.reserved)} is committed and cannot be borrowed against or withdrawn.`,
      why:
        "It is released when the execution reconciles. A reservation is never released on a timeout " +
        "alone, because a timeout does not prove the execution failed.",
      action: { label: "See your intents", href: "/app/intents" },
    });
  }

  // ---- LP withdrawal
  if (i.withdrawableNow > 0n && i.queuedForWithdrawal > 0n) {
    out.push({
      id: "withdrawal-ready",
      severity: "INFO",
      title: "A queued withdrawal is ready to claim",
      what: `$${money(i.withdrawableNow)} of your queued redemption has been funded.`,
      why: "Queued redemptions are paid in order as capital returns. This one is yours to take.",
      action: { label: "Claim it", href: "/earn/positions" },
    });
  }

  // ---- mandates
  for (const m of i.mandates) {
    if (m.status === "REVOKED") {
      out.push({
        id: `mandate-revoked-${m.mandateId}`,
        severity: "INFO",
        title: "A mandate was revoked",
        what: `The agent ${m.agent.slice(0, 10)}… no longer has authority over your account.`,
        why: "Revocation is permanent. Authorising that agent again needs a new signature.",
        action: { label: "See the mandate", href: `/app/mandates/${m.mandateId}` },
      });
      continue;
    }
    const remaining = m.expiresAt - i.now;
    if (m.status === "ACTIVE" && remaining > 0 && remaining < 72 * 3600) {
      out.push({
        id: `mandate-expiring-${m.mandateId}`,
        severity: "WARN",
        title: "A mandate expires soon",
        what: `Authority for ${m.agent.slice(0, 10)}… ends in ${Math.max(1, Math.round(remaining / 3600))} hours.`,
        why:
          "When it lapses the agent stops acting. If it was maintaining a safety buffer for you, " +
          "that stops too — and nothing will warn you again once it has expired.",
        action: { label: "Review it", href: `/app/mandates/${m.mandateId}` },
      });
    }
  }

  const rank: Record<AlertSeverity, number> = { URGENT: 0, WARN: 1, INFO: 2 };
  return out.sort((a, b) => rank[a.severity] - rank[b.severity]);
}

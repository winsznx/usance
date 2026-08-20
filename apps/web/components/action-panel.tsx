"use client";

import { useState, type ComponentType } from "react";
import { Icon } from "@/components/icon";
import { KitIcon, type KitIconName } from "@/components/kit-icon";
import { Notice } from "@/components/primitives";
import { AddCollateralForm, BorrowForm, RepayForm, WithdrawForm } from "@/components/action-forms";
import type { AccountStatus } from "@usance/domain";
import { permittedActions } from "@/lib/account";

/**
 * The four things you can do, in the space where the answer appears.
 *
 * Previously this was a row of links into full pages. Each of those pages was one small form on an
 * otherwise empty screen, and taking a whole navigation to reach one is a lot of ceremony for
 * "repay fifty dollars" — you lose the position you were looking at in order to act on it.
 *
 * The tabs switch the panel in place. The numbers stay on screen, so the thing you are deciding
 * about and the control you decide with are visible at the same time.
 *
 * An action the protocol would refuse is present and disabled with the reason attached, never
 * hidden. Options that silently disappear leave somebody unable to tell broken from blocked.
 */

type ActionKey = "add" | "borrow" | "repay" | "withdraw";

interface ActionDef {
  key: ActionKey;
  label: string;
  icon: KitIconName;
  href: string;
  blurb: string;
  /** Why the protocol will not allow this right now, given the account status. */
  blockedBecause: (status: AccountStatus) => string | null;
}

const ACTIONS: ActionDef[] = [
  {
    key: "add",
    label: "Add collateral",
    icon: "collateral",
    href: "/app/collateral/add",
    blurb: "Deposit an admitted asset. It stays yours, and Usance tells you exactly how much of it will stand behind you.",
    blockedBecause: (s) =>
      s === "BAD_DEBT" ? "This account has been settled against bad debt. Nothing further can be deposited." : null,
  },
  {
    key: "borrow",
    label: "Borrow",
    icon: "borrow",
    href: "/app/borrow",
    blurb: "Draw settlement liquidity against recognised collateral. Your assets stay where they are.",
    blockedBecause: (s) => {
      if (s === "NO_NEW_RISK") return "New borrowing is paused because an input the protocol depends on became untrustworthy, or your recognised value fell. Repaying or adding collateral restores it.";
      if (s === "REDUCE_ONLY" || s === "MARGIN_CALL") return "Your debt is above the level where Usance will take on new risk. Repay or add collateral first.";
      if (s === "LIQUIDATING") return "Collateral is being sold to reduce this debt. New borrowing is not available during liquidation.";
      if (s === "SETTLED" || s === "BAD_DEBT") return "This account is closed to new borrowing.";
      return null;
    },
  },
  {
    key: "repay",
    label: "Repay",
    icon: "repay",
    href: "/app/repay",
    blurb: "Reduce or clear what you owe. Repaying is available in every state except a settled account.",
    blockedBecause: (s) =>
      s === "SETTLED" || s === "BAD_DEBT" ? "There is no outstanding debt on this account." : null,
  },
  {
    key: "withdraw",
    label: "Withdraw",
    icon: "withdraw",
    href: "/app/withdraw",
    blurb: "Take collateral back out. What you can withdraw depends on what still has to cover your debt.",
    blockedBecause: (s) => {
      if (s === "REDUCE_ONLY" || s === "MARGIN_CALL") return "Withdrawal is paused while your debt is above the maintenance limit. Repaying or adding collateral opens it again.";
      if (s === "LIQUIDATING") return "Collateral cannot leave while a liquidation is in progress.";
      if (s === "BAD_DEBT") return "There is no residual equity to withdraw.";
      return null;
    },
  },
];

/** The inline form for each action — the same components the standalone routes render. */
const FORMS: Record<ActionKey, ComponentType> = {
  add: AddCollateralForm,
  borrow: BorrowForm,
  repay: RepayForm,
  withdraw: WithdrawForm,
};

export function ActionPanel({ status }: { status: AccountStatus }) {
  const allowed = permittedActions(status);
  // Opens on the first thing this account can actually do, rather than always on the same tab and
  // immediately showing a refusal.
  const firstUsable = ACTIONS.find((a) => a.blockedBecause(status) === null)?.key ?? "add";
  const [active, setActive] = useState<ActionKey>(firstUsable);

  const current = ACTIONS.find((a) => a.key === active)!;
  const blocked = current.blockedBecause(status);
  const ActiveForm = FORMS[active];

  const permitted: Record<ActionKey, boolean> = {
    add: allowed.addCollateral,
    borrow: allowed.borrow,
    repay: allowed.repay,
    withdraw: allowed.withdraw,
  };

  return (
    <section className="card action-panel" aria-labelledby="actions-heading">
      <h2 id="actions-heading" className="heading" style={{ fontSize: 17, margin: "0 0 14px" }}>
        What you can do now
      </h2>

      <div className="action-tabs" role="tablist" aria-label="Actions">
        {ACTIONS.map((a) => {
          const isBlocked = a.blockedBecause(status) !== null || !permitted[a.key];
          return (
            <button
              key={a.key}
              role="tab"
              type="button"
              id={`tab-${a.key}`}
              aria-selected={active === a.key}
              aria-controls={`panel-${a.key}`}
              className={`action-tab${active === a.key ? " action-tab-active" : ""}${isBlocked ? " action-tab-blocked" : ""}`}
              onClick={() => setActive(a.key)}
            >
              <KitIcon name={a.icon} size={17} />
              <span>{a.label}</span>
              {/* Marked, not removed. A tab that vanishes leaves somebody unable to tell whether
                  the action is gone or the interface is broken. */}
              {isBlocked ? <Icon name="warn" size={13} /> : null}
            </button>
          );
        })}
      </div>

      <div
        className="action-body"
        role="tabpanel"
        id={`panel-${active}`}
        aria-labelledby={`tab-${active}`}
      >
        {blocked ? (
          <Notice tone="warn" title={`${current.label} is not available right now`}>
            {blocked}
          </Notice>
        ) : (
          <>
            <p className="caption" style={{ margin: "0 0 18px", color: "var(--graphite)", maxWidth: "58ch" }}>
              {current.blurb}
            </p>
            {/*
              The form is rendered here, in place, not behind a link — acting on a position should
              not cost you the view of it. The same form still lives on its own route (current.href)
              for deep links; this is that component, mounted inline.
            */}
            <ActiveForm />
          </>
        )}
      </div>
    </section>
  );
}

import {
  authorityAtLeast,
  isSessionRestrictive,
  parseUsd18,
  sentinelPlanSchema,
  withinBudget,
  type BudgetLedger,
  type ConfirmationPolicy,
  type RiskClass,
  type RunState,
  type SentinelInstance,
  type SentinelPlan,
  type SentinelSnapshot,
  type TriggerEvent,
} from "@usance/schemas";

/**
 * Plan validation — the gate between a compiled plan and any request for authority. It is where the
 * risk-class ceiling and the weak-trigger asymmetry (I-66) are enforced, before authorization is
 * ever consulted, and where the instance budget is checked.
 */
export type ValidateOutcome =
  | { kind: "OK" }
  | { kind: "CONFIRM"; reason: string }
  | { kind: "BLOCK"; state: RunState; reason: string };

/** The usd18 amount a plan consumes against budget. */
export function planNotionalUsd18(plan: SentinelPlan): string {
  switch (plan.action) {
    case "REPAY":
      return plan.amountUsd18;
    case "TRADE":
    case "HEDGE":
    case "CLOSE":
      return plan.notionalUsd18;
    case "ADD_COLLATERAL":
    case "SUPPLY_VAULT":
      return (BigInt(plan.amountTokens) * 10n ** BigInt(18 - plan.decimals)).toString();
  }
}

function confirmationRequired(
  policy: ConfirmationPolicy,
  plan: SentinelPlan,
  trigger: TriggerEvent,
  notionalUsd18: string,
): string | null {
  switch (policy.mode) {
    case "AUTO_WITHIN_MANDATE":
      return null;
    case "CONFIRM_EVERY_ACTION":
      return "policy requires confirming every action";
    case "CONFIRM_RISK_INCREASING":
      return plan.riskDirection === "INCREASING" ? "policy requires confirming risk-increasing actions" : null;
    case "CONFIRM_ABOVE_AMOUNT":
      return parseUsd18(notionalUsd18) > parseUsd18(policy.thresholdUsd18)
        ? "policy requires confirming actions above the threshold"
        : null;
    case "CONFIRM_WEAK_TRIGGER":
      return !authorityAtLeast(trigger.authority, "VERIFIED_EXTERNAL")
        ? "policy requires confirming weak-trigger actions"
        : null;
  }
}

export function validatePlan(input: {
  instance: SentinelInstance;
  snapshot: SentinelSnapshot;
  plan: SentinelPlan;
  trigger: TriggerEvent;
  ledger: BudgetLedger;
  templateRiskClass: RiskClass;
  now: number;
}): ValidateOutcome {
  const { instance, snapshot, plan, trigger, ledger, templateRiskClass, now } = input;

  // Parse-don't-repair: the compiled plan must itself satisfy the strict plan schema.
  sentinelPlanSchema.parse(plan);

  // Risk-class ceiling: a risk-reducing-only template can never validate a risk-increasing plan.
  if (plan.riskDirection === "INCREASING" && templateRiskClass === "RISK_REDUCING_ONLY") {
    return { kind: "BLOCK", state: "BLOCKED_BY_POLICY", reason: "risk-reducing-only template produced a risk-increasing plan" };
  }

  // I-66: an AI-only / weak-authority trigger cannot lead to unattended risk increase. It may still
  // reach a human, so it parks for confirmation rather than executing or being refused outright.
  if (plan.riskDirection === "INCREASING" && !authorityAtLeast(trigger.authority, "VERIFIED_EXTERNAL")) {
    return { kind: "CONFIRM", reason: "risk-increasing plan on a weak-authority trigger requires user confirmation (I-66)" };
  }

  // A restrictive market session blocks a venue action outright; T1 REPAY is session-independent.
  const venueAction = plan.action === "TRADE" || plan.action === "HEDGE" || plan.action === "CLOSE";
  if (venueAction && isSessionRestrictive(snapshot.marketSession ?? "UNKNOWN")) {
    return { kind: "BLOCK", state: "BLOCKED_BY_MARKET_SESSION", reason: `market session ${snapshot.marketSession ?? "UNKNOWN"} is restrictive` };
  }

  // Budget — the inner pacing bound inside the mandate's outer wall. Fee is accounted at settlement.
  const notional = planNotionalUsd18(plan);
  const budget = withinBudget(instance.budgetPolicy, ledger, notional, "0", now);
  if (!budget.ok) return { kind: "BLOCK", state: "BLOCKED_BY_BUDGET", reason: budget.reason ?? "budget exceeded" };

  const confirm = confirmationRequired(instance.confirmationPolicy, plan, trigger, notional);
  if (confirm) return { kind: "CONFIRM", reason: confirm };

  return { kind: "OK" };
}

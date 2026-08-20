import type { RunState, SentinelInstance, SentinelPlan, SentinelSnapshot } from "@usance/schemas";
import { planActionBit, type SentinelChainView } from "./chain";

/**
 * The authorization check: preview `ProtocolAllows ∧ MandateAllows` against *live* reads before
 * spending gas. The epoch and mandate are re-read here rather than trusted from the snapshot — a
 * moved epoch (I-65) or a dead/expired mandate (I-73) invalidates the run rather than executing
 * against a world that no longer holds.
 */
export type AuthorizeOutcome = { kind: "AUTHORIZED" } | { kind: "BLOCK"; state: RunState; reason: string };

export async function checkAuthorization(input: {
  chain: SentinelChainView;
  instance: SentinelInstance;
  snapshot: SentinelSnapshot;
  plan: SentinelPlan;
  now: number;
}): Promise<AuthorizeOutcome> {
  const { chain, instance, snapshot, plan, now } = input;

  const epoch = await chain.currentRiskEpoch();
  if (epoch !== snapshot.riskEpoch) {
    return { kind: "BLOCK", state: "BLOCKED_BY_RISK_EPOCH", reason: `risk epoch moved ${snapshot.riskEpoch} -> ${epoch}` };
  }

  const mandate = await chain.mandateState(instance.mandateId);
  if (!mandate || !mandate.live) {
    return { kind: "BLOCK", state: "BLOCKED_BY_MANDATE", reason: "mandate is not live" };
  }
  if (mandate.expiresAt <= now) {
    return { kind: "BLOCK", state: "BLOCKED_BY_MANDATE", reason: "mandate has expired" };
  }
  if ((mandate.allowedActions & (1 << planActionBit(plan))) === 0) {
    return { kind: "BLOCK", state: "BLOCKED_BY_MANDATE", reason: "action is not permitted by the mandate" };
  }

  return { kind: "AUTHORIZED" };
}

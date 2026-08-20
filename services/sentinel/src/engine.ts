import {
  confirmBudget,
  isRunTerminal,
  priorityRank,
  releaseBudget,
  reserveBudget,
  type Hex32,
  type SentinelInstance,
  type SentinelPlan,
  type SentinelRun,
  type SentinelSnapshot,
  type TriggerEvent,
} from "@usance/schemas";
import { checkAuthorization } from "./authorize";
import type { DelegationGatewayClient, SentinelChainView } from "./chain";
import type { BudgetStore } from "./budget-store";
import { openRun, stepRun, type RunStore } from "./run-store";
import { buildSnapshot } from "./snapshot";
import type { TemplateRegistry } from "./templates";
import { triggerMatchesInstance } from "./triggers";
import { planNotionalUsd18, validatePlan } from "./validate";

/**
 * The Sentinel engine drives one trigger occurrence through the autonomy loop:
 *
 *   open → gate → snapshot → compile → validate → (reserve) → authorize → execute → reconcile
 *
 * Every financial edge crosses `ProtocolAllows ∧ MandateAllows`. The loop is idempotent on the
 * derived runId (I-63), consumes budget once at validation (I-69), releases nothing on an unknown
 * execution (I-64), and re-reads the live epoch and mandate before it spends gas (I-65, I-73).
 */
export interface SentinelEngineDeps {
  readonly store: RunStore;
  readonly chain: SentinelChainView;
  readonly gateway: DelegationGatewayClient;
  readonly templates: TemplateRegistry;
  readonly budgets: BudgetStore;
  readonly now: () => number;
}

export interface ProcessOptions {
  /** Set by the supervisor when a higher-priority run is pending on the same account. */
  readonly higherPriorityPending?: boolean;
  /** Asset ids to include in the snapshot's passport list. */
  readonly assetIds?: readonly Hex32[];
}

export interface ProcessResult {
  readonly run: SentinelRun;
  /** False when a duplicate delivery returned an existing record without new effect. */
  readonly created: boolean;
}

export class SentinelEngine {
  constructor(private readonly deps: SentinelEngineDeps) {}

  async processTrigger(
    instance: SentinelInstance,
    config: unknown,
    trigger: TriggerEvent,
    triggerVersion: number,
    options: ProcessOptions = {},
  ): Promise<ProcessResult> {
    const { store, chain, templates, budgets } = this.deps;

    const opened = await openRun(store, instance.instanceId, trigger, triggerVersion, this.deps.now());
    // Idempotency (I-63): a duplicate delivery returns the existing record untouched — no second run.
    if (!opened.created) return { run: opened.record, created: false };
    let run = opened.record;

    const gate = this.armedGate(instance, trigger, this.deps.now(), options);
    if (gate) {
      run = await stepRun(store, run, "BLOCKED_BY_POLICY", this.deps.now(), { reason: gate });
      return { run, created: true };
    }
    run = await stepRun(store, run, "TRIGGER_VALIDATED", this.deps.now());

    run = await stepRun(store, run, "SNAPSHOT_PINNING", this.deps.now());
    const snapshot = await buildSnapshot(chain, instance, this.deps.now(), options.assetIds ?? []);
    run = await stepRun(store, run, "SNAPSHOT_PINNED", this.deps.now(), { snapshot });

    const runtime = templates.get(instance.templateId);
    run = await stepRun(store, run, "PLANNING", this.deps.now());
    if (!runtime) {
      run = await stepRun(store, run, "PLAN_REJECTED", this.deps.now(), { reason: "unknown template — no compiler" });
      return { run, created: true };
    }
    const compiled = runtime.compile({ config, snapshot, trigger });
    if (!compiled.plan) {
      run = await stepRun(store, run, "NO_ACTION_REQUIRED", this.deps.now(), { reason: compiled.reason });
      return { run, created: true };
    }
    run = await stepRun(store, run, "PLAN_READY", this.deps.now(), { plan: compiled.plan, reason: compiled.reason });

    const ledgerBefore = await budgets.get(instance.instanceId);
    const v = validatePlan({
      instance,
      snapshot,
      plan: compiled.plan,
      trigger,
      ledger: ledgerBefore,
      templateRiskClass: runtime.riskClass,
      now: this.deps.now(),
    });
    if (v.kind === "CONFIRM") {
      run = await stepRun(store, run, "WAITING_USER_CONFIRMATION", this.deps.now(), { reason: v.reason });
      return { run, created: true };
    }
    if (v.kind === "BLOCK") {
      run = await stepRun(store, run, v.state, this.deps.now(), { reason: v.reason });
      return { run, created: true };
    }

    // Passed validation → reserve budget once, keyed by runId (I-69). A retry cannot double-consume.
    const notional = planNotionalUsd18(compiled.plan);
    await budgets.save(instance.instanceId, reserveBudget(ledgerBefore, run.runId, notional, "0", this.deps.now()));

    run = await stepRun(store, run, "AUTHORIZATION_CHECKING", this.deps.now());
    const auth = await checkAuthorization({ chain, instance, snapshot, plan: compiled.plan, now: this.deps.now() });
    if (auth.kind === "BLOCK") {
      // Nothing executed → release the reservation. A blocked run holds no budget.
      await budgets.save(instance.instanceId, releaseBudget(await budgets.get(instance.instanceId), run.runId));
      run = await stepRun(store, run, auth.state, this.deps.now(), { reason: auth.reason });
      return { run, created: true };
    }
    run = await stepRun(store, run, "AUTHORIZED", this.deps.now());

    run = await this.execute(instance, run, snapshot, compiled.plan);
    return { run, created: true };
  }

  private armedGate(
    instance: SentinelInstance,
    trigger: TriggerEvent,
    now: number,
    options: ProcessOptions,
  ): string | null {
    if (instance.status !== "ARMED") return `instance is ${instance.status}, not ARMED`;
    if (now < instance.validAfter) return "instance is not yet active";
    if (now >= instance.expiresAt) return "instance has expired";
    if (!triggerMatchesInstance(instance, trigger)) return "trigger does not match any subscribed spec";
    // Priority arbitration: a yield-class instance yields to any higher-priority run pending on the
    // same account (I-67 is the onchain capacity truth; this is the runtime's ordering on top).
    if (options.higherPriorityPending && priorityRank(instance.priorityClass) >= priorityRank("P4_YIELD_OPPORTUNISTIC")) {
      return "a higher-priority run is pending on this account";
    }
    return null;
  }

  private async execute(
    instance: SentinelInstance,
    run: SentinelRun,
    snapshot: SentinelSnapshot,
    plan: SentinelPlan,
  ): Promise<SentinelRun> {
    const { store, gateway, budgets } = this.deps;

    run = await stepRun(store, run, "SUBMITTING", this.deps.now());
    const result = await gateway.execute({
      runId: run.runId,
      account: instance.account,
      agentExecutor: instance.agentExecutor,
      mandateId: instance.mandateId,
      expectedEpoch: snapshot.riskEpoch,
      plan,
    });
    run = await stepRun(store, run, "SUBMITTED", this.deps.now(), { transaction: result.txHash });

    if (result.outcome === "success") {
      // Fee accrues only on a confirmed run (I-70).
      await budgets.save(instance.instanceId, confirmBudget(await budgets.get(instance.instanceId), run.runId));
      run = await stepRun(store, run, "FILLED", this.deps.now());
      run = await stepRun(store, run, "RECONCILING", this.deps.now());
      run = await stepRun(store, run, "RECONCILED", this.deps.now());
      run = await stepRun(store, run, "COMPLETE", this.deps.now());
      return run;
    }

    // Unknown or reverted → EXECUTION_UNKNOWN, which releases nothing (I-64) until resolved.
    run = await stepRun(store, run, "EXECUTION_UNKNOWN", this.deps.now(), {
      reason: result.revertReason ?? "submission outcome unknown",
    });
    if (result.outcome === "reverted") {
      // Mined-and-reverted: nothing executed, so the reservation is released and the run finishes.
      await budgets.save(instance.instanceId, releaseBudget(await budgets.get(instance.instanceId), run.runId));
      run = await stepRun(store, run, "RECONCILING", this.deps.now(), { reason: "transaction reverted onchain" });
      run = await stepRun(store, run, "RECONCILED", this.deps.now());
      run = await stepRun(store, run, "COMPLETE", this.deps.now());
    }
    return run;
  }

  /**
   * Resolve a run whose execution outcome is unknown — after a crash, or a lost response — by asking
   * the chain, never local state. Success confirms and completes; a revert releases and completes;
   * a still-unknown outcome retains the reservation and waits.
   */
  async reconcile(run: SentinelRun, instance: SentinelInstance): Promise<SentinelRun> {
    const { store, chain, budgets } = this.deps;
    if (isRunTerminal(run.state)) return run;

    const lastTx = run.transactions.at(-1);
    if (!lastTx) return run;
    const outcome = await chain.transactionOutcome(lastTx);
    if (outcome === null) return run; // still unknown; the reservation stays (I-64)

    if (outcome === "success") {
      await budgets.save(instance.instanceId, confirmBudget(await budgets.get(instance.instanceId), run.runId));
      if (run.state === "SUBMITTED") run = await stepRun(store, run, "FILLED", this.deps.now());
      if (run.state !== "RECONCILING") run = await stepRun(store, run, "RECONCILING", this.deps.now());
      run = await stepRun(store, run, "RECONCILED", this.deps.now());
      run = await stepRun(store, run, "COMPLETE", this.deps.now());
      return run;
    }

    await budgets.save(instance.instanceId, releaseBudget(await budgets.get(instance.instanceId), run.runId));
    if (run.state === "SUBMITTED") run = await stepRun(store, run, "EXECUTION_UNKNOWN", this.deps.now());
    run = await stepRun(store, run, "RECONCILING", this.deps.now(), { reason: "reverted onchain" });
    run = await stepRun(store, run, "RECONCILED", this.deps.now());
    run = await stepRun(store, run, "COMPLETE", this.deps.now());
    return run;
  }
}

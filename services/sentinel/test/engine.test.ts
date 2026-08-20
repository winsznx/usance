import { describe, expect, it } from "vitest";
import {
  instanceIdFor,
  maskForActions,
  parseUsd18,
  sentinelInstanceSchema,
  spentUsd18,
  templateIdFor,
  type Hex32,
  type SentinelInstance,
} from "@usance/schemas";
import {
  accountHealthTrigger,
  configHashFor,
  defaultTemplateRegistry,
  InMemoryBudgetStore,
  InMemoryRunStore,
  MockChain,
  safetyBufferManifestHash,
  SentinelEngine,
  type DelegationGatewayClient,
  type SentinelChainView,
} from "../src/index";

const ADDR = (n: number): `0x${string}` => `0x${n.toString(16).padStart(40, "0")}`;
const ID = (n: number): Hex32 => `0x${n.toString(16).padStart(64, "0")}` as Hex32;
const usd = (n: number): string => (BigInt(n) * 10n ** 18n).toString();

const CREATED = 1_750_000_000;
const publisher = ADDR(0x9b);
const owner = ADDR(0xa11ce);
const executor = ADDR(0xe0);
const mandateId = ID(0x11);

const config = {
  targetBufferBps: 2500,
  warningBufferBps: 3000,
  actionBufferBps: 1500,
  maxRepayPerRunUsd18: usd(500),
  dailyCapUsd18: usd(1500),
  cooldownSeconds: 900,
};

function buildInstance(overrides: Record<string, unknown> = {}): SentinelInstance {
  return sentinelInstanceSchema.parse({
    instanceId: instanceIdFor(owner, 0n),
    owner,
    account: owner,
    templateId: templateIdFor(publisher, "safety-buffer"),
    templateVersion: 1,
    manifestHash: safetyBufferManifestHash(publisher, CREATED),
    agentExecutor: executor,
    mandateId,
    configHash: configHashFor(config),
    triggerPolicy: {
      triggers: [{ class: "RISK_STATE", kind: "HEALTH_CHANGED" }],
      allowedAuthorityClasses: ["DETERMINISTIC_ONCHAIN"],
    },
    budgetPolicy: { maxPerRunUsd18: usd(500), maxPerDayUsd18: usd(1500), cooldownSeconds: 900 },
    priorityClass: "P1_SAFETY_MAINTENANCE",
    confirmationPolicy: { mode: "AUTO_WITHIN_MANDATE" },
    status: "ARMED",
    createdAt: CREATED,
    validAfter: CREATED,
    expiresAt: CREATED + 1_000_000,
    lastRunId: null,
    lastSuccessfulRunAt: null,
    ...overrides,
  });
}

function deterioratedChain(): MockChain {
  const chain = new MockChain(1952);
  // buffer = (maintenance - debt)/maintenance = (1000-900)/1000 = 1000bps, below the 1500 action threshold.
  chain.setAccount(owner, {
    recognisedUsd18: usd(1000),
    debtUsd18: usd(900),
    borrowLimitUsd18: usd(800),
    maintenanceLimitUsd18: usd(1000),
  });
  chain.setMandate(mandateId, {
    live: true,
    expiresAt: CREATED + 1_000_000,
    remainingDebtUsd18: usd(1000),
    remainingNotionalUsd18: "0",
    allowedActions: maskForActions(["REPAY", "ADD_COLLATERAL"]),
    agentExecutor: executor,
  });
  return chain;
}

function engineOver(chain: SentinelChainView, gateway: DelegationGatewayClient) {
  let t = CREATED;
  const store = new InMemoryRunStore();
  const budgets = new InMemoryBudgetStore();
  const engine = new SentinelEngine({
    store,
    chain,
    gateway,
    templates: defaultTemplateRegistry(publisher, CREATED),
    budgets,
    now: () => ++t,
  });
  return { engine, store, budgets };
}

const trigger = accountHealthTrigger(owner, "MARGIN_CALL", 38_000_000, CREATED + 1);

describe("Safety Buffer end to end", () => {
  it("observes deterioration and repays without a user pressing execute", async () => {
    const chain = deterioratedChain();
    const { engine, budgets } = engineOver(chain, chain.gateway());
    const instance = buildInstance();

    const { run, created } = await engine.processTrigger(instance, config, trigger, 1);

    expect(created).toBe(true);
    expect(run.state).toBe("COMPLETE");
    expect(run.plan?.action).toBe("REPAY");
    // target buffer 25% → target debt 750; repay 150.
    expect(run.plan?.action === "REPAY" ? run.plan.amountUsd18 : null).toBe(usd(150));
    expect((await chain.accountState(owner)).debtUsd18).toBe(usd(750));
    expect((await chain.accountState(owner)).bufferBps).toBe(2500);
    expect(run.transactions).toHaveLength(1);

    const ledger = await budgets.get(instance.instanceId);
    expect(ledger).toHaveLength(1);
    expect(ledger[0]?.state).toBe("CONFIRMED");
  });

  it("does nothing when the buffer holds", async () => {
    const chain = new MockChain(1952);
    chain.setAccount(owner, {
      recognisedUsd18: usd(1000),
      debtUsd18: usd(500),
      borrowLimitUsd18: usd(800),
      maintenanceLimitUsd18: usd(1000),
    });
    chain.setMandate(mandateId, {
      live: true,
      expiresAt: CREATED + 1_000_000,
      remainingDebtUsd18: usd(1000),
      remainingNotionalUsd18: "0",
      allowedActions: maskForActions(["REPAY", "ADD_COLLATERAL"]),
      agentExecutor: executor,
    });
    const { engine } = engineOver(chain, chain.gateway());

    const { run } = await engine.processTrigger(buildInstance(), config, trigger, 1);
    expect(run.state).toBe("NO_ACTION_REQUIRED");
    expect((await chain.accountState(owner)).debtUsd18).toBe(usd(500));
  });

  it("a duplicate trigger delivery produces exactly one financial effect (I-63)", async () => {
    const chain = deterioratedChain();
    const { engine, store } = engineOver(chain, chain.gateway());
    const instance = buildInstance();

    const first = await engine.processTrigger(instance, config, trigger, 1);
    const second = await engine.processTrigger(instance, config, trigger, 1);

    expect(second.created).toBe(false);
    expect(second.run.runId).toBe(first.run.runId);
    // Repaid once, not twice.
    expect((await chain.accountState(owner)).debtUsd18).toBe(usd(750));
    expect(await store.forInstance(instance.instanceId)).toHaveLength(1);
  });

  it("a revoked mandate blocks execution and releases the reservation (I-73)", async () => {
    const chain = deterioratedChain();
    chain.revokeMandate(mandateId);
    const { engine, budgets } = engineOver(chain, chain.gateway());
    const instance = buildInstance();

    const { run } = await engine.processTrigger(instance, config, trigger, 1);
    expect(run.state).toBe("BLOCKED_BY_MANDATE");
    expect((await chain.accountState(owner)).debtUsd18).toBe(usd(900)); // untouched
    expect(spentUsd18(await budgets.get(instance.instanceId))).toBe(0n); // nothing held
  });

  it("blocks when the per-run budget is exceeded (BLOCKED_BY_BUDGET)", async () => {
    const chain = deterioratedChain();
    const { engine } = engineOver(chain, chain.gateway());
    const instance = buildInstance({ budgetPolicy: { maxPerRunUsd18: usd(100), cooldownSeconds: 900 } });

    const { run } = await engine.processTrigger(instance, config, trigger, 1);
    expect(run.state).toBe("BLOCKED_BY_BUDGET"); // wants to repay 150 > per-run cap 100
    expect((await chain.accountState(owner)).debtUsd18).toBe(usd(900));
  });

  it("blocks when the risk epoch moves between snapshot and authorization (I-65)", async () => {
    const chain = deterioratedChain();
    // Returns epoch 1 for the snapshot read, 2 for the authorization re-read.
    const shifting: SentinelChainView = {
      block: () => chain.block(),
      currentRiskEpoch: (() => {
        let reads = 0;
        return async () => (++reads > 1 ? 2 : 1);
      })(),
      accountState: (a) => chain.accountState(a),
      mandateState: (m) => chain.mandateState(m),
      passportVersions: (ids) => chain.passportVersions(ids),
      marketSession: (a) => chain.marketSession(a),
      transactionOutcome: (tx) => chain.transactionOutcome(tx),
    };
    const { engine } = engineOver(shifting, chain.gateway());

    const { run } = await engine.processTrigger(buildInstance(), config, trigger, 1);
    expect(run.state).toBe("BLOCKED_BY_RISK_EPOCH");
    expect((await chain.accountState(owner)).debtUsd18).toBe(usd(900)); // untouched
  });

  it("retains the reservation on an unknown execution, then resolves it from the chain (I-64, crash-resume)", async () => {
    const chain = deterioratedChain();
    // A gateway that lands the transaction but loses the response — the classic crash window.
    const lossy: DelegationGatewayClient = {
      execute: async (req) => ({ ...(await chain.gateway().execute(req)), outcome: "unknown" }),
    };
    const { engine, budgets } = engineOver(chain, lossy);
    const instance = buildInstance();

    const { run } = await engine.processTrigger(instance, config, trigger, 1);
    expect(run.state).toBe("EXECUTION_UNKNOWN");
    // I-64: the reservation is not released while the outcome is unknown.
    expect(spentUsd18(await budgets.get(instance.instanceId))).toBe(parseUsd18(usd(150)));

    const resolved = await engine.reconcile(run, instance);
    expect(resolved.state).toBe("COMPLETE");
    expect((await budgets.get(instance.instanceId))[0]?.state).toBe("CONFIRMED");
  });

  it("refuses to run a paused instance", async () => {
    const chain = deterioratedChain();
    const { engine } = engineOver(chain, chain.gateway());
    const { run } = await engine.processTrigger(buildInstance({ status: "PAUSED" }), config, trigger, 1);
    expect(run.state).toBe("BLOCKED_BY_POLICY");
    expect((await chain.accountState(owner)).debtUsd18).toBe(usd(900));
  });
});

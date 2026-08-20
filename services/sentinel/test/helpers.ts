import {
  instanceIdFor,
  maskForActions,
  sentinelInstanceSchema,
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

export const ADDR = (n: number): `0x${string}` => `0x${n.toString(16).padStart(40, "0")}`;
export const ID = (n: number): Hex32 => `0x${n.toString(16).padStart(64, "0")}` as Hex32;
export const usd = (n: number): string => (BigInt(n) * 10n ** 18n).toString();

export const CREATED = 1_750_000_000;
export const publisher = ADDR(0x9b);
export const owner = ADDR(0xa11ce);
export const executor = ADDR(0xe0);
export const mandateId = ID(0x11);

export const config = {
  targetBufferBps: 2500,
  warningBufferBps: 3000,
  actionBufferBps: 1500,
  maxRepayPerRunUsd18: usd(500),
  dailyCapUsd18: usd(1500),
  cooldownSeconds: 900,
};

export function buildInstance(overrides: Record<string, unknown> = {}): SentinelInstance {
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

export function deterioratedChain(): MockChain {
  const chain = new MockChain(1952);
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

export function makeEngine(chain: SentinelChainView, gateway: DelegationGatewayClient) {
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

export const trigger = accountHealthTrigger(owner, "MARGIN_CALL", 38_000_000, CREATED + 1);

import {
  actionsInMask,
  instanceIdFor,
  maskForActions,
  sentinelInstanceSchema,
  sentinelTemplateVersionSchema,
  TRIGGER_CLASSES,
  type SentinelInstance,
  type SentinelRun,
} from "@usance/schemas";
import type { UsanceReceipt } from "@usance/evidence";
import {
  accountHealthTrigger,
  configHashFor,
  defaultTemplateRegistry,
  InMemoryBudgetStore,
  InMemoryRunStore,
  MockChain,
  safetyBufferManifest,
  safetyBufferManifestHash,
  SentinelEngine,
  sentinelRunReceipt,
} from "@usance/sentinel";

/**
 * The Sentinel data layer for the web app.
 *
 * The marketplace catalogue is the *real* T1 manifest (`@usance/sentinel`), so publisher, version,
 * risk class, required permissions, trigger classes and fee model are the genuine committed values —
 * no fake ROI, no invented statistics. The sample runs are produced by the *real* engine against an
 * in-memory chain, deterministically, and are labelled as testnet fixtures: they are how the
 * run-detail timeline shows real agent behaviour before a live indexer exists, not fabricated data.
 */

const PUBLISHER = `0x${"a1".repeat(20)}` as `0x${string}`;
const OWNER = `0x${"a11ce0".padStart(40, "0")}` as `0x${string}`;
const EXECUTOR = `0x${"e0".repeat(20)}` as `0x${string}`;
const MANDATE = `0x${"11".repeat(32)}` as `0x${string}`;
const CREATED = 1_750_000_000;

const usd = (n: number): string => (BigInt(n) * 10n ** 18n).toString();

const config = {
  targetBufferBps: 2500,
  warningBufferBps: 3000,
  actionBufferBps: 1500,
  maxRepayPerRunUsd18: usd(500),
  dailyCapUsd18: usd(1500),
  cooldownSeconds: 900,
};

const manifest = safetyBufferManifest(PUBLISHER, CREATED);
const manifestHash = safetyBufferManifestHash(PUBLISHER, CREATED);

const version = sentinelTemplateVersionSchema.parse({
  templateId: manifest.templateId,
  version: manifest.version,
  publisher: manifest.publisher,
  manifestHash,
  configSchemaHash: manifest.configSchemaHash,
  triggerSchemaHash: manifest.triggerSchemaHash,
  planSchemaHash: manifest.planSchemaHash,
  riskClass: manifest.riskClass,
  requiredActions: manifest.requiredActions,
  requiredTriggerClasses: manifest.requiredTriggerClasses,
  feePolicy: manifest.feePolicy,
  status: "ACTIVE",
  auditStatus: "UNAUDITED",
  minimumProtocolVersion: manifest.minimumProtocolVersion,
  createdAt: manifest.createdAt,
});

const sampleInstance: SentinelInstance = sentinelInstanceSchema.parse({
  instanceId: instanceIdFor(OWNER, 0n),
  owner: OWNER,
  account: OWNER,
  templateId: manifest.templateId,
  templateVersion: 1,
  manifestHash,
  agentExecutor: EXECUTOR,
  mandateId: MANDATE,
  configHash: configHashFor(config),
  triggerPolicy: {
    triggers: [{ class: "RISK_STATE", kind: "HEALTH_CHANGED", bufferAtOrBelowBps: 1500 }],
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
});

export interface TemplateCard {
  templateId: string;
  version: number;
  name: string;
  description: string;
  publisher: string;
  riskClass: string;
  status: string;
  auditStatus: string;
  actions: readonly string[];
  triggerClasses: readonly string[];
  requiredVenues: readonly string[];
  feePerSuccessfulRunBps: number;
  flatPerRunUsd18: string;
  manifestHash: string;
  compilerVersion: string;
  minimumProtocolVersion: string;
}

function card(): TemplateCard {
  return {
    templateId: manifest.templateId,
    version: manifest.version,
    name: manifest.name,
    description: manifest.description,
    publisher: manifest.publisher,
    riskClass: manifest.riskClass,
    status: version.status,
    auditStatus: version.auditStatus,
    actions: actionsInMask(manifest.requiredActions).map((a) => a.name),
    triggerClasses: TRIGGER_CLASSES.filter((_, i) => (manifest.requiredTriggerClasses & (1 << i)) !== 0),
    requiredVenues: manifest.requiredVenues,
    feePerSuccessfulRunBps: manifest.feePolicy.perSuccessfulRunBps,
    flatPerRunUsd18: manifest.feePolicy.flatPerRunUsd18,
    manifestHash,
    compilerVersion: manifest.compilerVersion,
    minimumProtocolVersion: manifest.minimumProtocolVersion,
  };
}

export function sentinelCatalogue(): TemplateCard[] {
  return [card()];
}

export function templateById(templateId: string): TemplateCard | null {
  return sentinelCatalogue().find((c) => c.templateId === templateId) ?? null;
}

/**
 * Receipt-derived marketplace statistics. There is no live Sentinel indexer yet, so these are
 * honestly zero rather than invented — the page says "no runs recorded yet" instead of a fake ROI.
 */
export interface TemplateStats {
  activeInstances: number;
  executedRuns: number;
  reconciledRuns: number;
  executionUnknownRuns: number;
  mandateViolationsRefused: number;
}

export function templateStats(_templateId: string): TemplateStats {
  return { activeInstances: 0, executedRuns: 0, reconciledRuns: 0, executionUnknownRuns: 0, mandateViolationsRefused: 0 };
}

export interface SampleRun {
  run: SentinelRun;
  receipt: UsanceReceipt | null;
  instance: SentinelInstance;
}

async function runScenario(revoke: boolean, triggerVersion: number): Promise<SampleRun> {
  const chain = new MockChain(1952);
  chain.setAccount(OWNER, {
    recognisedUsd18: usd(1000),
    debtUsd18: usd(900),
    borrowLimitUsd18: usd(800),
    maintenanceLimitUsd18: usd(1000),
  });
  chain.setMandate(MANDATE, {
    live: !revoke,
    expiresAt: CREATED + 1_000_000,
    remainingDebtUsd18: usd(1000),
    remainingNotionalUsd18: "0",
    allowedActions: maskForActions(["REPAY", "ADD_COLLATERAL"]),
    agentExecutor: EXECUTOR,
  });
  let t = CREATED;
  const engine = new SentinelEngine({
    store: new InMemoryRunStore(),
    chain,
    gateway: chain.gateway(),
    templates: defaultTemplateRegistry(PUBLISHER, CREATED),
    budgets: new InMemoryBudgetStore(),
    now: () => ++t,
  });
  const trigger = accountHealthTrigger(OWNER, "MARGIN_CALL", 38_000_000, CREATED + 1);
  const { run } = await engine.processTrigger(sampleInstance, config, trigger, triggerVersion);
  return { run, receipt: sentinelRunReceipt(run, sampleInstance), instance: sampleInstance };
}

/** A positive (autonomous repay) run and a negative (revoked-mandate) run — both engine-produced. */
export async function loadSampleRuns(): Promise<SampleRun[]> {
  return Promise.all([runScenario(false, 1), runScenario(true, 2)]);
}

export async function loadSampleRun(runId: string): Promise<SampleRun | null> {
  return (await loadSampleRuns()).find((r) => r.run.runId === runId) ?? null;
}

export function fmtUsd18(s: string | null | undefined): string {
  if (s === null || s === undefined) return "—";
  const cents = BigInt(s) / 10n ** 16n;
  return (Number(cents) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function short(h: string | null | undefined): string {
  return h ? `${h.slice(0, 10)}…${h.slice(-6)}` : "—";
}

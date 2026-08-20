/**
 * FLAGSHIP LIVE PROOF — a Sentinel autonomously repays debt on X Layer testnet (1952).
 *
 *   pnpm --filter @usance/sentinel exec vite-node scripts/live-proof.mts
 *
 * No human sends the repay. The Sentinel runtime observes the account through live viem adapters,
 * compiles a risk-reducing plan, checks ProtocolAllows ∧ MandateAllows against live state, and the
 * bounded agent executor submits the REPAY through the already-deployed DelegationGateway. The same
 * mechanics `scripts/live-mandate.mjs` proved by hand, now driven by the engine.
 *
 * Owner and agent are distinct addresses; the agent's key is derived from the deployer's so the
 * scenario reproduces from one secret. tUSTB / tUSD are labelled testnet stand-ins, no real value.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPublicClient,
  createWalletClient,
  formatUnits,
  http,
  keccak256,
  parseAbi,
  stringToBytes,
  type Address,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  accountHealthTrigger,
  configHashFor,
  defaultTemplateRegistry,
  InMemoryBudgetStore,
  InMemoryRunStore,
  safetyBufferManifestHash,
  SentinelEngine,
  sentinelRunReceipt,
} from "../src/index";
import { XLayerChainView, XLayerDelegationGateway } from "../src/live/xlayer";
import { instanceIdFor, maskForActions, sentinelInstanceSchema, templateIdFor } from "@usance/schemas";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../..");
const d = JSON.parse(readFileSync(resolve(root, "deployments/1952.json"), "utf8"));
const C = d.contracts;
const F = d.testnetFixtures;
const RPC = process.env.XLAYER_TESTNET_RPC_URL ?? "https://testrpc.xlayer.tech";

const pk = process.env.DEPLOYER_PRIVATE_KEY;
if (!pk) {
  console.error("DEPLOYER_PRIVATE_KEY not set");
  process.exit(1);
}

const chain = { id: 1952, name: "X Layer Testnet", nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } };
const owner = privateKeyToAccount(pk as `0x${string}`);
const agent = privateKeyToAccount(keccak256(stringToBytes(`usance-mandate-agent/${pk.slice(2, 10)}`)));

const pub = createPublicClient({ chain, transport: http(RPC) });
const ownerWallet = createWalletClient({ account: owner, chain, transport: http(RPC) });
const agentWallet = createWalletClient({ account: agent, chain, transport: http(RPC) });

const ERC20 = parseAbi(["function mint(address,uint256)", "function approve(address,uint256) returns (bool)", "function balanceOf(address) view returns (uint256)"]);
const CH = parseAbi(["function debtOf(address) view returns (uint256)", "function addCollateral(bytes32,uint256)", "function borrow(uint256,uint64)"]);
const MR = parseAbi([
  "function accountIdFor(address) view returns (bytes32)",
  "function leafFor(bytes32) view returns (bytes32)",
  "function mandateDigest((address,address,bytes32,uint64,uint64,uint256,uint256,uint16,uint16,uint16,uint64,bytes32,bytes32,uint256)) view returns (bytes32)",
  "function registerMandate((address,address,bytes32,uint64,uint64,uint256,uint256,uint16,uint16,uint16,uint64,bytes32,bytes32,uint256), bytes) returns (bytes32)",
  "function mandateIdFor(address,uint256) view returns (bytes32)",
]);

const ASSET = F.collateralAssetId as `0x${string}`;
const usd18 = (n: number) => (BigInt(n) * 10n ** 18n).toString();
const usd = (v: bigint) => `$${Number(formatUnits(v, 18)).toLocaleString(undefined, { maximumFractionDigits: 4 })}`;
const txs: Array<{ label: string; hash: string; block: number; status: string }> = [];

async function send(label: string, to: Address, abi: readonly unknown[], fn: string, args: readonly unknown[], as: "owner" | "agent" = "owner") {
  const wallet = as === "agent" ? agentWallet : ownerWallet;
  const account = as === "agent" ? agent : owner;
  const hash = await wallet.writeContract({ address: to, abi: abi as never, functionName: fn as never, args: args as never, account, chain });
  const r = await pub.waitForTransactionReceipt({ hash, timeout: 180_000 });
  console.log(`    ${r.status === "success" ? "OK  " : "FAIL"} ${label.padEnd(30)} ${hash.slice(0, 18)}…  block ${r.blockNumber}`);
  txs.push({ label, hash, block: Number(r.blockNumber), status: r.status });
  if (r.status !== "success") throw new Error(`${label} reverted`);
  return r;
}

const read = <T,>(to: Address, abi: readonly unknown[], fn: string, args: readonly unknown[] = []) =>
  pub.readContract({ address: to, abi: abi as never, functionName: fn as never, args: args as never }) as Promise<T>;

console.log("\nUSANCE SENTINEL — LIVE AUTONOMOUS PROOF (X Layer testnet 1952)");
console.log(`owner ${owner.address}\nagent ${agent.address}`);
console.log("NOTE: tUSTB/tUSD are labelled TEST assets, not any issuer token.\n");

// 0. fund the agent's gas
const agentGas = await pub.getBalance({ address: agent.address });
if (agentGas < 3n * 10n ** 15n) {
  const h = await ownerWallet.sendTransaction({ to: agent.address, value: 6n * 10n ** 15n - agentGas, account: owner, chain });
  await pub.waitForTransactionReceipt({ hash: h, timeout: 180_000 });
  console.log("    OK   funded agent gas");
}

// 1. the owner already carries debt on this deployment; the Sentinel will reduce it.
// New borrowing is gated here (AccountNotHealthy — the mock feeds are stale on this 2-day-old
// testnet, so the protocol refuses NEW risk), but REPAY is risk-reducing and remains available.
// That is exactly the action a Safety Buffer Sentinel takes, so the gate is the right backdrop.
console.log("1. Read the owner's existing debt (the Sentinel will reduce it)");
const REPAY_USD18 = 10_000_000_000_000_000n; // $0.01, comfortably below the standing debt
const debtBefore = await read<bigint>(C.clearingHouse, CH, "debtOf", [owner.address]);
console.log(`    debt ${usd(debtBefore)}`);
if (debtBefore <= REPAY_USD18 * 2n) {
  console.error(`    debt ${usd(debtBefore)} too small to prove a repay of ${usd(REPAY_USD18)} without over-repaying; aborting`);
  process.exit(1);
}

// 2. owner signs a fresh REPAY-only mandate for the agent
console.log("\n2. Owner signs a REPAY-only mandate for the agent");
const accountId = await read<`0x${string}`>(C.mandateRegistry, MR, "accountIdFor", [owner.address]);
const assetLeaf = await read<`0x${string}`>(C.mandateRegistry, MR, "leafFor", [ASSET]);
const now = BigInt(Math.floor(Date.now() / 1000));
const REPAY_BIT = 1 << 1;
const mandate = [owner.address, agent.address, accountId, now - 60n, now + 86_400n, 5_000n * 10n ** 18n, 10_000n * 10n ** 18n, 30_000, 50, REPAY_BIT, 604_800n, assetLeaf, assetLeaf, now] as const;
const digest = await read<`0x${string}`>(C.mandateRegistry, MR, "mandateDigest", [mandate]);
const signature = await owner.sign({ hash: digest });
await send("registerMandate", C.mandateRegistry, MR, "registerMandate", [mandate, signature]);
const mandateId = await read<`0x${string}`>(C.mandateRegistry, MR, "mandateIdFor", [owner.address, now]);
console.log(`    mandateId ${mandateId.slice(0, 18)}… (REPAY only, 24h)`);

// 3. the agent needs settlement token to fund the repayment it performs
const agentUsd = await read<bigint>(F.settlementToken, ERC20, "balanceOf", [agent.address]);
if (agentUsd < 5n * 10n ** 6n) await send("mint tUSD to agent", F.settlementToken, ERC20, "mint", [agent.address, 1_000n * 10n ** 6n]);
await send("agent approves ClearingHouse", F.settlementToken, ERC20, "approve", [C.clearingHouse, 2n ** 255n], "agent");

// 4. arm a Safety Buffer Sentinel and let the engine drive
console.log("\n3. Arm a Safety Buffer Sentinel and run the autonomy loop");
const publisher = owner.address;
const CREATED = 1_750_000_000;
const config = { targetBufferBps: 10_000, warningBufferBps: 10_000, actionBufferBps: 10_000, maxRepayPerRunUsd18: REPAY_USD18.toString(), dailyCapUsd18: (REPAY_USD18 * 5n).toString(), cooldownSeconds: 0 };
const nowSec = Math.floor(Date.now() / 1000);

const instance = sentinelInstanceSchema.parse({
  instanceId: instanceIdFor(owner.address, 0n),
  owner: owner.address,
  account: owner.address,
  templateId: templateIdFor(publisher, "safety-buffer"),
  templateVersion: 1,
  manifestHash: safetyBufferManifestHash(publisher, CREATED),
  agentExecutor: agent.address,
  mandateId,
  configHash: configHashFor(config),
  triggerPolicy: { triggers: [{ class: "RISK_STATE", kind: "HEALTH_CHANGED" }], allowedAuthorityClasses: ["DETERMINISTIC_ONCHAIN"] },
  budgetPolicy: { maxPerRunUsd18: REPAY_USD18.toString(), cooldownSeconds: 0 },
  priorityClass: "P1_SAFETY_MAINTENANCE",
  confirmationPolicy: { mode: "AUTO_WITHIN_MANDATE" },
  status: "ARMED",
  createdAt: nowSec,
  validAfter: nowSec - 60,
  expiresAt: nowSec + 86_400,
  lastRunId: null,
  lastSuccessfulRunAt: null,
});

const chainView = new XLayerChainView(
  pub,
  { clearingHouse: C.clearingHouse, riskPolicyRegistry: C.riskPolicyRegistry, mandateRegistry: C.mandateRegistry, delegationGateway: C.delegationGateway },
  1952,
  { mandateId, allowedActions: REPAY_BIT, expiresAt: Number(now + 86_400n), agentExecutor: agent.address },
);
const gateway = new XLayerDelegationGateway(agentWallet, pub, C.delegationGateway, ASSET, mandateId, chain);
const engine = new SentinelEngine({
  store: new InMemoryRunStore(),
  chain: chainView,
  gateway,
  templates: defaultTemplateRegistry(publisher, CREATED),
  budgets: new InMemoryBudgetStore(),
  now: () => Math.floor(Date.now() / 1000),
});

const trigger = accountHealthTrigger(owner.address, "SAFETY_CHECK", Number(await pub.getBlockNumber()), nowSec);
const { run } = await engine.processTrigger(instance, config, trigger, 1, {});
console.log(`    run ${run.runId.slice(0, 18)}… state ${run.state}`);
for (const h of run.history) console.log(`      ${h.to}${h.reason ? `  (${h.reason})` : ""}`);

const repayTx = run.transactions[0] ?? null;
let repayBlock: bigint | undefined;
if (repayTx) {
  const r = await pub.waitForTransactionReceipt({ hash: repayTx as `0x${string}`, timeout: 180_000 });
  repayBlock = r.blockNumber;
  txs.push({ label: "sentinel autonomous REPAY", hash: repayTx, block: Number(r.blockNumber), status: r.status });
}
// Pin the post-state read to the repay block. The load-balanced RPC can otherwise answer from a
// node that has not applied it yet and report the debt as unchanged (see scripts/live-mandate.mjs).
const debtAfter = (await pub.readContract({
  address: C.clearingHouse,
  abi: CH as never,
  functionName: "debtOf" as never,
  args: [owner.address] as never,
  blockNumber: repayBlock,
})) as bigint;
console.log(`    debt ${usd(debtBefore)} -> ${usd(debtAfter)}  (repay tx ${repayTx ? repayTx.slice(0, 18) + "…" : "none"})`);

const receipt = sentinelRunReceipt(run, instance);
const out = {
  kind: "LIVE_SENTINEL_AUTONOMOUS_RUN",
  chainId: 1952,
  network: "X Layer Testnet",
  owner: owner.address,
  agent: agent.address,
  delegationGateway: C.delegationGateway,
  sentinelTemplateRegistry: C.sentinelTemplateRegistry,
  sentinelInstanceRegistry: C.sentinelInstanceRegistry,
  instanceId: instance.instanceId,
  runId: run.runId,
  runState: run.state,
  trigger: { class: trigger.class, authority: trigger.authority },
  plan: run.plan,
  mandateId,
  repayTx,
  debtBefore: debtBefore.toString(),
  debtAfter: debtAfter.toString(),
  receiptStatus: receipt?.status ?? null,
  receiptKind: receipt?.kind ?? null,
  identityWarning: "tUSTB/tUSD are labelled testnet stand-ins, not any issuer token. This proves autonomy mechanics.",
  transactions: txs,
};
writeFileSync(resolve(root, "proof/live-sentinel.json"), JSON.stringify(out, null, 2) + "\n");

const checks: Array<[string, boolean]> = [
  ["the run reached COMPLETE", run.state === "COMPLETE"],
  ["the Sentinel executed exactly one transaction", run.transactions.length === 1],
  ["the owner's debt fell", debtAfter < debtBefore],
  ["a receipt was produced at CONFIRMED", receipt?.status === "CONFIRMED"],
];
console.log("");
let bad = 0;
for (const [name, ok] of checks) {
  console.log(`  ${ok ? "OK  " : "FAIL"} ${name}`);
  if (!ok) bad++;
}
console.log(`\n${bad === 0 ? "PROVEN: a Sentinel autonomously repaid debt on X Layer — no user sent the transaction." : `NOT PROVEN — ${bad} check(s) failed`}`);
console.log("Wrote proof/live-sentinel.json");
process.exit(bad === 0 ? 0 : 1);

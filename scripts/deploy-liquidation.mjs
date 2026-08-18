#!/usr/bin/env node
/**
 * Attach the liquidation module to the live core.
 *
 *   node scripts/deploy-liquidation.mjs
 *
 * Deployed incrementally rather than by redeploying the whole system, because that is what actually
 * happens when a new module ships against a live protocol: the core keeps its address, its state and
 * its history, and governance wires the new contracts in. Redeploying ten contracts to add two would
 * have thrown away the Passport and the risk history already committed against them.
 *
 * The manifest gains a `liquidation` section rather than having the addresses folded into
 * `contracts`. `make test-live-xlayer` compares deployed bytecode against the local build for
 * everything in `contracts`, and these were deployed from the same build — but keeping them in their
 * own section records that they arrived separately, which is exactly the kind of thing a reader
 * should not have to infer from block numbers.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createPublicClient, createWalletClient, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { xlayerTransport } from "./_rpc.mjs";
import { repoRoot, writeArtifact, digestOf } from "./_artifact.mjs";

const d = JSON.parse(readFileSync(resolve(repoRoot, "deployments/1952.json"), "utf8"));
const C = d.contracts;
const F = d.testnetFixtures;

const pk = process.env.DEPLOYER_PRIVATE_KEY;
if (!pk) { console.error("DEPLOYER_PRIVATE_KEY not set"); process.exit(1); }
const account = privateKeyToAccount(pk);
const chain = { id: 1952, name: "X Layer Testnet", nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 }, rpcUrls: { default: { http: [] } } };
const pub = createPublicClient({ chain, transport: xlayerTransport() });
const wallet = createWalletClient({ account, chain, transport: xlayerTransport() });

const artifact = (name) =>
  JSON.parse(readFileSync(resolve(repoRoot, `contracts/out/${name}.sol/${name}.json`), "utf8"));

const sent = [];
async function deploy(name, args) {
  const a = artifact(name);
  const hash = await wallet.deployContract({ abi: a.abi, bytecode: a.bytecode.object, args, account, chain });
  const r = await pub.waitForTransactionReceipt({ hash, timeout: 180_000 });
  if (r.status !== "success") throw new Error(`${name} deployment reverted in ${hash}`);
  console.log(`  deployed ${name.padEnd(24)} ${r.contractAddress}  block ${r.blockNumber}`);
  sent.push({ label: `deploy ${name}`, hash, blockNumber: Number(r.blockNumber), address: r.contractAddress });
  return r.contractAddress;
}

async function send(label, address, abi, functionName, args) {
  const hash = await wallet.writeContract({ address, abi, functionName, args, account, chain });
  const r = await pub.waitForTransactionReceipt({ hash, timeout: 180_000 });
  if (r.status !== "success") throw new Error(`${label} reverted in ${hash}`);
  console.log(`  OK  ${label.padEnd(34)} ${hash.slice(0, 18)}…  block ${r.blockNumber}`);
  sent.push({ label, hash, blockNumber: Number(r.blockNumber) });
  return r;
}

const AUTH = parseAbi([
  "function LIQUIDATOR() view returns (bytes32)",
  "function GOVERNANCE() view returns (bytes32)",
  "function hasRole(bytes32,address) view returns (bool)",
  "function grantRole(bytes32,address)",
]);
const LM = parseAbi([
  "function registerRoute(address)",
  "function routeCount() view returns (uint256)",
  "function bestRoute(bytes32,uint256) view returns (bytes32,uint256)",
]);
const ROUTE = parseAbi([
  "function routeId() view returns (bytes32)",
  "function isAvailable(bytes32) view returns (bool)",
  "function description() view returns (string)",
]);
const ERC20 = parseAbi(["function mint(address,uint256)", "function balanceOf(address) view returns (uint256)"]);

console.log("\nAttaching the liquidation module to the live Usance core on X Layer testnet\n");
console.log(`  core commit   ${d.commit}`);
console.log(`  clearingHouse ${C.clearingHouse}\n`);

const manager = await deploy("LiquidationManager", [C.authority, C.clearingHouse]);
const route = await deploy("DirectSettlementRoute", [C.authority, C.assetRegistry, C.oracleAdapter, F.settlementToken, 6]);

console.log("");
await send("registerRoute", manager, LM, "registerRoute", [route]);

const liquidatorRole = await pub.readContract({ address: C.authority, abi: AUTH, functionName: "LIQUIDATOR" });
if (!(await pub.readContract({ address: C.authority, abi: AUTH, functionName: "hasRole", args: [liquidatorRole, account.address] }))) {
  await send("grantRole(LIQUIDATOR)", C.authority, AUTH, "grantRole", [liquidatorRole, account.address]);
}

// The route pays out of a settlement buffer. An empty buffer is not a route and `isAvailable`
// says so, which is the honest failure — but it means the module is not usable until funded.
const BUFFER = 200_000n * 10n ** 6n;
if ((await pub.readContract({ address: F.settlementToken, abi: ERC20, functionName: "balanceOf", args: [route] })) < BUFFER) {
  await send("fund route buffer (tUSD)", F.settlementToken, ERC20, "mint", [route, BUFFER]);
}

console.log("\nVerifying:");
const checks = [
  ["route registered", Number(await pub.readContract({ address: manager, abi: LM, functionName: "routeCount" })) === 1],
  ["route available", await pub.readContract({ address: route, abi: ROUTE, functionName: "isAvailable", args: [F.collateralAssetId] })],
  ["liquidator role", await pub.readContract({ address: C.authority, abi: AUTH, functionName: "hasRole", args: [liquidatorRole, account.address] })],
];
let bad = 0;
for (const [name, ok] of checks) { console.log(`  ${ok ? "OK " : "FAIL"} ${name}`); if (!ok) bad++; }
if (bad > 0) { console.error("\nRefusing to record a module that did not wire correctly."); process.exit(1); }

const description = await pub.readContract({ address: route, abi: ROUTE, functionName: "description" });
const routeId = await pub.readContract({ address: route, abi: ROUTE, functionName: "routeId" });

writeArtifact("deployments/1952-liquidation.json", {
  attachedToCommit: d.commit,
  clearingHouse: C.clearingHouse,
  contracts: { liquidationManager: manager, directSettlementRoute: route },
  route: { routeId, description, bufferToken: F.settlementToken, bufferFunded: BUFFER.toString() },
  liquidator: account.address,
  transactions: sent,
}, { chainId: 1952, tool: "scripts/deploy-liquidation.mjs", inputDigest: digestOf(`${C.clearingHouse}:${C.authority}`) });

console.log("\nWrote deployments/1952-liquidation.json");
console.log(`  liquidationManager     ${manager}`);
console.log(`  directSettlementRoute  ${route}`);

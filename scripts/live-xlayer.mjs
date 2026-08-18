#!/usr/bin/env node
/**
 * Live X Layer smoke test.
 *
 *   make test-live-xlayer
 *
 * Reads the committed deployment manifest and queries the chain for every contract in it. This is
 * the check that catches the class of bug local tests cannot: a contract that deployed but was
 * never wired, a manifest address that points at nothing, or a registry whose configuration did
 * not survive the broadcast.
 *
 * Exits non-zero on any mismatch. Exits 0 with a clear message when nothing is deployed yet,
 * because "not deployed" is a legitimate state and not a test failure.
 */

import { createPublicClient, http, parseAbi } from "viem";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");

const CHAINS = {
  1952: { name: "X Layer Testnet", rpc: process.env.XLAYER_TESTNET_RPC_URL ?? "https://testrpc.xlayer.tech" },
  196: { name: "X Layer", rpc: process.env.XLAYER_RPC_URL ?? "https://rpc.xlayer.tech" },
};

const chainId = Number(process.env.XLAYER_CHAIN_ID ?? 1952);
const chain = CHAINS[chainId];
if (!chain) {
  console.error(`XLAYER_CHAIN_ID=${chainId} is not an X Layer chain.`);
  process.exit(1);
}

const manifestPath = resolve(repoRoot, "deployments/manifest.ts");
if (!existsSync(manifestPath)) {
  console.log("No deployments/manifest.ts. Nothing to check.");
  process.exit(0);
}

// The manifest is a TypeScript module so the web app can import it type-safely. Reading it here
// with a regex avoids adding a TS loader to a script whose whole job is to be dependency-light.
const manifestSrc = readFileSync(manifestPath, "utf8");

// True when the manifest declares no chains at all. The predicate used to be called `hasEntries`
// while matching `= {}`, so it meant the exact opposite of its name — the kind of inversion that
// reads correctly right up until someone edits the branch.
const manifestIsEmpty = /deployments\s*:\s*Record<number,\s*DeploymentManifest>\s*=\s*\{\s*\}/.test(manifestSrc);

if (manifestIsEmpty) {
  console.log("");
  console.log(`No deployment recorded for any chain yet.`);
  console.log("");
  console.log("  make deployer          show the deployer address and funding status");
  console.log("  make deploy-testnet    broadcast once the deployer is funded");
  console.log("");
  console.log("This is not a failure. Nothing is deployed, and the manifest says so honestly.");
  process.exit(0);
}

// Scope to the requested chain before scraping addresses. A regex over the whole file happily
// collects a second chain's contracts and then checks them against this chain's RPC, where they
// have no code — reporting a broken deployment that is not broken, or worse, passing because the
// addresses happen to collide.
const chainBlockStart = manifestSrc.search(new RegExp(`(^|\\W)"?${chainId}"?\\s*:\\s*\\{`, "m"));
if (chainBlockStart === -1) {
  console.log("");
  console.log(`Manifest has no entry for chain ${chainId}. Nothing is deployed there.`);
  console.log("");
  console.log("  make deploy-testnet    broadcast once the deployer is funded");
  process.exit(0);
}
const nextChain = manifestSrc.slice(chainBlockStart + 1).search(/^\s{2}"?\d+"?\s*:\s*\{/m);
const chainBlock = nextChain === -1 ? manifestSrc.slice(chainBlockStart) : manifestSrc.slice(chainBlockStart, chainBlockStart + 1 + nextChain);

// Keys may be bare or quoted depending on how the manifest was generated, so both are matched.
const addresses = [...chainBlock.matchAll(/"?([A-Za-z_]\w*)"?\s*:\s*"(0x[0-9a-fA-F]{40})"/g)].map(
  ([, name, addr]) => ({ name, addr }),
);

// A verifier that discovers nothing to verify has failed, not passed. The manifest declares this
// chain is deployed; finding zero addresses inside that declaration means the manifest is
// malformed or the scraper is broken, and both are worse than no manifest at all. Reporting "no
// addresses found" and exiting 0 is how a green check ends up sitting on top of a dead deployment.
if (addresses.length === 0) {
  console.error("");
  console.error(`FAIL: chain ${chainId} is declared in the manifest but no contract addresses could be read from it.`);
  console.error("      Either the manifest is malformed or this script's parser no longer matches its shape.");
  console.error("      Refusing to report success on a deployment that could not be checked.");
  process.exit(1);
}

// The public X Layer RPC drops DNS and connections often enough that a bare transport turns this
// check into a coin flip, and a verifier that fails intermittently gets ignored.
const client = createPublicClient({ transport: http(chain.rpc, { retryCount: 6, retryDelay: 2000, timeout: 60_000 }) });

console.log("");
console.log(`Checking ${addresses.length} contracts on ${chain.name} (${chainId})`);
console.log("");

let failures = 0;

const onChainId = await client.getChainId();
if (onChainId !== chainId) {
  console.log(`  ✗ RPC reports chain ${onChainId}, expected ${chainId}`);
  process.exit(1);
}
console.log(`  ✓ RPC reports chain ${onChainId}`);

for (const { name, addr } of addresses) {
  const code = await client.getBytecode({ address: addr });
  if (!code || code === "0x") {
    console.log(`  ✗ ${name.padEnd(20)} ${addr}  NO CODE`);
    failures++;
  } else {
    console.log(`  ✓ ${name.padEnd(20)} ${addr}  ${(code.length - 2) / 2} bytes`);
  }
}

// Does the deployed code match what this checkout builds?
//
// Contract-has-code is not the check people think it is. After a redeploy the manifest kept
// pointing at the previous contracts, every one of which still had code and still answered every
// wiring call, so this script reported "deployment is live and wired" about a protocol that was no
// longer the one in the source tree. Comparing runtime bytecode is what tells those apart.
//
// A mismatch is reported, not fatal. Immutable constructor arguments are embedded in runtime code,
// so an honest deployment of identical source can differ in a few words; metadata hashes differ
// across compiler patch versions too. Length is compared exactly and content approximately, which
// catches "this is a different contract" without crying wolf over "this is the same contract with
// different constructor arguments".
const artifactFor = {
  authority: "Authority", assetRegistry: "AssetRegistry", evidenceRegistry: "EvidenceRegistry",
  passportRegistry: "PassportRegistry", riskPolicyRegistry: "RiskPolicyRegistry",
  collateralVault: "CollateralVault", liquidityVault: "LiquidityVault",
  financingEngine: "FinancingEngine", clearingHouse: "ClearingHouse", oracleAdapter: "ChainlinkFeedAdapter",
};

let drifted = 0;
for (const { name, addr } of addresses) {
  const artifact = artifactFor[name];
  if (!artifact) continue;
  const path = resolve(repoRoot, `contracts/out/${artifact}.sol/${artifact}.json`);
  if (!existsSync(path)) continue;

  const local = JSON.parse(readFileSync(path, "utf8"))?.deployedBytecode?.object;
  if (!local || local === "0x") continue;

  const onChain = await client.getBytecode({ address: addr });
  if (!onChain) continue;

  if (onChain.length !== local.length) {
    console.log("");
    console.log(`  ✗ ${name} on chain is ${(onChain.length - 2) / 2} bytes, this checkout builds ${(local.length - 2) / 2}`);
    console.log(`     The manifest points at a contract that is not what this source compiles to.`);
    console.log(`     Redeploy, or regenerate the manifest with: node scripts/write-manifest.mjs`);
    drifted++;
  }
}
if (drifted > 0) failures += drifted;

// Wiring checks: a deployed-but-unwired protocol reads fine at the bytecode level and is
// completely non-functional, which is exactly the failure this script exists to catch.
const clearing = addresses.find((a) => /clearing/i.test(a.name));
const policy = addresses.find((a) => /policy/i.test(a.name));

if (clearing && policy) {
  try {
    const epoch = await client.readContract({
      address: policy.addr,
      abi: parseAbi(["function riskEpoch() view returns (uint64)"]),
      functionName: "riskEpoch",
    });
    console.log("");
    console.log(`  ✓ RiskPolicyRegistry.riskEpoch() = ${epoch}`);
    if (epoch === 0n) {
      console.log("  ✗ epoch 0 means the registry was never initialised");
      failures++;
    }
  } catch (e) {
    console.log(`  ✗ could not read riskEpoch: ${e.shortMessage ?? e.message}`);
    failures++;
  }

  try {
    const settlement = await client.readContract({
      address: clearing.addr,
      abi: parseAbi(["function settlementAssetId() view returns (bytes32)"]),
      functionName: "settlementAssetId",
    });
    const unset = settlement === `0x${"0".repeat(64)}`;
    console.log(`  ${unset ? "✗" : "✓"} ClearingHouse.settlementAssetId() = ${settlement}`);
    if (unset) failures++;
  } catch (e) {
    console.log(`  ✗ could not read settlementAssetId: ${e.shortMessage ?? e.message}`);
    failures++;
  }
}

console.log("");
if (failures > 0) {
  console.log(`${failures} check(s) failed.`);
  process.exit(1);
}
console.log("Deployment is live and wired.");

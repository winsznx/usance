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
const hasEntries = /deployments\s*:\s*Record<number,\s*DeploymentManifest>\s*=\s*\{\s*\}/.test(manifestSrc);

if (hasEntries) {
  console.log("");
  console.log(`No deployment recorded for any chain yet.`);
  console.log("");
  console.log("  make deployer          show the deployer address and funding status");
  console.log("  make deploy-testnet    broadcast once the deployer is funded");
  console.log("");
  console.log("This is not a failure. Nothing is deployed, and the manifest says so honestly.");
  process.exit(0);
}

// Keys may be bare or quoted depending on how the manifest was generated, so both are matched.
const addresses = [...manifestSrc.matchAll(/"?([A-Za-z_]\w*)"?\s*:\s*"(0x[0-9a-fA-F]{40})"/g)].map(
  ([, name, addr]) => ({ name, addr }),
);

if (addresses.length === 0) {
  console.log(`Manifest present but no addresses found for chain ${chainId}.`);
  process.exit(0);
}

const client = createPublicClient({ transport: http(chain.rpc) });

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

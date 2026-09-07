#!/usr/bin/env node
/**
 * Manual explorer-verification package for the CURRENT X Layer testnet (1952) deployment.
 *
 *   node scripts/gen-verification-package.mjs
 *
 * The OKLink API-key path is not reachable from the public account flow, so automated
 * `forge verify-contract` is not an option. The supported fallback is the browser form at
 *   https://www.oklink.com/x-layer-testnet/verify-contract-preliminary
 * which accepts a Solidity Standard JSON Input. This script produces everything that form asks
 * for, per contract, from local source — it deploys nothing and reads nothing secret.
 *
 * Output:
 *   docs/verification/1952/standard-json/<contract>.json   — paste into the "Standard JSON Input" field
 *   docs/verification/1952/CHECKLIST.md                    — one row per contract with every field value
 *   docs/verification/1952/package.json                    — machine-readable of the same
 *
 * Bytecode-match is a SEPARATE, already-established proof (scripts/live-xlayer.mjs). This package
 * is only about publishing source beside that bytecode.
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, http, keccak256 } from "viem";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const contractsDir = resolve(repo, "contracts");
const outDir = resolve(repo, "docs/verification/1952");
const rpc = process.env.XLAYER_TESTNET_RPC_URL ?? "https://testrpc.xlayer.tech";

/** manifest key -> { name, src } (source path relative to contracts/). */
const CONTRACTS = {
  authority: { name: "Authority", src: "src/core/Authority.sol" },
  assetRegistry: { name: "AssetRegistry", src: "src/core/AssetRegistry.sol" },
  evidenceRegistry: { name: "EvidenceRegistry", src: "src/core/EvidenceRegistry.sol" },
  passportRegistry: { name: "PassportRegistry", src: "src/core/PassportRegistry.sol" },
  riskPolicyRegistry: { name: "RiskPolicyRegistry", src: "src/core/RiskPolicyRegistry.sol" },
  oracleAdapter: { name: "ChainlinkFeedAdapter", src: "src/adapters/ChainlinkFeedAdapter.sol" },
  collateralVault: { name: "CollateralVault", src: "src/core/CollateralVault.sol" },
  liquidityVault: { name: "LiquidityVault", src: "src/core/LiquidityVault.sol" },
  financingEngine: { name: "FinancingEngine", src: "src/core/FinancingEngine.sol" },
  clearingHouse: { name: "ClearingHouse", src: "src/core/ClearingHouse.sol" },
  feeController: { name: "FeeController", src: "src/core/FeeController.sol" },
  mandateRegistry: { name: "MandateRegistry", src: "src/core/MandateRegistry.sol" },
  delegationGateway: { name: "DelegationGateway", src: "src/core/DelegationGateway.sol" },
  intentBook: { name: "IntentBook", src: "src/core/IntentBook.sol" },
  sentinelTemplateRegistry: {
    name: "SentinelTemplateRegistry",
    src: "src/core/SentinelTemplateRegistry.sol",
  },
  sentinelInstanceRegistry: {
    name: "SentinelInstanceRegistry",
    src: "src/core/SentinelInstanceRegistry.sol",
  },
};

const manifest = JSON.parse(readFileSync(resolve(repo, "deployments/1952.json"), "utf8"));
const addresses = manifest.contracts;

/** Read every CREATE tx from a broadcast run, keyed by contract name (last wins = current). */
function creationTxs(runPath) {
  if (!existsSync(runPath)) return {};
  const run = JSON.parse(readFileSync(runPath, "utf8"));
  const out = {};
  for (const t of run.transactions ?? []) {
    if (t.transactionType !== "CREATE") continue;
    out[t.contractName] = {
      address: (t.contractAddress ?? "").toLowerCase(),
      data: t.transaction?.input ?? t.transaction?.data ?? "",
      args: t.arguments ?? [],
      commit: run.commit ?? null,
    };
  }
  return out;
}

const coreRun = creationTxs(
  resolve(contractsDir, "broadcast/Deploy.s.sol/1952/run-1787093382203.json"),
);
const sentinelRun = creationTxs(
  resolve(contractsDir, "broadcast/DeploySentinels.s.sol/1952/run-1787215876793.json"),
);
const broadcastByName = { ...coreRun, ...sentinelRun };

function forge(args) {
  return execFileSync("forge", args, { cwd: contractsDir, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

function gitCommitFor(srcRel) {
  try {
    return execFileSync("git", ["log", "-1", "--format=%h", "--", `contracts/${srcRel}`], {
      cwd: repo,
      encoding: "utf8",
    }).trim();
  } catch {
    return null;
  }
}

const headCommit = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: repo, encoding: "utf8" }).trim();

// Compiler settings are uniform for every contract — read them straight from foundry.toml so the
// checklist can never drift from what the build actually uses.
const toml = readFileSync(resolve(contractsDir, "foundry.toml"), "utf8");
const pick = (k) => (toml.match(new RegExp(`^${k}\\s*=\\s*"?([^"\\n]+)"?`, "m")) ?? [])[1];
const settings = {
  compilerVersion: `v${pick("solc_version")}`,
  optimizer: pick("optimizer") === "true",
  optimizerRuns: Number(pick("optimizer_runs")),
  evmVersion: pick("evm_version"),
  viaIR: pick("via_ir") === "true",
  bytecodeHash: pick("bytecode_hash"),
  cborMetadata: pick("cbor_metadata") === "true",
  license: "BUSL-1.1",
};

const client = createPublicClient({ transport: http(rpc, { retryCount: 4, retryDelay: 2000, timeout: 30_000 }) });

mkdirSync(resolve(outDir, "standard-json"), { recursive: true });

const rows = [];
for (const [key, { name, src }] of Object.entries(CONTRACTS)) {
  const address = addresses[key];
  const target = `${src}:${name}`;

  // Standard JSON Input — the whole imported-source graph, exactly what OKLink wants.
  const stdJson = forge([
    "verify-contract",
    "0x0000000000000000000000000000000000000000",
    target,
    "--show-standard-json-input",
  ]);
  // Strip remappings that resolved to absolute local paths (foundry auto-discovers a few from the
  // OZ sub-library). None of the inlined source keys need them, and they would leak a local
  // username. Keep only the two the repo actually declares.
  const parsed = JSON.parse(stdJson);
  if (Array.isArray(parsed.settings?.remappings)) {
    parsed.settings.remappings = parsed.settings.remappings.filter((r) => {
      const rhs = r.split("=")[1] ?? "";
      return rhs.startsWith("../") || rhs.startsWith("forge-std") || rhs.startsWith("@openzeppelin");
    });
  }
  writeFileSync(
    resolve(outDir, "standard-json", `${name}.json`),
    JSON.stringify(parsed, null, 2) + "\n",
  );

  const creation = forge(["inspect", name, "bytecode"]).trim();
  const deployed = forge(["inspect", name, "deployedBytecode"]).trim();
  const linked = /__\$[0-9a-f]{34}\$__/i.test(deployed); // link placeholder => external library

  // Constructor args, ABI-encoded: the tail of the deployment input after the creation code.
  const bc = broadcastByName[name];
  let constructorArgs = "0x";
  if (bc?.data && bc.data.toLowerCase().startsWith(creation.toLowerCase())) {
    constructorArgs = "0x" + bc.data.slice(creation.length);
  } else if (bc?.data && creation.length > 2) {
    // Creation code embeds immutables set from constructor args, so a prefix match can fail even
    // when the source is right. Fall back to the decoded arg list for the operator to encode.
    constructorArgs = null;
  }

  const onchain = await client.getCode({ address });
  const onchainHash = onchain ? keccak256(onchain) : null;
  const onchainLen = onchain ? (onchain.length - 2) / 2 : 0;
  const localDeployedLen = (deployed.length - 2) / 2;
  const localDeployedHash = keccak256(deployed);

  // Same length => immutables aside, the source is the right shape. Exact hash match only happens
  // for contracts with no immutables. A length mismatch is a real "wrong source commit" signal.
  const lengthMatches = onchainLen === localDeployedLen;

  rows.push({
    key,
    name,
    address,
    src,
    deployedFromBroadcastCommit: bc?.commit ?? null,
    sourceLastTouchedCommit: gitCommitFor(src),
    headCommit,
    ...settings,
    linkedLibraries: linked ? "PRESENT — resolve before verifying" : "none",
    constructorArgsAbiEncoded: constructorArgs,
    constructorArgsDecoded: bc?.args ?? [],
    onchainRuntimeBytes: onchainLen,
    onchainRuntimeKeccak: onchainHash,
    localDeployedBytes: localDeployedLen,
    localDeployedKeccak: localDeployedHash,
    lengthMatch: lengthMatches,
    standardJson: `docs/verification/1952/standard-json/${name}.json`,
  });
  process.stderr.write(`  ${name.padEnd(26)} len ${lengthMatches ? "match" : "DIFFERS"}\n`);
}

writeFileSync(resolve(outDir, "package.json"), JSON.stringify({ chainId: 1952, generatedAt: new Date().toISOString(), headCommit, settings, contracts: rows }, null, 2) + "\n");

// ---- checklist ----
const L = [];
L.push("# OKLink manual verification checklist — X Layer testnet (1952)");
L.push("");
L.push(`Generated \`${new Date().toISOString().slice(0, 10)}\` from \`${headCommit}\` by \`scripts/gen-verification-package.mjs\`.`);
L.push("");
L.push("Form: <https://www.oklink.com/x-layer-testnet/verify-contract-preliminary>");
L.push("Method: **Solidity (Standard JSON Input)** — this repo has imported sources, so do not flatten.");
L.push("");
L.push("## Same for every contract");
L.push("");
L.push(`| Field | Value |`);
L.push(`|---|---|`);
L.push(`| Compiler type | Solidity (Standard-Json-Input) |`);
L.push(`| Compiler version | \`${settings.compilerVersion}\` |`);
L.push(`| Open source license | \`${settings.license}\` |`);
L.push(`| Optimization | \`${settings.optimizer ? "Yes" : "No"}\` |`);
L.push(`| Optimizer runs | \`${settings.optimizerRuns}\` |`);
L.push(`| EVM version | \`${settings.evmVersion}\` |`);
L.push(`| via-IR | \`${settings.viaIR ? "Yes" : "No"}\` |`);
L.push(`| Metadata bytecode hash | \`${settings.bytecodeHash}\` (already encoded in the Standard JSON — do not override) |`);
L.push(`| CBOR metadata | \`${settings.cborMetadata ? "Yes" : "No"}\` |`);
L.push(`| Linked libraries | none (all internal libraries, inlined) |`);
L.push("");
L.push("The Standard JSON files already carry `settings.optimizer`, `settings.evmVersion`, `settings.metadata` and `settings.remappings`, so the only fields to fill on the form are the address, the contract name, the Standard JSON file, and the constructor arguments.");
L.push("");
L.push("## Per contract");
L.push("");
for (const r of rows) {
  L.push(`### ${r.name}`);
  L.push("");
  L.push(`- **Address:** \`${r.address}\``);
  L.push(`- **Contract name (for the form):** \`${r.src}:${r.name}\``);
  L.push(`- **Standard JSON Input:** \`${r.standardJson}\``);
  L.push(
    `- **Constructor arguments (ABI-encoded):** ${
      r.constructorArgsAbiEncoded === "0x"
        ? "`0x` (no constructor args)"
        : r.constructorArgsAbiEncoded
          ? `\`${r.constructorArgsAbiEncoded}\``
          : "creation-code prefix did not match — encode from the decoded list below"
    }`,
  );
  if (r.constructorArgsDecoded.length) {
    L.push(`- **Constructor arguments (decoded):** ${r.constructorArgsDecoded.map((a) => `\`${a}\``).join(", ")}`);
  }
  L.push(`- **Source commit (last touched):** \`${r.sourceLastTouchedCommit ?? "?"}\` · package built from \`${r.headCommit}\` · deployed from broadcast at \`${r.deployedFromBroadcastCommit ?? "?"}\``);
  L.push(`- **Expected on-chain runtime bytecode:** \`${r.onchainRuntimeBytes}\` bytes · keccak256 \`${r.onchainRuntimeKeccak}\``);
  L.push(`- **Local build runtime bytecode:** \`${r.localDeployedBytes}\` bytes · keccak256 \`${r.localDeployedKeccak}\` · length ${r.lengthMatch ? "**matches** (immutables aside, source shape is correct)" : "**DIFFERS — investigate the source commit before verifying this one**"}`);
  L.push("");
}
writeFileSync(resolve(outDir, "CHECKLIST.md"), L.join("\n") + "\n");

process.stderr.write(`\nWrote ${outDir}/CHECKLIST.md, package.json and ${rows.length} standard-json files.\n`);

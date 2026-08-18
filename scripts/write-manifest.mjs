#!/usr/bin/env node
/**
 * Turn a forge broadcast into the deployment manifest.
 *
 *   node scripts/write-manifest.mjs [chainId]
 *
 * `Deploy.s.sol` has always ended by logging its addresses "so scripts/write-manifest.mjs can turn
 * a broadcast into the generated manifest without anyone copying an address by hand". That script
 * did not exist. The manifest was maintained by hand, and after the next deployment it described
 * contracts that were no longer the live ones — while `make test-live-xlayer` cheerfully reported
 * "deployment is live and wired", because it verifies whatever the manifest points at.
 *
 * Addresses come from the broadcast receipts rather than from the console output, because receipts
 * are what the chain accepted. A logged address is what the script intended.
 *
 * Everything derived here is checked against the chain by `scripts/live-xlayer.mjs`, which also
 * compares deployed bytecode against the local build so a stale manifest fails instead of passing.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, http, parseAbi } from "viem";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const chainId = Number(process.argv[2] ?? 1952);

const NETWORKS = {
  1952: { name: "X Layer Testnet", explorer: "https://www.oklink.com/x-layer-testnet", rpc: process.env.XLAYER_TESTNET_RPC_URL ?? "https://testrpc.xlayer.tech" },
  196: { name: "X Layer", explorer: "https://www.oklink.com/x-layer", rpc: process.env.XLAYER_RPC_URL ?? "https://rpc.xlayer.tech" },
};
const net = NETWORKS[chainId];
if (!net) throw new Error(`chain ${chainId} is not an X Layer chain`);

const broadcastPath = resolve(repoRoot, `contracts/broadcast/Deploy.s.sol/${chainId}/run-latest.json`);
if (!existsSync(broadcastPath)) {
  console.error(`No broadcast at ${broadcastPath}. Run \`make deploy-testnet\` first.`);
  process.exit(1);
}
const broadcast = JSON.parse(readFileSync(broadcastPath, "utf8"));

// Solidity contract name -> manifest key. Anything created by the script but absent from this map
// is reported rather than silently dropped: a new contract that nobody adds here would otherwise
// deploy, work, and be invisible to every downstream consumer of the manifest.
const CORE = {
  Authority: "authority",
  AssetRegistry: "assetRegistry",
  EvidenceRegistry: "evidenceRegistry",
  PassportRegistry: "passportRegistry",
  RiskPolicyRegistry: "riskPolicyRegistry",
  CollateralVault: "collateralVault",
  LiquidityVault: "liquidityVault",
  FinancingEngine: "financingEngine",
  ClearingHouse: "clearingHouse",
  ChainlinkFeedAdapter: "oracleAdapter",
  FeeController: "feeController",
  MandateRegistry: "mandateRegistry",
};

const creates = broadcast.transactions.filter((t) => t.transactionType === "CREATE");
const contracts = {};
const deploymentTx = {};
const unmapped = [];

for (const t of creates) {
  const key = CORE[t.contractName];
  if (!key) { unmapped.push(t.contractName); continue; }
  contracts[key] = t.contractAddress;
  deploymentTx[key] = t.hash;
}

const missing = Object.values(CORE).filter((k) => !contracts[k]);
if (missing.length) {
  console.error(`Broadcast is missing core contracts: ${missing.join(", ")}`);
  process.exit(1);
}

// The testnet stand-ins, in creation order. TestnetUSD and its aggregator are deployed first for
// settlement; the treasury token and its aggregator come later for collateral. Order is how they
// are told apart, so it is asserted rather than assumed.
const aggregators = creates.filter((t) => t.contractName === "TestnetAggregator").map((t) => t.contractAddress);
const testnetFixtures = chainId === 1952
  ? {
      note: "TEST ASSETS — NO REAL VALUE. Not FOBXX, OUSG, ARCOIN or any issuer token.",
      settlementToken: creates.find((t) => t.contractName === "TestnetUSD")?.contractAddress,
      settlementFeed: aggregators[0],
      collateralToken: creates.find((t) => t.contractName === "TestnetTreasuryToken")?.contractAddress,
      collateralFeed: aggregators[1],
      sequencerFeed: creates.find((t) => t.contractName === "TestnetSequencerUptimeFeed")?.contractAddress,
    }
  : undefined;

if (testnetFixtures && Object.values(testnetFixtures).some((v) => v === undefined)) {
  console.error("Testnet fixtures incomplete in the broadcast; refusing to write a partial manifest.");
  process.exit(1);
}

// Asset ids are derived by the registry, so they are read back from the chain rather than
// recomputed here. Two derivations of one identifier is one derivation too many.
const client = createPublicClient({ transport: http(net.rpc, { retryCount: 6, retryDelay: 2000, timeout: 60_000 }) });
const AR = parseAbi(["function assetIdFor(uint256,address) view returns (bytes32)"]);
const CH = parseAbi(["function settlementAssetId() view returns (bytes32)"]);

const settlementAssetId = await client.readContract({ address: contracts.clearingHouse, abi: CH, functionName: "settlementAssetId" });
let collateralAssetId;
if (testnetFixtures) {
  collateralAssetId = await client.readContract({
    address: contracts.assetRegistry, abi: AR, functionName: "assetIdFor",
    args: [BigInt(chainId), testnetFixtures.collateralToken],
  });
  testnetFixtures.collateralAssetId = collateralAssetId;
}

const firstBlock = Math.min(...broadcast.receipts.map((r) => Number(r.blockNumber)));
const commit = execSync("git rev-parse --short HEAD", { cwd: repoRoot }).toString().trim();
const deployedAt = new Date(broadcast.timestamp).toISOString().replace(/\.\d{3}Z$/, "Z");

const doc = {
  chainId,
  network: net.name,
  deployedAt,
  deployer: broadcast.transactions[0].transaction.from,
  firstBlock,
  explorer: net.explorer,
  commit,
  contracts,
  deploymentTx,
  ...(testnetFixtures ? { testnetFixtures } : {}),
  settlementAsset: {
    assetId: settlementAssetId,
    symbol: chainId === 1952 ? "tUSD" : "USDC",
    token: testnetFixtures?.settlementToken ?? null,
    decimals: 6,
  },
  verified: false,
  verificationNote: "Bytecode is live on chain. Explorer source verification has not been performed.",
};

writeFileSync(resolve(repoRoot, `deployments/${chainId}.json`), JSON.stringify(doc, null, 2) + "\n");

// The manifest module the web app imports. Regenerated whole so a removed chain actually
// disappears instead of lingering as an entry nobody updates.
const others = {};
for (const f of [196, 1952]) {
  if (f === chainId) continue;
  const p = resolve(repoRoot, `deployments/${f}.json`);
  if (existsSync(p)) others[f] = JSON.parse(readFileSync(p, "utf8"));
}
const entries = { ...others, [chainId]: doc };

const header = readFileSync(resolve(repoRoot, "deployments/manifest.ts"), "utf8")
  .split("export const deployments")[0]
  .trimEnd();

const body = Object.entries(entries)
  .map(([id, d]) => `  ${id}: ${JSON.stringify({
    chainId: d.chainId,
    deployedAt: d.deployedAt,
    commit: d.commit,
    contracts: d.contracts,
    assets: d.testnetFixtures
      ? [{
          assetId: d.testnetFixtures.collateralAssetId,
          symbol: "tUSTB",
          name: "USANCE TESTNET TOKENIZED T-BILL - NO REAL VALUE",
          token: d.testnetFixtures.collateralToken,
          decimals: 18,
          isTestFixture: true,
        }]
      : [],
    settlementAsset: d.settlementAsset,
  }, null, 2).split("\n").join("\n  ")},`)
  .join("\n");

writeFileSync(
  resolve(repoRoot, "deployments/manifest.ts"),
  `${header}\n\nexport const deployments: Record<number, DeploymentManifest> = {\n${body}\n};\n`,
);

console.log(`Wrote deployments/${chainId}.json and deployments/manifest.ts from the broadcast`);
console.log(`  commit ${commit}   block ${firstBlock}   ${Object.keys(contracts).length} core contracts`);
if (unmapped.length) console.log(`  not in the manifest (by design): ${[...new Set(unmapped)].join(", ")}`);

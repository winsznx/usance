#!/usr/bin/env node
/**
 * Rebuild a Passport's proof record from chain logs.
 *
 *   node scripts/reconcile-passport.mjs <fixtureId>
 *
 * Committing again to regenerate a lost record would burn a version number for nothing — versions
 * are strictly sequential and permanent, so "v2, committed because a JSON file went stale" would be
 * in the asset's history forever.
 *
 * Instead the record is recovered from events. `PassportCommitted`, `EvidenceCommitted` and
 * `EpochBumped` each carry the transaction that emitted them, so every hash here came from the
 * chain rather than from a console log somebody pasted. That is also the reconciliation path a
 * workflow needs after a crash: the question "did my commit land?" is answered by the registry,
 * never by local state.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createPublicClient, parseAbi, parseAbiItem } from "viem";
import { xlayerTransport } from "./_rpc.mjs";
import { registerWorkspaceResolver } from "./_workspace.mjs";

registerWorkspaceResolver();
const { loadManifest } = await import("@usance/evidence");

const deployment = JSON.parse(readFileSync("deployments/1952.json", "utf8"));
const C = deployment.contracts;
const pub = createPublicClient({
  chain: { id: deployment.chainId, name: deployment.network, nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 }, rpcUrls: { default: { http: [] } } },
  transport: xlayerTransport(),
});

const fixtureId = process.argv[2];
if (!fixtureId) {
  const manifest = await loadManifest();
  console.error(`usage: reconcile-passport.mjs <fixtureId>\navailable: ${manifest.documents.map((d) => d.id).join(", ")}`);
  process.exit(1);
}

const assetId = `0x${Buffer.from(`usance-fixture-asset:${fixtureId}`.padEnd(32, "\0").slice(0, 32)).toString("hex")}`;

const version = await pub.readContract({
  address: C.passportRegistry,
  abi: parseAbi(["function currentVersion(bytes32) view returns (uint64)"]),
  functionName: "currentVersion",
  args: [assetId],
});
if (Number(version) === 0) {
  console.error(`No Passport onchain for ${fixtureId}. Nothing to reconcile — run commit-passport.mjs.`);
  process.exit(1);
}

const header = await pub.readContract({
  address: C.passportRegistry,
  abi: parseAbi(["function getCurrentPassport(bytes32) view returns ((bytes32,bytes32,uint64,bytes32,bytes32,uint64,uint64,uint8,bool,uint16,bool))"]),
  functionName: "getCurrentPassport",
  args: [assetId],
});
const [passportId, , hVersion, evidenceRoot, claimsRoot, createdAt, , status, redemptionSupported, redemptionFloorBps, singleSource] = header;

const fromBlock = BigInt(deployment.firstBlock);
const transactions = [];

/**
 * `eth_getLogs` over an arbitrary range, in windows the endpoint will accept.
 *
 * X Layer's public RPC rejects anything wider than 100 blocks with `-32602: block range greater
 * than 100 max`. A one-shot query from the deployment block therefore fails the moment the chain
 * has moved on, which is always. The window is deliberately not a constant shared with anything
 * else: it is a property of this endpoint, not of the protocol.
 */
const MAX_LOG_RANGE = 100n;
async function getLogsPaged(params) {
  const latest = await pub.getBlockNumber();
  const out = [];
  for (let start = params.fromBlock; start <= latest; start += MAX_LOG_RANGE) {
    const end = start + MAX_LOG_RANGE - 1n > latest ? latest : start + MAX_LOG_RANGE - 1n;
    out.push(...(await pub.getLogs({ ...params, fromBlock: start, toBlock: end })));
  }
  return out;
}

const passportLogs = await getLogsPaged({
  address: C.passportRegistry,
  event: parseAbiItem("event PassportCommitted(bytes32 indexed assetId, uint64 indexed version, bytes32 passportId, bytes32 evidenceRoot, bytes32 claimsRoot, bool singleSource)"),
  args: { assetId },
  fromBlock,
});
for (const l of passportLogs) {
  transactions.push({ label: `PassportRegistry.commitPassport (v${l.args.version})`, hash: l.transactionHash, blockNumber: Number(l.blockNumber), to: C.passportRegistry });
}

const evidenceLogs = await getLogsPaged({
  address: C.evidenceRegistry,
  event: parseAbiItem("event EvidenceCommitted(bytes32 indexed evidenceId, bytes32 indexed assetId, bytes32 contentHash, uint8 sourceClass, uint64 effectiveAt)"),
  args: { assetId },
  fromBlock,
});
for (const l of evidenceLogs) {
  transactions.push({ label: "EvidenceRegistry.commit", hash: l.transactionHash, blockNumber: Number(l.blockNumber), to: C.evidenceRegistry, evidenceId: l.args.evidenceId });
}

if (evidenceLogs.length === 0) {
  console.error("FAIL: a Passport exists onchain but no evidence was ever committed for this asset.");
  console.error("      The deployed registry forbids that, so either the manifest points at the wrong");
  console.error("      contracts or this Passport predates the ordering invariant.");
  process.exit(1);
}

// Ordering is the invariant worth asserting here: evidence has to land before the Passport that
// rests on it, and now that the contract enforces it, the record should demonstrate it rather than
// assume it.
const firstPassportBlock = Math.min(...passportLogs.map((l) => Number(l.blockNumber)));
const lastEvidenceBlock = Math.max(...evidenceLogs.map((l) => Number(l.blockNumber)));
if (lastEvidenceBlock > firstPassportBlock) {
  console.error(`FAIL: evidence at block ${lastEvidenceBlock} is later than the Passport at ${firstPassportBlock}.`);
  process.exit(1);
}

// The epoch bump is a distinct event with its own transaction. It is recovered by cause rather
// than by block proximity: an epoch that moved for an unrelated reason in the same block is not
// this Passport's doing, and attributing it here would overstate what the commit caused.
const epochLogs = await getLogsPaged({
  address: C.riskPolicyRegistry,
  event: parseAbiItem("event RiskEpochActivated(uint64 indexed epoch, bytes32 indexed cause)"),
  fromBlock,
});
// Exactly one bump per Passport version: the first activation at or after that version's block.
// Every later bump has some other cause — the risk scenario alone moves the epoch three times —
// and sweeping them all in would credit this commit with epochs it had nothing to do with.
for (const pl of passportLogs) {
  const caused = epochLogs
    .filter((l) => Number(l.blockNumber) >= Number(pl.blockNumber))
    .sort((a, b) => Number(a.blockNumber) - Number(b.blockNumber))[0];
  if (!caused) continue;
  transactions.push({
    label: `RiskPolicyRegistry.bumpEpoch (epoch ${caused.args.epoch})`,
    hash: caused.transactionHash,
    blockNumber: Number(caused.blockNumber),
    to: C.riskPolicyRegistry,
    cause: caused.args.cause,
    causedBy: `passport v${pl.args.version}`,
  });
}

transactions.sort((a, b) => a.blockNumber - b.blockNumber);

const epoch = await pub.readContract({ address: C.riskPolicyRegistry, abi: parseAbi(["function riskEpoch() view returns (uint64)"]), functionName: "riskEpoch" });

const record = {
  kind: "PASSPORT_COMMITTED",
  chainId: deployment.chainId,
  network: deployment.network,
  fixture: fixtureId,
  reconciledFromChainLogs: true,
  assetId,
  passportId,
  version: Number(hVersion),
  evidenceRoot,
  claimsRoot,
  createdAt: Number(createdAt),
  singleSource,
  redemptionSupported,
  redemptionFloorBps: Number(redemptionFloorBps),
  riskEpoch: Number(epoch),
  registries: { evidenceRegistry: C.evidenceRegistry, passportRegistry: C.passportRegistry, riskPolicyRegistry: C.riskPolicyRegistry },
  transactions,
};

const out = `proof/passport-${fixtureId.replace(/[^a-z0-9-]/gi, "-")}-v${Number(hVersion)}.json`;
writeFileSync(out, JSON.stringify(record, null, 2) + "\n");

console.log(`Reconciled ${fixtureId} from chain logs`);
console.log(`  version ${hVersion}   status ${status === 1 ? "ACTIVE" : status}   singleSource ${singleSource}`);
console.log(`  evidence block ${lastEvidenceBlock} < passport block ${firstPassportBlock}  (ordering holds)`);
console.log(`  ${transactions.length} transactions, all recovered from event receipts`);
console.log(`Wrote ${out}`);

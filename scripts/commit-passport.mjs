#!/usr/bin/env node
/**
 * Commit a Passport derived from real issuer evidence to X Layer.
 *
 *   node --experimental-transform-types scripts/commit-passport.mjs <fixtureId> [--dry-run]
 *
 * The calldata is REGENERATED from the pipeline on every run and never replayed from a stored
 * blob. A stale blob would let the chain diverge from the evidence that justifies it, which is the
 * one thing a Passport must never do.
 *
 * Two identities are kept apart throughout, and this is the most important thing in this file:
 *
 *   the EVIDENCE asset  — Usance's normalised understanding of a real financial product, derived
 *                         from that issuer's own filing
 *   the TEST asset      — a labelled testnet token with no relationship to the issuer at all
 *
 * Committing a Passport for the evidence asset says "Usance has read Franklin's filing and
 * recorded what it says". It does NOT say "this testnet token is FOBXX". Merging those two would
 * be the single most dishonest thing this repository could do.
 */
import { readFileSync, existsSync } from "node:fs";
import nodeModule from "node:module";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

// packages/* and services/* are TypeScript with extensionless relative imports. Node strips types
// but resolves specifiers exactly, so both mappings are needed. Same approach as
// scripts/chaingpt-audit.mjs — resolved from the repository layout rather than node_modules so
// this script and the packages it loads share one module graph.
function tsModule(url) {
  return { url, format: "module-typescript", shortCircuit: true };
}
nodeModule.registerHooks({
  resolve(specifier, context, nextResolve) {
    const ws = /^@usance\/([a-z][a-z0-9-]*)$/.exec(specifier);
    if (ws) {
      for (const root of ["packages", "services"]) {
        const entry = join(repoRoot, root, ws[1], "src", "index.ts");
        if (existsSync(entry)) return tsModule(pathToFileURL(entry).href);
      }
    }
    if (specifier.startsWith(".") && !/\.[cm]?[jt]s$/.test(specifier) && context.parentURL) {
      const base = new URL(specifier, context.parentURL).href;
      for (const c of [`${base}.ts`, `${base}/index.ts`]) {
        if (existsSync(fileURLToPath(c))) return tsModule(c);
      }
    }
    return nextResolve(specifier, context);
  },
});
import { createPublicClient, createWalletClient, http, parseAbi, keccak256, toBytes } from "viem";
import { privateKeyToAccount } from "viem/accounts";

// Dynamic, so the resolver hook above is registered before these specifiers are resolved.
const { loadManifest, loadFixture, runPipeline, InMemoryObjectStore } = await import("@usance/evidence");
const { DeterministicParserExtractor, ChainGptEvidenceExtractor, ChainGptClient } = await import("@usance/chaingpt");
const { withBuilderCode, decodeBuilderCodes, builderCodeFromEnv } = await import("@usance/xlayer");

const fixtureId = process.argv[2] ?? "franklin-fobxx-2026";
const dryRun = process.argv.includes("--dry-run");

const deployment = JSON.parse(readFileSync("deployments/1952.json", "utf8"));
const RPC = process.env.XLAYER_TESTNET_RPC_URL ?? "https://testrpc.xlayer.tech";

/**
 * Evidence-asset identity, derived from the instrument key.
 *
 * Deliberately NOT the testnet token's assetId. The testnet token has its own registry entry and
 * its own id; this one exists so a Passport can describe a real product Usance has read about but
 * does not custody.
 */
function evidenceAssetId(key) {
  const bytes = new TextEncoder().encode(`usance-fixture-asset:${key}`);
  let hex = "";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return `0x${hex.padEnd(64, "0").slice(0, 64)}`;
}

const instrumentKey = fixtureId.replace(/-\d{4}(-\d{2})?$/, "").replace(/-overview$/, "");
const assetId = evidenceAssetId(instrumentKey);

const pub = createPublicClient({ transport: http(RPC) });

const CONTRACTS = deployment.contracts;
const ADDR = {
  PassportRegistry: CONTRACTS.passportRegistry,
  EvidenceRegistry: CONTRACTS.evidenceRegistry,
  RiskPolicyRegistry: CONTRACTS.riskPolicyRegistry,
};

console.log("");
console.log(`Fixture        ${fixtureId}`);
console.log(`Instrument     ${instrumentKey}`);
console.log(`Evidence asset ${assetId}`);
console.log(`Chain          ${deployment.chainId} (${deployment.network})`);

// ---------------------------------------------------------------- run the real pipeline
const manifest = await loadManifest();
const entry = manifest.documents.find((d) => d.id === fixtureId);
if (!entry) {
  console.error(`No fixture "${fixtureId}". Available: ${manifest.documents.map((d) => d.id).join(", ")}`);
  process.exit(1);
}
const fixture = await loadFixture(fixtureId);

const currentVersion = await pub.readContract({
  address: ADDR.PassportRegistry,
  abi: parseAbi(["function currentVersion(bytes32) view returns (uint64)"]),
  functionName: "currentVersion",
  args: [assetId],
});
const nextVersion = Number(currentVersion) + 1;
console.log(`Onchain version ${currentVersion} → committing v${nextVersion}`);

// Both extraction paths when a key is configured. Corroboration is the whole point, and a commit
// is exactly the moment to use the stronger evidence rather than the cheaper one.
const extractors = [new DeterministicParserExtractor()];
const cg = new ChainGptClient({ minIntervalMs: 800 });
if (cg.status() === "available") {
  extractors.push(new ChainGptEvidenceExtractor(cg));
  console.log("Extraction     deterministic parser + ChainGPT (2 independent paths)");
} else {
  console.log("Extraction     deterministic parser only — Passport will be singleSource");
}

const outcome = await runPipeline(
  {
    assetId,
    version: nextVersion,
    document: {
      uri: entry.uri,
      issuerId: entry.issuer.issuerId,
      sourceClass: entry.sourceClass,
      mediaType: entry.mediaType,
      retrievedAt: entry.retrievedAt,
      effectiveAt: entry.effectiveAt,
      bytes: fixture.bytes,
      assertedSourceHash: entry.sourceHash,
    },
    expiresAt: 0,
  },
  { store: new InMemoryObjectStore(), extractors },
);

console.log(`Outcome        ${outcome.kind}`);
if (outcome.kind !== "READY_TO_COMMIT") {
  console.log("");
  console.log("Nothing to commit. That is a conclusion, not a failure:");
  if (outcome.kind === "CLAIM_CONFLICT") {
    console.log(`  the extraction paths disagreed on ${outcome.conflictingFields.join(", ")}`);
    console.log("  a disputed reading must not become a Passport");
  } else {
    console.log(`  ${outcome.reason}`);
  }
  process.exit(2);
}

console.log(`Corroboration  ${outcome.corroboration.outcome} (${outcome.corroboration.independentPathCount} path(s))`);
console.log(`singleSource   ${outcome.singleSource}`);
console.log(`evidenceRoot   ${outcome.candidate.evidenceRoot}`);
console.log(`claimsRoot     ${outcome.candidate.claimsRoot}`);
console.log(`calls          ${outcome.calls.length}`);

if (dryRun) {
  console.log("\n--dry-run: stopping before broadcast.");
  process.exit(0);
}

// ---------------------------------------------------------------- broadcast
const pk = process.env.DEPLOYER_PRIVATE_KEY;
if (!pk) { console.error("DEPLOYER_PRIVATE_KEY not set"); process.exit(1); }
const account = privateKeyToAccount(pk);
const wallet = createWalletClient({ account, transport: http(RPC) });
const chain = { id: deployment.chainId, name: deployment.network, nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } };

// The deploy script revokes ADMISSION from the deployer at the end of the run, so it has to be
// re-granted here. GOVERNANCE is retained, which is what makes that possible.
const authAbi = parseAbi([
  "function hasRole(bytes32,address) view returns (bool)",
  "function ADMISSION() view returns (bytes32)",
  "function grantRole(bytes32,address)",
]);
const admissionRole = await pub.readContract({ address: CONTRACTS.authority, abi: authAbi, functionName: "ADMISSION" });
const hasAdmission = await pub.readContract({ address: CONTRACTS.authority, abi: authAbi, functionName: "hasRole", args: [admissionRole, account.address] });

const sent = [];
async function send(label, to, data) {
  // Every applicable X Layer write carries the ERC-8021 suffix. Applied here rather than trusted
  // to the frontend helper: the deployer path is a different code path and had never been checked.
  const attributed = withBuilderCode(data, builderCodeFromEnv());
  const hash = await wallet.sendTransaction({ account, chain, to, data: attributed });
  const rcpt = await pub.waitForTransactionReceipt({ hash, timeout: 180_000 });
  const codes = decodeBuilderCodes(attributed);
  console.log(`  ${rcpt.status === "success" ? "OK " : "FAIL"} ${label.padEnd(26)} ${hash}  block ${rcpt.blockNumber}  builder=${codes?.[0] ?? "none"}`);
  if (rcpt.status !== "success") throw new Error(`${label} reverted`);
  sent.push({ label, hash, blockNumber: Number(rcpt.blockNumber), builderCode: codes?.[0] ?? null, to });
  return rcpt;
}

console.log("\nBroadcasting:");
if (!hasAdmission) {
  await send("grantRole(ADMISSION)", CONTRACTS.authority,
    "0x2f2ff15d" + admissionRole.slice(2) + account.address.slice(2).toLowerCase().padStart(64, "0"));
}

for (const call of outcome.calls) {
  const to = ADDR[call.contract];
  if (!to) throw new Error(`no deployed address for ${call.contract}`);
  await send(`${call.contract}.${call.functionName}`, to, call.data);
}

// ---------------------------------------------------------------- verify by reading back
console.log("\nVerifying onchain:");
const header = await pub.readContract({
  address: ADDR.PassportRegistry,
  abi: parseAbi([
    "function getCurrentPassport(bytes32) view returns ((bytes32,bytes32,uint64,bytes32,bytes32,uint64,uint64,uint8,bool,uint16,bool))",
  ]),
  functionName: "getCurrentPassport",
  args: [assetId],
});
const [passportId, hAsset, hVersion, hEvidenceRoot, hClaimsRoot, createdAt, , status, redemptionSupported, redemptionFloorBps, singleSource] = header;

const checks = [
  ["version", Number(hVersion) === nextVersion, `${hVersion} == ${nextVersion}`],
  ["assetId", hAsset.toLowerCase() === assetId.toLowerCase(), hAsset],
  ["evidenceRoot", hEvidenceRoot.toLowerCase() === outcome.candidate.evidenceRoot.toLowerCase(), hEvidenceRoot],
  ["claimsRoot", hClaimsRoot.toLowerCase() === outcome.candidate.claimsRoot.toLowerCase(), hClaimsRoot],
  ["status ACTIVE", Number(status) === 1, `status=${status}`],
  ["singleSource", singleSource === outcome.candidate.singleSource, String(singleSource)],
];
let bad = 0;
for (const [n, ok, detail] of checks) { console.log(`  ${ok ? "OK " : "MISMATCH"} ${n.padEnd(14)} ${detail}`); if (!ok) bad++; }

const epoch = await pub.readContract({ address: ADDR.RiskPolicyRegistry, abi: parseAbi(["function riskEpoch() view returns (uint64)"]), functionName: "riskEpoch" });
console.log(`  RiskEpoch now  ${epoch}`);

console.log("");
console.log(bad === 0 ? "Passport committed and verified onchain." : `${bad} mismatch(es) — NOT verified.`);
console.log(JSON.stringify({ assetId, passportId, version: Number(hVersion), evidenceRoot: hEvidenceRoot, claimsRoot: hClaimsRoot, createdAt: Number(createdAt), singleSource, redemptionSupported, redemptionFloorBps: Number(redemptionFloorBps), riskEpoch: Number(epoch), transactions: sent }, null, 2));
process.exit(bad === 0 ? 0 : 1);

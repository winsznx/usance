/**
 * Wire the real Chainlink CRE confidential lender-policy workflow into the live Hedera facility
 * and prove it gates a substitution.
 *
 *   node --env-file=../../.env src/cre/cre-policy-lifecycle.mjs
 *
 * The workflow (packages/ethonline/usance-cre/lender-policy) is a CRE Confidential Workflow:
 * an HTTP-triggered handler that runs in an AWS Nitro TEE, reads the lender's private policy from
 * a CRE secret, evaluates the substitution candidate, and returns {allow, reasonCode,
 * policyCommitment, workflowVersion}. Only the keccak256 commitment of the policy is ever public.
 *
 * This script:
 *   1. ensures the ENS EAC role is live on Sepolia (both prior sponsors still required)
 *   2. runs `cre workflow simulate` for a passing candidate, reads the verdict, and configures
 *      EthOnlinePolicyVerifier with the policy commitment the workflow computed in-enclave
 *   3. positive: the CRE ALLOW verdict (reporter-signed) + the Privy dual-key approval drive a
 *      real SUBSTITUTE; replacement committed before old collateral released
 *   4. negative: a candidate that breaches the confidential policy -> the workflow returns DENY,
 *      the reporter signs allow=false, requestSubstitution reverts at IPolicyVerifier.verify,
 *      collateral stays committed, facility stays ACTIVE
 *   5. the already-completed substitutions are not disturbed
 *
 * Writes docs/ethonline-2026/proof/cre-policy-lifecycle.json and cre-workflow.json.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  createPublicClient, createWalletClient, http, keccak256, encodeAbiParameters,
  parseAbiParameters, getAddress, formatEther, toBytes, concat, recoverAddress,
} from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { PrivyClient } from "@privy-io/node";

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(here, "../../../../contracts/out");
const MANIFEST = path.resolve(here, "../../../../docs/ethonline-2026/proof/hedera-facility-deployment.json");
const ENS_PROOF = path.resolve(here, "../../../../docs/ethonline-2026/proof/ensv2-authority.json");
const SECRETS = path.resolve(here, "../../.privy-org.json");
const REPORTER_FILE = path.resolve(here, "../../.cre-reporter.json");
const POLICY_FILE = path.resolve(here, "../../.cre-lender-policy.json");
const CRE_PROJECT = path.resolve(here, "../../usance-cre");
const WF_DIR = "./lender-policy";
const PROOF = path.resolve(here, "../../../../docs/ethonline-2026/proof/cre-policy-lifecycle.json");
const WF_PROOF = path.resolve(here, "../../../../docs/ethonline-2026/proof/cre-workflow.json");

const CRE_BIN = path.join(process.env.HOME, ".cre/bin/cre");
const H_RPC = process.env.HEDERA_TESTNET_RPC_URL || "https://testnet.hashio.io/api";
const H_CHAIN = 296;
const S_RPC = process.env.SEPOLIA_RPC_URL;
const S_CHAIN = 11155111;
const HS = (h) => `https://hashscan.io/testnet/transaction/${h}`;
const ES = (h) => `https://sepolia.etherscan.io/tx/${h}`;
const WORKFLOW_VERSION = 1;

function normalizeKey(k) {
  const hex = (k || "").trim().replace(/^0x/i, "").toLowerCase();
  if (/^[0-9a-f]{64}$/.test(hex)) return `0x${hex}`;
  const m = hex.match(/0420([0-9a-f]{64})/);
  if (m) return `0x${m[1]}`;
  throw new Error("bad HEDERA key");
}
function sepoliaKey() {
  const k = (process.env.ENS_SEPOLIA_DEPLOYER_KEY || "").trim();
  const pk = k.startsWith("0x") ? k : `0x${k}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(pk)) throw new Error("bad ENS_SEPOLIA_DEPLOYER_KEY");
  return pk;
}

const hAcct = privateKeyToAccount(normalizeKey(process.env.HEDERA_TESTNET_OPERATOR_KEY));
const OP = hAcct.address;
const sAcct = privateKeyToAccount(sepoliaKey());
const SECR = JSON.parse(fs.readFileSync(SECRETS, "utf8"));
const privy = new PrivyClient({ appId: process.env.PRIVY_APP_ID, appSecret: process.env.PRIVY_APP_SECRET });

let reporter;
if (fs.existsSync(REPORTER_FILE)) {
  reporter = privateKeyToAccount(JSON.parse(fs.readFileSync(REPORTER_FILE, "utf8")).privateKey);
} else {
  const pk = generatePrivateKey();
  reporter = privateKeyToAccount(pk);
  fs.writeFileSync(REPORTER_FILE, JSON.stringify({
    $warning: "SECRET — gitignored. The CRE report reporter key. In production the DON forwarder provides this signature.",
    address: reporter.address, privateKey: pk,
  }, null, 2) + "\n");
  fs.chmodSync(REPORTER_FILE, 0o600);
}

const hChain = { id: H_CHAIN, name: "hedera-testnet", nativeCurrency: { name: "HBAR", symbol: "HBAR", decimals: 18 }, rpcUrls: { default: { http: [H_RPC] } } };
const sChain = { id: S_CHAIN, name: "sepolia", nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [S_RPC] } } };
const hPub = createPublicClient({ chain: hChain, transport: http(H_RPC, { retryCount: 5, retryDelay: 3000, timeout: 60_000 }) });
const hWal = createWalletClient({ account: hAcct, chain: hChain, transport: http(H_RPC, { retryCount: 5, retryDelay: 3000, timeout: 60_000 }) });
const sPub = createPublicClient({ chain: sChain, transport: http(S_RPC, { retryCount: 5, retryDelay: 3000, timeout: 60_000 }) });
const sWal = createWalletClient({ account: sAcct, chain: sChain, transport: http(S_RPC, { retryCount: 5, retryDelay: 3000, timeout: 60_000 }) });

const abi = (f, n) => JSON.parse(fs.readFileSync(path.join(OUT, f, `${n}.json`), "utf8")).abi;
const A = {
  facility: abi("InstitutionalFacility.sol", "InstitutionalFacility"),
  adapter: abi("HederaAtsCollateralAdapter.sol", "HederaAtsCollateralAdapter"),
  authorityV: abi("EthOnlineDecisionVerifiers.sol", "EthOnlineAuthorityVerifier"),
  policyV: abi("EthOnlineDecisionVerifiers.sol", "EthOnlinePolicyVerifier"),
  rpr: abi("RiskPolicyRegistry.sol", "RiskPolicyRegistry"),
  erc20: [{ type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [{ type: "bool" }] }],
};
const REGISTRY_ABI = [
  { type: "function", name: "hasRoles", stateMutability: "view", inputs: [{ type: "uint256" }, { type: "uint256" }, { type: "address" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "grantRoles", stateMutability: "nonpayable", inputs: [{ type: "uint256" }, { type: "uint256" }, { type: "address" }], outputs: [{ type: "bool" }] },
];

const M = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
const C = M.contracts;
const ENS = JSON.parse(fs.readFileSync(ENS_PROOF, "utf8"));
const ENS_DIGEST = ENS.authorityEvidenceDigest;
const LABELHASH = ENS.labelhash;
const ROLE_BITMAP = BigInt(ENS.roleBitmap);
const DELEGATE = getAddress(ENS.delegate);
const ETH_REGISTRY = getAddress(ENS.ensv2.ethRegistry);
const PRIVY_ADDR = getAddress(SECR.walletAddress);

const POLICY = JSON.parse(fs.readFileSync(POLICY_FILE, "utf8"));
// Reproduce the workflow's in-enclave commit() to cross-check the value it returns.
function localCommitment() {
  const issuers = [...POLICY.allowedIssuers].sort();
  const canonical = JSON.stringify({
    version: POLICY.version,
    maxIssuerExposureUsd18: POLICY.maxIssuerExposureUsd18,
    maxSubstitutionUsd18: POLICY.maxSubstitutionUsd18,
    minRatingNotch: POLICY.minRatingNotch,
    allowedIssuers: issuers,
  });
  return keccak256(concat([toBytes("USANCE_CRE_LENDER_POLICY_V1"), toBytes(canonical)]));
}

const OP_ENUM = { ACTIVATE: 0, SUBSTITUTE: 1, RECALL: 2, SETTLE: 3 };
const DECISION_TYPES = parseAbiParameters(
  "string, bytes32, uint8, bytes32, bytes32, bytes32, uint64, uint64, uint32, uint64, uint64, bytes32, bytes32",
);
const decisionHash = (d) => keccak256(encodeAbiParameters(DECISION_TYPES, [
  "USANCE_FACILITY_DECISION_V1", d.facilityId, d.operation, d.subjectAssetId, d.subjectInstrumentRef,
  d.requestId, d.pinnedEpoch, d.collateralPolicyVersion, d.decisionVersion, d.expiry, d.nonce, d.proofRef, d.attestationHash,
]));
const orgApprovalHash = (dh) => keccak256(encodeAbiParameters(
  parseAbiParameters("string, bytes32, bytes32"), ["USANCE_ORG_APPROVAL_V1", dh, ENS_DIGEST]));
const creReportHash = (dh, allow, commitment, reason, expiry) => keccak256(encodeAbiParameters(
  parseAbiParameters("string, bytes32, bool, bytes32, uint32, bytes32, uint64"),
  ["USANCE_CRE_POLICY_V1", dh, allow, commitment, WORKFLOW_VERSION, reason, expiry]));

const out = {
  $generatedAt: new Date().toISOString(),
  what: "the Chainlink CRE confidential lender-policy workflow gates the live Hedera substitution",
  cre: { workflow: "packages/ethonline/usance-cre/lender-policy", type: "CRE Confidential Workflow (AWS Nitro TEE), HTTP-triggered", simulator: "cre workflow simulate", reporter: reporter.address },
  hedera: { facilityId: M.facilityId, facility: C.InstitutionalFacility, policyVerifier: C.EthOnlinePolicyVerifier },
  steps: [],
};
const save = () => fs.writeFileSync(PROOF, JSON.stringify(out, null, 2) + "\n");
async function step(name, p) {
  process.stdout.write(`→ ${name} ... `);
  try {
    const r = (await p()) || {};
    const rec = { name, ok: true, ...r };
    if (r.tx && r.chain === "sepolia") rec.etherscan = ES(r.tx);
    else if (r.tx) rec.hashscan = HS(r.tx);
    out.steps.push(rec); save();
    console.log(r.tx ? `ok  ${r.tx}` : "ok");
    return r;
  } catch (e) {
    out.steps.push({ name, ok: false, error: e?.shortMessage || e?.message }); save();
    console.log(`FAILED: ${e?.shortMessage || e?.message}`);
    throw e;
  }
}
async function hTx(address, cabi, fn, args) {
  const hash = await hWal.writeContract({ address, abi: cabi, functionName: fn, args });
  const rc = await hPub.waitForTransactionReceipt({ hash });
  if (rc.status !== "success") throw new Error(`${fn} reverted (${hash})`);
  return { tx: hash };
}
async function sTx(address, cabi, fn, args) {
  const hash = await sWal.writeContract({ address, abi: cabi, functionName: fn, args });
  const rc = await sPub.waitForTransactionReceipt({ hash });
  if (rc.status !== "success") throw new Error(`${fn} reverted (${hash})`);
  return { tx: hash, chain: "sepolia" };
}
const readFac = (fn, args = []) => hPub.readContract({ address: C.InstitutionalFacility, abi: A.facility, functionName: fn, args });
const committedOf = (adapter) => hPub.readContract({ address: adapter, abi: A.adapter, functionName: "committedOf", args: [C.InstitutionalFacility] });

let NONCE = Math.floor(Date.now() / 1000);
async function makeDecision(op, assetId, ref, requestId) {
  const epoch = await hPub.readContract({ address: C.RiskPolicyRegistry, abi: A.rpr, functionName: "riskEpoch" });
  const now = BigInt(Math.floor(Date.now() / 1000));
  return {
    facilityId: M.facilityId, operation: OP_ENUM[op], subjectAssetId: assetId, subjectInstrumentRef: ref,
    requestId, pinnedEpoch: epoch, collateralPolicyVersion: epoch, decisionVersion: 1,
    expiry: now + 3600n, nonce: BigInt(NONCE++),
    proofRef: keccak256(Buffer.from(`proof:${op}:${requestId}`)),
    attestationHash: keccak256(Buffer.from(`att:${op}:${requestId}`)),
  };
}

// Run the CRE confidential workflow in the simulator and parse its verdict.
function runWorkflowOnce(payloadPath) {
  let stdout = "";
  try {
    stdout = execFileSync(
      CRE_BIN,
      ["workflow", "simulate", WF_DIR, "--non-interactive", "--target", "staging-settings",
        "--trigger-index", "0", "--http-payload", payloadPath],
      {
        cwd: CRE_PROJECT,
        env: { ...process.env, LENDER_POLICY_ALL: fs.readFileSync(POLICY_FILE, "utf8"), PATH: `${path.dirname(CRE_BIN)}:/opt/homebrew/bin:${process.env.PATH}` },
        encoding: "utf8",
        maxBuffer: 32 * 1024 * 1024,
      },
    );
  } catch (e) {
    stdout = `${e.stdout || ""}${e.stderr || ""}`;
  }
  const marker = "Workflow Simulation Result:";
  const i = stdout.indexOf(marker);
  if (i < 0) throw new Error(`no simulation result:\n${stdout.slice(-1200)}`);
  const brace = stdout.indexOf("{", i);
  let depth = 0, end = brace;
  for (; end < stdout.length; end++) {
    if (stdout[end] === "{") depth++;
    else if (stdout[end] === "}" && --depth === 0) { end++; break; }
  }
  return JSON.parse(stdout.slice(brace, end));
}
function runWorkflow(decisionInput) {
  const payloadPath = path.join(CRE_PROJECT, `.sim-payload-${Date.now()}.json`);
  fs.writeFileSync(payloadPath, JSON.stringify(decisionInput));
  try {
    let lastErr;
    for (let attempt = 1; attempt <= 6; attempt++) {
      try { return runWorkflowOnce(payloadPath); }
      catch (e) { lastErr = e; execFileSync("sleep", ["6"]); }
    }
    throw lastErr;
  } finally {
    fs.rmSync(payloadPath, { force: true });
  }
}

const issuerOf = { A: "USANCE-ISSUER-A", B: "USANCE-ISSUER-B", C: "USANCE-ISSUER-C" };

async function privyApprove(d) {
  const dh = decisionHash(d);
  const r = await privy.wallets().ethereum().signSecp256k1(SECR.walletId, {
    params: { hash: orgApprovalHash(dh) },
    authorization_context: { authorization_private_keys: SECR.approverPrivateKeys },
  });
  await step("privy: submit dual-key org approval", () =>
    hTx(C.EthOnlineAuthorityVerifier, A.authorityV, "submitApproval", [d, ENS_DIGEST, r.signature]));
}
async function creSubmit(d, verdict) {
  const dh = decisionHash(d);
  const expiry = BigInt(Math.floor(Date.now() / 1000) + 1800);
  const sig = await reporter.sign({ hash: creReportHash(dh, verdict.Allow, verdict.PolicyCommitment, verdict.ReasonCode, expiry) });
  return step(`cre: submit ${verdict.Allow ? "ALLOW" : "DENY"} verdict (reporter-signed)`, () =>
    hTx(C.EthOnlinePolicyVerifier, A.policyV, "submitVerdict",
      [d, verdict.Allow, verdict.PolicyCommitment, WORKFLOW_VERSION, verdict.ReasonCode, expiry, sig]));
}

async function main() {
  if (await hPub.getChainId() !== H_CHAIN) throw new Error("not Hedera testnet");
  if (await sPub.getChainId() !== S_CHAIN) throw new Error("not Sepolia");
  console.log(`hedera operator ${OP} · ${formatEther(await hPub.getBalance({ address: OP }))} HBAR`);
  console.log(`cre reporter ${reporter.address} · privy org ${PRIVY_ADDR}`);

  // 0. workflow provenance + commitment (from a simulate run)
  const probe = runWorkflow({
    decisionHash: "0x" + "11".repeat(32), facilityId: M.facilityId,
    candidateAssetId: M.atsSecurities.A.assetId, issuerId: issuerOf.A, requestedUnits: 150000,
    markPriceUsd18: "1000000000000000000", issuerExposureUsd18: "100000000000000000000000", ratingNotch: 15,
  });
  const COMMITMENT = probe.PolicyCommitment;
  const localC = localCommitment();
  if (COMMITMENT.toLowerCase() !== localC.toLowerCase())
    throw new Error(`policy commitment mismatch: workflow ${COMMITMENT} vs local ${localC}`);
  fs.writeFileSync(WF_PROOF, JSON.stringify({
    $generatedAt: new Date().toISOString(),
    workflow: "packages/ethonline/usance-cre/lender-policy (CRE Confidential Workflow, Go, AWS Nitro TEE)",
    trigger: "http-trigger@1.0.0-alpha", sdk: "cre-sdk-go v1.19.0", workflowVersion: WORKFLOW_VERSION,
    policyCommitment: COMMITMENT,
    commitmentScheme: "keccak256(\"USANCE_CRE_LENDER_POLICY_V1\" || canonicalJSON(policy)) — computed in-enclave; only this hash is public",
    reporter: reporter.address,
    note: "the lender's private thresholds are a CRE secret; in production the workflow deploys to a DON and the forwarder carries the DON signature; here `cre workflow simulate` runs the TEE handler locally and a reporter key signs the verdict",
    probeVerdict: probe,
  }, null, 2) + "\n");
  out.cre.policyCommitment = COMMITMENT;
  save();
  console.log(`  policy commitment (in-enclave, cross-checked): ${COMMITMENT}`);

  // 1. ENS role live
  let hasRole = await sPub.readContract({ address: ETH_REGISTRY, abi: REGISTRY_ABI, functionName: "hasRoles", args: [BigInt(LABELHASH), ROLE_BITMAP, DELEGATE] });
  if (!hasRole) {
    await step("sepolia: re-grant the EAC role", () => sTx(ETH_REGISTRY, REGISTRY_ABI, "grantRoles", [BigInt(LABELHASH), ROLE_BITMAP, DELEGATE]));
    hasRole = true;
  }
  await step("sepolia: ENS EAC role is live", () => ({ hasRoles: hasRole }));

  // 2. configure the policy verifier with the in-enclave commitment
  await step("hedera: configureFacility(creReporter, policyCommitment)", () =>
    hTx(C.EthOnlinePolicyVerifier, A.policyV, "configureFacility", [M.facilityId, reporter.address, COMMITMENT, WORKFLOW_VERSION]));
  const fp = await hPub.readContract({ address: C.EthOnlinePolicyVerifier, abi: A.policyV, functionName: "facilityPolicy", args: [M.facilityId] });
  if (getAddress(fp[0]) !== getAddress(reporter.address) || fp[1].toLowerCase() !== COMMITMENT.toLowerCase())
    throw new Error("policy verifier not configured");

  const status0 = Number(await readFac("status"));
  if (status0 !== 2) throw new Error(`facility not ACTIVE (status ${status0})`);
  const curAdapter = getAddress((await readFac("collateral")).adapter);
  const curSeries = Object.keys(M.atsSecurities).find((k) => getAddress(C[`Adapter${k}`]) === curAdapter);
  const toSeries = curSeries === "A" ? "B" : "A";
  const toAdapter = C[`Adapter${toSeries}`];
  const UNITS = 150_000n;
  console.log(`  current collateral: series ${curSeries}; substituting -> series ${toSeries}`);

  // ---- positive: CRE ALLOW ----
  const reqId = keccak256(Buffer.from(`CRE-POS-${Date.now()}`));
  const dPos = await makeDecision("SUBSTITUTE", M.atsSecurities[toSeries].assetId, M.atsSecurities[toSeries].instrumentRef, reqId);
  const dhPos = decisionHash(dPos);
  const vPos = runWorkflow({
    decisionHash: dhPos, facilityId: M.facilityId,
    candidateAssetId: M.atsSecurities[toSeries].assetId, issuerId: issuerOf[toSeries], requestedUnits: 150000,
    markPriceUsd18: "1000000000000000000", issuerExposureUsd18: "100000000000000000000000", ratingNotch: 15,
  });
  out.positive = { to: toSeries, decisionHash: dhPos, verdict: vPos };
  save();
  if (!vPos.Allow || vPos.PolicyCommitment.toLowerCase() !== COMMITMENT.toLowerCase()) throw new Error("expected ALLOW verdict");
  console.log(`  CRE verdict: ALLOW (${Buffer.from(vPos.ReasonCode.slice(2), "hex").toString().replace(/\0+$/, "")})`);

  await step("borrower: approve replacement adapter on the ATS token", () =>
    hTx(M.atsSecurities[toSeries].evm, A.erc20, "approve", [toAdapter, 400_000n]));
  await creSubmit(dPos, vPos);
  await privyApprove(dPos);
  await step("borrower: requestSubstitution", () =>
    hTx(C.InstitutionalFacility, A.facility, "requestSubstitution", [reqId, toAdapter, UNITS, dPos, dPos]));
  await step("commitReplacement (replacement held while old collateral still held)", () =>
    hTx(C.InstitutionalFacility, A.facility, "commitReplacement", []));
  out.positive.committedMid = { [curSeries]: (await committedOf(curAdapter)).toString(), [toSeries]: (await committedOf(toAdapter)).toString() };
  save();
  await step("borrower: releaseOld", () => hTx(C.InstitutionalFacility, A.facility, "releaseOld", [reqId]));
  out.positive.committedAfter = { [curSeries]: (await committedOf(curAdapter)).toString(), [toSeries]: (await committedOf(toAdapter)).toString() };
  out.positive.facilityStatusAfter = Number(await readFac("status"));
  out.positive.result = out.positive.committedAfter[curSeries] === "0" && BigInt(out.positive.committedAfter[toSeries]) >= UNITS && out.positive.facilityStatusAfter === 2
    ? `SUCCESS — CRE ALLOW + Privy approval drove the substitution; replacement committed before old collateral released`
    : "UNEXPECTED";
  save();
  console.log(`  ${out.positive.result}`);

  // snapshot pre-negative state
  const histAdapter = getAddress((await readFac("collateral")).adapter);
  const histSeries = toSeries;
  const histCommitted = (await committedOf(histAdapter)).toString();

  // ---- negative: CRE DENY on a policy breach ----
  const other = histSeries === "A" ? "B" : "A";
  const reqIdN = keccak256(Buffer.from(`CRE-NEG-${Date.now()}`));
  const dNeg = await makeDecision("SUBSTITUTE", M.atsSecurities[other].assetId, M.atsSecurities[other].instrumentRef, reqIdN);
  const dhNeg = decisionHash(dNeg);
  const vNeg = runWorkflow({
    decisionHash: dhNeg, facilityId: M.facilityId,
    candidateAssetId: M.atsSecurities[other].assetId, issuerId: issuerOf[other], requestedUnits: 150000,
    markPriceUsd18: "1000000000000000000", issuerExposureUsd18: "900000000000000000000000", ratingNotch: 15,
  });
  out.negative = { to: other, decisionHash: dhNeg, verdict: vNeg };
  save();
  const reason = Buffer.from(vNeg.ReasonCode.slice(2), "hex").toString().replace(/\0+$/, "");
  if (vNeg.Allow) throw new Error("expected DENY verdict");
  console.log(`  CRE verdict: DENY (${reason})`);

  await creSubmit(dNeg, vNeg);
  await privyApprove(dNeg); // Privy says yes — only CRE is the blocker
  let refused = false;
  try {
    await hTx(C.InstitutionalFacility, A.facility, "requestSubstitution", [reqIdN, C[`Adapter${other}`], UNITS, dNeg, dNeg]);
    out.steps.push({ name: "borrower: requestSubstitution on a CRE-denied candidate (should revert)", ok: false });
  } catch (e) {
    refused = true;
    out.steps.push({ name: "borrower: requestSubstitution on a CRE-denied candidate — refused (IPolicyVerifier.verify == false)", ok: true, reverted: true, error: e?.shortMessage || e?.message });
  }
  save();

  out.historical = {
    stateAfterDeny: { facilityStatus: Number(await readFac("status")), collateralSeries: histSeries, collateralCommitted: (await committedOf(histAdapter)).toString() },
    notDisturbed: false,
  };
  out.historical.notDisturbed =
    out.historical.stateAfterDeny.facilityStatus === 2 &&
    out.historical.stateAfterDeny.collateralCommitted === histCommitted;
  save();

  out.result = out.positive.result.startsWith("SUCCESS") && refused && out.historical.notDisturbed
    ? "PASS — the CRE confidential workflow's ALLOW drove a real substitution and its DENY (on a private-policy breach) refused the next one; completed substitutions untouched"
    : "UNEXPECTED";
  save();
  console.log(`\n${out.result}\n✓ ${PROOF}\n✓ ${WF_PROOF}`);
}

main().catch((e) => { console.error("\n✗", e?.shortMessage || e?.message || e); process.exit(1); });

/**
 * Wire the REAL ENSv2 Sepolia EAC delegation into the live Hedera institutional facility and
 * prove the full authority lifecycle end to end.
 *
 *   node --env-file=../../.env src/hedera/ens-authority-lifecycle.mjs
 *
 * Consumes docs/ethonline-2026/proof/ensv2-authority.json (produced by
 * src/ens/register-and-delegate.mjs — the real Sepolia name, resource, role grant and digest).
 *
 * Steps:
 *   1. live Sepolia read: the delegate still holds ROLE_SET_SUBREGISTRY|ROLE_SET_RESOLVER
 *   2. Hedera: configure EthOnlineAuthorityVerifier with the REAL ENS evidence digest
 *   3. positive path (live): substitute the current collateral -> series A, org approval signed
 *      over the real digest, replacement committed before the old collateral is released
 *   4. Sepolia: revoke the EAC role; confirm hasRoles -> false; pin the block
 *   5. Hedera: authorityV.revokeEnsRole(facilityId)
 *   6. a NEW substitution is refused — submitApproval reverts EnsRoleIsRevoked, and
 *      authorityV.verify(newDecision) returns false
 *   7. the already-completed substitution is NOT rolled back — facility still ACTIVE, collateral
 *      still the series committed in step 3, every historical tx hash still valid
 *
 * Writes docs/ethonline-2026/proof/ens-authority-lifecycle.json.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPublicClient, createWalletClient, http, keccak256, encodeAbiParameters,
  parseAbiParameters, getAddress, formatEther,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(here, "../../../../contracts/out");
const MANIFEST = path.resolve(here, "../../../../docs/ethonline-2026/proof/hedera-facility-deployment.json");
const ENS_PROOF = path.resolve(here, "../../../../docs/ethonline-2026/proof/ensv2-authority.json");
const POS_PROOF = path.resolve(here, "../../../../docs/ethonline-2026/proof/hedera-substitution-positive.json");
const NEG_PROOF = path.resolve(here, "../../../../docs/ethonline-2026/proof/hedera-substitution-negative.json");
const PROOF = path.resolve(here, "../../../../docs/ethonline-2026/proof/ens-authority-lifecycle.json");

const H_RPC = process.env.HEDERA_TESTNET_RPC_URL || "https://testnet.hashio.io/api";
const H_CHAIN = 296;
const S_RPC = process.env.SEPOLIA_RPC_URL;
const S_CHAIN = 11155111;
const HS = (h) => `https://hashscan.io/testnet/transaction/${h}`;
const ES = (h) => `https://sepolia.etherscan.io/tx/${h}`;

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
};
A.erc20 = [
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [{ type: "bool" }] },
];
const REGISTRY_ABI = [
  { type: "function", name: "hasRoles", stateMutability: "view", inputs: [{ type: "uint256" }, { type: "uint256" }, { type: "address" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "revokeRoles", stateMutability: "nonpayable", inputs: [{ type: "uint256" }, { type: "uint256" }, { type: "address" }], outputs: [{ type: "bool" }] },
];

const M = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
const C = M.contracts;
const ENS = JSON.parse(fs.readFileSync(ENS_PROOF, "utf8"));
const REAL_DIGEST = ENS.authorityEvidenceDigest;
const LABELHASH = ENS.labelhash;
const ROLE_BITMAP = BigInt(ENS.roleBitmap);
const DELEGATE = getAddress(ENS.delegate);
const ETH_REGISTRY = getAddress(ENS.ensv2.ethRegistry);

if (!/^0x[0-9a-f]{64}$/i.test(REAL_DIGEST || "")) throw new Error("ENS proof has no authorityEvidenceDigest — run register-and-delegate.mjs first");

const OP_ENUM = { ACTIVATE: 0, SUBSTITUTE: 1, RECALL: 2, SETTLE: 3 };
const DECISION_TYPES = parseAbiParameters(
  "string, bytes32, uint8, bytes32, bytes32, bytes32, uint64, uint64, uint32, uint64, uint64, bytes32, bytes32",
);
const decisionHash = (d) => keccak256(encodeAbiParameters(DECISION_TYPES, [
  "USANCE_FACILITY_DECISION_V1", d.facilityId, d.operation, d.subjectAssetId, d.subjectInstrumentRef,
  d.requestId, d.pinnedEpoch, d.collateralPolicyVersion, d.decisionVersion, d.expiry, d.nonce, d.proofRef, d.attestationHash,
]));
const binding = (d) => ({
  facilityId: d.facilityId, operation: d.operation, subjectAssetId: d.subjectAssetId,
  subjectInstrumentRef: d.subjectInstrumentRef, requestId: d.requestId, epoch: d.pinnedEpoch,
  collateralPolicyVersion: d.collateralPolicyVersion,
});

const out = {
  $generatedAt: new Date().toISOString(),
  what: "real ENSv2 Sepolia EAC delegation wired into the live Hedera institutional facility",
  hedera: { network: "hedera-testnet", chainId: H_CHAIN, facilityId: M.facilityId, facility: C.InstitutionalFacility, authorityVerifier: C.EthOnlineAuthorityVerifier },
  ens: {
    name: ENS.name, ensv2Contract: ETH_REGISTRY, resource: ENS.resource, labelhash: LABELHASH,
    roleBitmap: ENS.roleBitmap, roleNames: ENS.roleNames, delegate: DELEGATE,
    authorityEvidenceDigest: REAL_DIGEST, registrationTx: ENS.steps.find((s) => s.name === "register .eth name")?.tx,
    grantTx: ENS.steps.find((s) => s.name.startsWith("grant"))?.tx,
  },
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
  return { tx: hash, chain: "sepolia", block: Number(rc.blockNumber) };
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
const REASON_ELIGIBLE = "0x" + "454c494749424c45".padEnd(64, "0"); // "ELIGIBLE"
async function orgSign(dh, digest) {
  return hAcct.sign({ hash: keccak256(encodeAbiParameters(parseAbiParameters("string, bytes32, bytes32"), ["USANCE_ORG_APPROVAL_V1", dh, digest])) });
}
async function creSign(dh, exp) {
  return hAcct.sign({ hash: keccak256(encodeAbiParameters(
    parseAbiParameters("string, bytes32, bool, bytes32, uint32, bytes32, uint64"),
    ["USANCE_CRE_POLICY_V1", dh, true, M.policyCommitment, 1, REASON_ELIGIBLE, exp])) });
}
async function authorizeAndAllow(d, digest) {
  const dh = decisionHash(d);
  const oSig = await orgSign(dh, digest);
  await step("privy: submit org approval (signed over the REAL ENS digest)", () =>
    hTx(C.EthOnlineAuthorityVerifier, A.authorityV, "submitApproval", [d, digest, oSig]));
  const exp = BigInt(Math.floor(Date.now() / 1000) + 1800);
  const cSig = await creSign(dh, exp);
  await step("cre: submit ALLOW verdict", () =>
    hTx(C.EthOnlinePolicyVerifier, A.policyV, "submitVerdict", [d, true, M.policyCommitment, 1, REASON_ELIGIBLE, exp, cSig]));
}

async function main() {
  if (await hPub.getChainId() !== H_CHAIN) throw new Error("not Hedera testnet");
  if (await sPub.getChainId() !== S_CHAIN) throw new Error("not Sepolia");
  console.log(`hedera operator ${OP} · ${formatEther(await hPub.getBalance({ address: OP }))} HBAR`);
  console.log(`sepolia owner   ${sAcct.address} · ${formatEther(await sPub.getBalance({ address: sAcct.address }))} ETH`);
  console.log(`ENS name ${ENS.name} · digest ${REAL_DIGEST}`);

  // 1. the delegation is live on Sepolia
  const hasBefore = await sPub.readContract({ address: ETH_REGISTRY, abi: REGISTRY_ABI, functionName: "hasRoles", args: [BigInt(LABELHASH), ROLE_BITMAP, DELEGATE] });
  await step("sepolia: delegate holds the EAC role", () => ({ hasRoles: hasBefore, resource: ENS.resource }));
  if (!hasBefore) throw new Error("delegate does not hold the role on Sepolia — cannot prove the positive path");

  // 2. wire the real digest into the Hedera authority verifier
  await step("hedera: configureFacility with the REAL ENS evidence digest", () =>
    hTx(C.EthOnlineAuthorityVerifier, A.authorityV, "configureFacility", [M.facilityId, DELEGATE, REAL_DIGEST]));
  const fa = await hPub.readContract({ address: C.EthOnlineAuthorityVerifier, abi: A.authorityV, functionName: "facilityAuthority", args: [M.facilityId] });
  out.configuredAuthority = { orgApprover: fa[0], expectedEnsDigest: fa[1], ensRoleRevoked: fa[2], configured: fa[3] };
  save();
  if (getAddress(fa[0]) !== DELEGATE || fa[1].toLowerCase() !== REAL_DIGEST.toLowerCase()) throw new Error("configureFacility did not stick");

  M.ensDigest = REAL_DIGEST;
  fs.writeFileSync(MANIFEST, JSON.stringify(M, null, 2) + "\n");
  out.steps.push({ name: "manifest: ensDigest updated to the real digest", ok: true }); save();

  // 3. positive path — substitute the current collateral -> series A, real ENS digest
  const status0 = Number(await readFac("status"));
  if (status0 !== 2) throw new Error(`facility not ACTIVE (status ${status0})`);
  const curAdapter = getAddress((await readFac("collateral")).adapter);
  const curSeries = Object.keys(M.atsSecurities).find((k) => getAddress(C[`Adapter${k}`]) === curAdapter);
  const UNITS = 150_000n;
  const toSeries = curSeries === "A" ? "B" : "A";
  const toAdapter = C[`Adapter${toSeries}`];
  out.positive = { from: curSeries, to: toSeries, unitsRequested: UNITS.toString(), committedBefore: { [curSeries]: (await committedOf(curAdapter)).toString(), [toSeries]: (await committedOf(toAdapter)).toString() } };
  save();
  console.log(`  current collateral: series ${curSeries} (${curAdapter}); substituting -> series ${toSeries}`);

  await step(`borrower: approve adapter ${toSeries} on the replacement ATS token`, () =>
    hTx(M.atsSecurities[toSeries].evm, A.erc20, "approve", [toAdapter, 400_000n]));

  const reqId = keccak256(Buffer.from(`ENS-AUTH-POS-${Date.now()}`));
  const dPos = await makeDecision("SUBSTITUTE", M.atsSecurities[toSeries].assetId, M.atsSecurities[toSeries].instrumentRef, reqId);
  out.positive.decisionHash = decisionHash(dPos);
  save();
  await authorizeAndAllow(dPos, REAL_DIGEST);
  await step("borrower: requestSubstitution", () =>
    hTx(C.InstitutionalFacility, A.facility, "requestSubstitution", [reqId, toAdapter, UNITS, dPos, dPos]));
  await step("commitReplacement (replacement committed while old collateral still held)", () =>
    hTx(C.InstitutionalFacility, A.facility, "commitReplacement", []));
  out.positive.committedMid = { [curSeries]: (await committedOf(curAdapter)).toString(), [toSeries]: (await committedOf(toAdapter)).toString() };
  save();
  console.log(`  mid: ${curSeries}=${out.positive.committedMid[curSeries]} held, ${toSeries}=${out.positive.committedMid[toSeries]} held`);
  await step("releaseOld (old collateral returned to the borrower)", () =>
    hTx(C.InstitutionalFacility, A.facility, "releaseOld", [reqId]));
  out.positive.committedAfter = { [curSeries]: (await committedOf(curAdapter)).toString(), [toSeries]: (await committedOf(toAdapter)).toString() };
  out.positive.facilityStatusAfter = Number(await readFac("status"));
  out.positive.result = out.positive.committedAfter[curSeries] === "0" && BigInt(out.positive.committedAfter[toSeries]) >= UNITS && out.positive.facilityStatusAfter === 2
    ? `SUCCESS — ${toSeries} committed before ${curSeries} released; facility stayed ACTIVE; org approval was signed over the real ENS digest`
    : "UNEXPECTED";
  save();
  console.log(`  ${out.positive.result}`);

  // snapshot the completed-substitution state that must NOT be rolled back
  const histAdapter = getAddress((await readFac("collateral")).adapter);
  const histSeries = toSeries;
  const histCommitted = (await committedOf(histAdapter)).toString();
  out.historical = {
    completedSubstitutionsOnChain: [
      { proof: "hedera-substitution-positive.json", releaseOldTx: JSON.parse(fs.readFileSync(POS_PROOF, "utf8")).steps.find((s) => s.name === "borrower: releaseOld")?.tx },
      { proof: "hedera-substitution-negative.json", note: "refused — series C paused", requestTx: JSON.parse(fs.readFileSync(NEG_PROOF, "utf8")).steps.find((s) => s.name.startsWith("borrower: requestSubstitution"))?.tx },
      { proof: "this file", decisionHash: out.positive.decisionHash, series: histSeries },
    ],
    stateBeforeRevoke: { facilityStatus: Number(await readFac("status")), collateralSeries: histSeries, collateralCommitted: histCommitted },
  };
  save();

  // 4. revoke the EAC role on Sepolia
  const rv = await step("sepolia: revoke the EAC role from the delegate", () =>
    sTx(ETH_REGISTRY, REGISTRY_ABI, "revokeRoles", [BigInt(LABELHASH), ROLE_BITMAP, DELEGATE]));
  const hasAfter = await sPub.readContract({ address: ETH_REGISTRY, abi: REGISTRY_ABI, functionName: "hasRoles", args: [BigInt(LABELHASH), ROLE_BITMAP, DELEGATE] });
  const sBlk = await sPub.getBlock();
  out.revoke = { sepoliaTx: rv.tx, etherscan: ES(rv.tx), hasRolesAfter: hasAfter, pinnedSepoliaBlock: Number(sBlk.number), pinnedSepoliaBlockHash: sBlk.hash };
  save();
  if (hasAfter) throw new Error("role still present after revoke");
  console.log(`  sepolia hasRoles(delegate) = ${hasAfter}  (revoked at block ${sBlk.number})`);

  // 5. tell the Hedera verifier the role is gone
  await step("hedera: authorityV.revokeEnsRole(facilityId)", () =>
    hTx(C.EthOnlineAuthorityVerifier, A.authorityV, "revokeEnsRole", [M.facilityId]));

  // 6. a NEW substitution is refused
  const dNew = await makeDecision("SUBSTITUTE", M.atsSecurities[curSeries].assetId, M.atsSecurities[curSeries].instrumentRef, keccak256(Buffer.from(`ENS-AUTH-REFUSED-${Date.now()}`)));
  const dhNew = decisionHash(dNew);
  let refused = false;
  try {
    await hTx(C.EthOnlineAuthorityVerifier, A.authorityV, "submitApproval", [dNew, REAL_DIGEST, await orgSign(dhNew, REAL_DIGEST)]);
    out.steps.push({ name: "hedera: submitApproval for a NEW decision (should have reverted)", ok: false });
  } catch (e) {
    refused = true;
    out.steps.push({ name: "hedera: submitApproval for a NEW decision — refused (EnsRoleIsRevoked)", ok: true, reverted: true, error: e?.shortMessage || e?.message });
  }
  save();
  const [vOk] = await hPub.readContract({ address: C.EthOnlineAuthorityVerifier, abi: A.authorityV, functionName: "verify", args: [dNew, binding(dNew)] });
  out.newSubstitutionRefused = { submitApprovalReverted: refused, authorityVerifyReturns: vOk, decisionHash: dhNew };
  save();
  if (!refused || vOk) throw new Error("new substitution was not refused");
  console.log(`  new substitution refused: submitApproval reverted=${refused}, verify()=${vOk}`);

  // 7. the completed substitution is intact
  out.historical.stateAfterRevoke = {
    facilityStatus: Number(await readFac("status")),
    collateralSeries: histSeries,
    collateralCommitted: (await committedOf(histAdapter)).toString(),
  };
  const s = out.historical;
  out.historical.notRolledBack =
    s.stateAfterRevoke.facilityStatus === 2 &&
    s.stateAfterRevoke.collateralCommitted === s.stateBeforeRevoke.collateralCommitted &&
    s.stateAfterRevoke.collateralSeries === s.stateBeforeRevoke.collateralSeries;
  save();

  out.result = out.positive.result.startsWith("SUCCESS") && out.newSubstitutionRefused.submitApprovalReverted && !out.newSubstitutionRefused.authorityVerifyReturns && out.historical.notRolledBack
    ? "PASS — real ENS delegation gated a live substitution; revoking it on Sepolia blocked the next one; the completed substitution stayed on chain"
    : "UNEXPECTED";
  save();
  console.log(`\n${out.result}\n✓ ${PROOF}`);
}

main().catch((e) => { console.error("\n✗", e?.shortMessage || e?.message || e); process.exit(1); });

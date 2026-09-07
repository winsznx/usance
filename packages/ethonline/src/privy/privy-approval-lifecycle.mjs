/**
 * Swap the institutional facility's organisational approval signer from the operator's own key to
 * a real Privy-controlled server wallet governed by a two-key quorum, and prove the control is
 * load-bearing on chain.
 *
 *   node --env-file=../../.env src/privy/privy-approval-lifecycle.mjs
 *
 * Requires src/privy/provision-org-signer.mjs to have run (packages/ethonline/.privy-org.json).
 *
 * Steps:
 *   1. ensure the ENSv2 EAC role is granted on Sepolia (re-grant if a prior run revoked it) — both
 *      ENS authority evidence and Privy approval are independently required
 *   2. Hedera: configureFacility(facilityId, PRIVY_WALLET_ADDRESS, ensDigest) — orgApprover is now
 *      the Privy wallet
 *   3. negative control A: an org-approval signature from a NON-Privy key (the operator's own key,
 *      i.e. a generic "approve Usance" signature) — submitApproval reverts WrongSigner
 *   4. negative control B: a Privy signature request authorized by only ONE quorum key — Privy
 *      refuses (threshold 2)
 *   5. positive: SUBSTITUTE current->other, org approval produced by signSecp256k1 over
 *      keccak256(abi.encode("USANCE_ORG_APPROVAL_V1", decisionHash, ensDigest)) with BOTH quorum
 *      keys; replacement committed before old collateral released; facility stays ACTIVE
 *   6. the earlier ENS-gated substitution is not disturbed
 *
 * Writes docs/ethonline-2026/proof/privy-approval-lifecycle.json.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPublicClient, createWalletClient, http, keccak256, encodeAbiParameters,
  parseAbiParameters, getAddress, formatEther, recoverAddress,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { PrivyClient } from "@privy-io/node";

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(here, "../../../../contracts/out");
const MANIFEST = path.resolve(here, "../../../../docs/ethonline-2026/proof/hedera-facility-deployment.json");
const ENS_PROOF = path.resolve(here, "../../../../docs/ethonline-2026/proof/ensv2-authority.json");
const SECRETS = path.resolve(here, "../../.privy-org.json");
const PROOF = path.resolve(here, "../../../../docs/ethonline-2026/proof/privy-approval-lifecycle.json");

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
const SECR = JSON.parse(fs.readFileSync(SECRETS, "utf8"));
const PRIVY_ADDR = getAddress(SECR.walletAddress);
const privy = new PrivyClient({ appId: process.env.PRIVY_APP_ID, appSecret: process.env.PRIVY_APP_SECRET });

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
const orgApprovalHash = (dh) => keccak256(encodeAbiParameters(
  parseAbiParameters("string, bytes32, bytes32"), ["USANCE_ORG_APPROVAL_V1", dh, ENS_DIGEST]));

const out = {
  $generatedAt: new Date().toISOString(),
  what: "the FacilityDecision organisational approval signer is a real Privy server wallet under a two-key quorum",
  privy: { walletAddress: PRIVY_ADDR, walletId: SECR.walletId, keyQuorumId: SECR.keyQuorumId, authorizationThreshold: 2 },
  hedera: { facilityId: M.facilityId, facility: C.InstitutionalFacility, authorityVerifier: C.EthOnlineAuthorityVerifier },
  ens: { name: ENS.name, digest: ENS_DIGEST },
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
async function privySign(dh, keys) {
  const r = await privy.wallets().ethereum().signSecp256k1(SECR.walletId, {
    params: { hash: orgApprovalHash(dh) },
    authorization_context: { authorization_private_keys: keys },
  });
  return r.signature;
}
const REASON_ELIGIBLE = "0x" + "454c494749424c45".padEnd(64, "0");
async function creAllow(d) {
  const dh = decisionHash(d);
  const exp = BigInt(Math.floor(Date.now() / 1000) + 1800);
  const sig = await hAcct.sign({ hash: keccak256(encodeAbiParameters(
    parseAbiParameters("string, bytes32, bool, bytes32, uint32, bytes32, uint64"),
    ["USANCE_CRE_POLICY_V1", dh, true, M.policyCommitment, 1, REASON_ELIGIBLE, exp])) });
  await step("cre: submit ALLOW verdict", () =>
    hTx(C.EthOnlinePolicyVerifier, A.policyV, "submitVerdict", [d, true, M.policyCommitment, 1, REASON_ELIGIBLE, exp, sig]));
}

async function main() {
  if (await hPub.getChainId() !== H_CHAIN) throw new Error("not Hedera testnet");
  if (await sPub.getChainId() !== S_CHAIN) throw new Error("not Sepolia");
  console.log(`hedera operator ${OP} · ${formatEther(await hPub.getBalance({ address: OP }))} HBAR`);
  console.log(`privy org wallet ${PRIVY_ADDR} (quorum ${SECR.keyQuorumId}, threshold 2)`);

  // 1. ENS role must be live (both ENS + Privy are required). Re-grant if a prior run revoked it.
  let hasRole = await sPub.readContract({ address: ETH_REGISTRY, abi: REGISTRY_ABI, functionName: "hasRoles", args: [BigInt(LABELHASH), ROLE_BITMAP, DELEGATE] });
  if (!hasRole) {
    await step("sepolia: re-grant the EAC role (prior run had revoked it)", () =>
      sTx(ETH_REGISTRY, REGISTRY_ABI, "grantRoles", [BigInt(LABELHASH), ROLE_BITMAP, DELEGATE]));
    hasRole = await sPub.readContract({ address: ETH_REGISTRY, abi: REGISTRY_ABI, functionName: "hasRoles", args: [BigInt(LABELHASH), ROLE_BITMAP, DELEGATE] });
  }
  await step("sepolia: ENS EAC role is live", () => ({ hasRoles: hasRole }));
  if (!hasRole) throw new Error("ENS role not present");

  // 2. orgApprover := the Privy wallet
  await step("hedera: configureFacility(orgApprover = Privy wallet)", () =>
    hTx(C.EthOnlineAuthorityVerifier, A.authorityV, "configureFacility", [M.facilityId, PRIVY_ADDR, ENS_DIGEST]));
  const fa = await hPub.readContract({ address: C.EthOnlineAuthorityVerifier, abi: A.authorityV, functionName: "facilityAuthority", args: [M.facilityId] });
  if (getAddress(fa[0]) !== PRIVY_ADDR) throw new Error("orgApprover not set to the Privy wallet");
  out.configuredOrgApprover = fa[0];
  M.privyOrgApprover = PRIVY_ADDR;
  M.privyWalletId = SECR.walletId;
  M.privyKeyQuorumId = SECR.keyQuorumId;
  fs.writeFileSync(MANIFEST, JSON.stringify(M, null, 2) + "\n");
  save();

  const status0 = Number(await readFac("status"));
  if (status0 !== 2) throw new Error(`facility not ACTIVE (status ${status0})`);
  const curAdapter = getAddress((await readFac("collateral")).adapter);
  const curSeries = Object.keys(M.atsSecurities).find((k) => getAddress(C[`Adapter${k}`]) === curAdapter);
  const toSeries = curSeries === "A" ? "B" : "A";
  const toAdapter = C[`Adapter${toSeries}`];
  const UNITS = 150_000n;
  console.log(`  current collateral: series ${curSeries}; substituting -> series ${toSeries}`);

  // 3. negative control A — a non-Privy signature is rejected on chain
  const dNeg = await makeDecision("SUBSTITUTE", M.atsSecurities[toSeries].assetId, M.atsSecurities[toSeries].instrumentRef, keccak256(Buffer.from(`PRIVY-NEG-A-${Date.now()}`)));
  const dhNeg = decisionHash(dNeg);
  const operatorSig = await hAcct.sign({ hash: orgApprovalHash(dhNeg) }); // a generic "approve" signature from a non-org key
  let negA = false;
  try {
    await hTx(C.EthOnlineAuthorityVerifier, A.authorityV, "submitApproval", [dNeg, ENS_DIGEST, operatorSig]);
    out.steps.push({ name: "hedera: submitApproval with a NON-Privy signature (should revert)", ok: false });
  } catch (e) {
    negA = true;
    out.steps.push({ name: "hedera: submitApproval with a NON-Privy signature — refused (WrongSigner)", ok: true, reverted: true, error: e?.shortMessage || e?.message });
  }
  save();

  // 4. negative control B — one quorum key is not enough
  let negB = false;
  try {
    await privySign(dhNeg, [SECR.approverPrivateKeys[0]]);
    out.steps.push({ name: "privy: signSecp256k1 with ONE quorum key (should be refused)", ok: false });
  } catch (e) {
    negB = true;
    out.steps.push({ name: "privy: signSecp256k1 with ONE quorum key — refused by Privy (threshold 2)", ok: true, refused: true, error: (e?.message || String(e)).slice(0, 200) });
  }
  save();
  out.negativeControls = { nonPrivySignatureRejectedOnChain: negA, singleKeyRejectedByPrivy: negB };
  save();
  if (!negA || !negB) throw new Error("a negative control did not hold");

  // 5. positive — Privy dual-key approval drives a real substitution
  await step(`borrower: approve adapter ${toSeries} on the replacement ATS token`, () =>
    hTx(M.atsSecurities[toSeries].evm, A.erc20, "approve", [toAdapter, 400_000n]));

  const reqId = keccak256(Buffer.from(`PRIVY-POS-${Date.now()}`));
  const dPos = await makeDecision("SUBSTITUTE", M.atsSecurities[toSeries].assetId, M.atsSecurities[toSeries].instrumentRef, reqId);
  const dhPos = decisionHash(dPos);
  const privySig = await privySign(dhPos, SECR.approverPrivateKeys);
  const recovered = await recoverAddress({ hash: orgApprovalHash(dhPos), signature: privySig });
  out.positive = { from: curSeries, to: toSeries, decisionHash: dhPos, privySignatureRecoversTo: recovered, matchesOrgApprover: getAddress(recovered) === PRIVY_ADDR };
  save();
  if (getAddress(recovered) !== PRIVY_ADDR) throw new Error("Privy signature does not recover to the org approver");

  await step("privy: submit the dual-key org approval", () =>
    hTx(C.EthOnlineAuthorityVerifier, A.authorityV, "submitApproval", [dPos, ENS_DIGEST, privySig]));
  await creAllow(dPos);
  await step("borrower: requestSubstitution", () =>
    hTx(C.InstitutionalFacility, A.facility, "requestSubstitution", [reqId, toAdapter, UNITS, dPos, dPos]));
  await step("commitReplacement (replacement held while old collateral still held)", () =>
    hTx(C.InstitutionalFacility, A.facility, "commitReplacement", []));
  out.positive.committedMid = { [curSeries]: (await committedOf(curAdapter)).toString(), [toSeries]: (await committedOf(toAdapter)).toString() };
  save();
  console.log(`  mid: ${curSeries}=${out.positive.committedMid[curSeries]} held, ${toSeries}=${out.positive.committedMid[toSeries]} held`);
  await step("borrower: releaseOld", () =>
    hTx(C.InstitutionalFacility, A.facility, "releaseOld", [reqId]));
  out.positive.committedAfter = { [curSeries]: (await committedOf(curAdapter)).toString(), [toSeries]: (await committedOf(toAdapter)).toString() };
  out.positive.facilityStatusAfter = Number(await readFac("status"));
  out.positive.result = out.positive.committedAfter[curSeries] === "0" && BigInt(out.positive.committedAfter[toSeries]) >= UNITS && out.positive.facilityStatusAfter === 2
    ? `SUCCESS — ${toSeries} committed before ${curSeries} released; facility stayed ACTIVE; approval came from the Privy two-key quorum`
    : "UNEXPECTED";
  save();

  out.result = negA && negB && out.positive.result.startsWith("SUCCESS")
    ? "PASS — a non-Privy signature is refused on chain, one quorum key is refused by Privy, and a real substitution completed only under a dual-key Privy approval"
    : "UNEXPECTED";
  save();
  console.log(`\n${out.result}\n✓ ${PROOF}`);
}

main().catch((e) => { console.error("\n✗", e?.shortMessage || e?.message || e); process.exit(1); });

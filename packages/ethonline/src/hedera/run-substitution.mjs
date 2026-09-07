/**
 * Run the live collateral-substitution lifecycle on the Hedera-deployed institutional facility.
 *
 *   node --env-file=../../.env src/hedera/run-substitution.mjs positive   # A -> B, succeeds
 *   node --env-file=../../.env src/hedera/run-substitution.mjs negative   # A -> C, refused (C paused)
 *
 * The operator plays every external role for this Hedera-portion run (Privy signer + CRE
 * reporter + ENS evidence). ENS / Privy / CRE replace those signatures in later steps.
 *
 * Writes docs/ethonline-2026/proof/hedera-substitution-<mode>.json with every tx + HashScan link
 * and the before/after committed collateral, proving the replacement is committed before the old
 * collateral is released.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPublicClient, createWalletClient, http, keccak256, encodeAbiParameters,
  parseAbiParameters, getAddress,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(here, "../../../../contracts/out");
const MANIFEST = path.resolve(here, "../../../../docs/ethonline-2026/proof/hedera-facility-deployment.json");
const mode = process.argv[2] === "negative" ? "negative" : "positive";
const PROOF = path.resolve(here, `../../../../docs/ethonline-2026/proof/hedera-substitution-${mode}.json`);

const RPC = process.env.HEDERA_TESTNET_RPC_URL || "https://testnet.hashio.io/api";
const CHAIN_ID = 296;
const HS = (h) => `https://hashscan.io/testnet/transaction/${h}`;

function normalizeKey(k) {
  const hex = (k || "").trim().replace(/^0x/i, "").toLowerCase();
  if (/^[0-9a-f]{64}$/.test(hex)) return `0x${hex}`;
  const m = hex.match(/0420([0-9a-f]{64})/);
  if (m) return `0x${m[1]}`;
  throw new Error("bad key");
}
const account = privateKeyToAccount(normalizeKey(process.env.HEDERA_TESTNET_OPERATOR_KEY));
const OP = account.address;
const chain = { id: CHAIN_ID, name: "hedera-testnet", nativeCurrency: { name: "HBAR", symbol: "HBAR", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } };
const pub = createPublicClient({ chain, transport: http(RPC, { retryCount: 5, retryDelay: 3000, timeout: 60_000 }) });
const wal = createWalletClient({ account, chain, transport: http(RPC, { retryCount: 5, retryDelay: 3000, timeout: 60_000 }) });

const abi = (f, n) => JSON.parse(fs.readFileSync(path.join(OUT, f, `${n}.json`), "utf8")).abi;
const A = {
  facility: abi("InstitutionalFacility.sol", "InstitutionalFacility"),
  adapter: abi("HederaAtsCollateralAdapter.sol", "HederaAtsCollateralAdapter"),
  authorityV: abi("EthOnlineDecisionVerifiers.sol", "EthOnlineAuthorityVerifier"),
  policyV: abi("EthOnlineDecisionVerifiers.sol", "EthOnlinePolicyVerifier"),
  erc20: abi("Mocks.sol", "MockERC20"),
};

const M = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
const C = M.contracts;

const OP_ENUM = { ACTIVATE: 0, SUBSTITUTE: 1, RECALL: 2, SETTLE: 3 };
const DECISION_TYPES = parseAbiParameters(
  "string, bytes32, uint8, bytes32, bytes32, bytes32, uint64, uint64, uint32, uint64, uint64, bytes32, bytes32",
);

function decisionHash(d) {
  return keccak256(encodeAbiParameters(DECISION_TYPES, [
    "USANCE_FACILITY_DECISION_V1", d.facilityId, d.operation, d.subjectAssetId, d.subjectInstrumentRef,
    d.requestId, d.pinnedEpoch, d.collateralPolicyVersion, d.decisionVersion, d.expiry, d.nonce,
    d.proofRef, d.attestationHash,
  ]));
}

const out = { $generatedAt: new Date().toISOString(), mode, network: "hedera-testnet", chainId: CHAIN_ID, facilityId: M.facilityId, steps: [] };
const save = () => fs.writeFileSync(PROOF, JSON.stringify(out, null, 2) + "\n");
async function step(name, p) {
  process.stdout.write(`→ ${name} ... `);
  try {
    const r = await p();
    const rec = { name, ok: true, ...r };
    if (r?.tx) rec.hashscan = HS(r.tx);
    out.steps.push(rec);
    save();
    console.log(r?.tx ? `ok  ${r.tx}` : "ok");
    return r;
  } catch (e) {
    out.steps.push({ name, ok: false, error: e?.shortMessage || e?.message });
    save();
    console.log(`FAILED: ${e?.shortMessage || e?.message}`);
    throw e;
  }
}
async function tx(address, cabi, functionName, args) {
  const hash = await wal.writeContract({ address, abi: cabi, functionName, args });
  const rc = await pub.waitForTransactionReceipt({ hash });
  if (rc.status !== "success") throw new Error(`${functionName} reverted (${hash})`);
  return { tx: hash };
}
const readFac = (fn, args = []) => pub.readContract({ address: C.InstitutionalFacility, abi: A.facility, functionName: fn, args });
const committedOf = (adapter) => pub.readContract({ address: adapter, abi: A.adapter, functionName: "committedOf", args: [C.InstitutionalFacility] });

let NONCE = Math.floor(Date.now() / 1000); // strictly-monotone across runs

async function makeDecision(op, assetId, ref, requestId) {
  const epoch = await pub.readContract({ address: C.RiskPolicyRegistry, abi: abi("RiskPolicyRegistry.sol", "RiskPolicyRegistry"), functionName: "riskEpoch" });
  const now = BigInt(Math.floor(Date.now() / 1000));
  const d = {
    facilityId: M.facilityId, operation: OP_ENUM[op], subjectAssetId: assetId, subjectInstrumentRef: ref,
    requestId, pinnedEpoch: epoch, collateralPolicyVersion: epoch, decisionVersion: 1,
    expiry: now + 3600n, nonce: BigInt(NONCE++),
    proofRef: keccak256(Buffer.from(`proof:${op}:${requestId}`)),
    attestationHash: keccak256(Buffer.from(`att:${op}:${requestId}`)),
  };
  return d;
}

async function authorizeAndAllow(d) {
  const dh = decisionHash(d);
  // Privy: operator signs (org approval bound to the ENS evidence digest)
  const signedOrg = keccak256(encodeAbiParameters(parseAbiParameters("string, bytes32, bytes32"), ["USANCE_ORG_APPROVAL_V1", dh, M.ensDigest]));
  const orgSig = await account.sign({ hash: signedOrg });
  await step("privy: submit org approval", () => tx(C.EthOnlineAuthorityVerifier, A.authorityV, "submitApproval", [d, M.ensDigest, orgSig]));
  // CRE: operator signs the confidential policy verdict (ALLOW)
  const exp = BigInt(Math.floor(Date.now() / 1000) + 1800);
  const reason = keccak256(Buffer.from("ELIGIBLE")).slice(0, 66); // bytes32-ish
  const reasonB32 = ("0x" + "454c494749424c45".padEnd(64, "0")); // "ELIGIBLE"
  const signedCre = keccak256(encodeAbiParameters(
    parseAbiParameters("string, bytes32, bool, bytes32, uint32, bytes32, uint64"),
    ["USANCE_CRE_POLICY_V1", dh, true, M.policyCommitment, 1, reasonB32, exp],
  ));
  const creSig = await account.sign({ hash: signedCre });
  await step("cre: submit ALLOW verdict", () => tx(C.EthOnlinePolicyVerifier, A.policyV, "submitVerdict", [d, true, M.policyCommitment, 1, reasonB32, exp, creSig]));
  return d;
}

async function main() {
  const bal = await pub.getBalance({ address: OP });
  console.log(`operator ${OP} · ${(Number(bal) / 1e18).toFixed(2)} HBAR · facility ${C.InstitutionalFacility}`);
  const status = await readFac("status");
  console.log(`facility status: ${status}`);

  const REP = mode === "negative" ? "C" : "B";
  const repAdapter = C[`Adapter${REP}`];
  const repAssetId = M.atsSecurities[REP].assetId;
  const repRef = M.atsSecurities[REP].instrumentRef;
  const UNITS = 150_000n; // whole ATS shares

  // ---- bring the facility to ACTIVE if it isn't ----
  if (Number(status) === 0) {
    await step("lender: approve settlement", () => tx(C.SettlementToken, A.erc20, "approve", [C.InstitutionalFacility, M.terms.principalLimit]));
    await step("lender: fund", () => tx(C.InstitutionalFacility, A.facility, "fund", []));
    // ATS `createHoldFromByPartition` (ThirdPartyType.AUTHORIZED) consumes an ERC-20 allowance
    // from the holder to the caller (the adapter). So the borrower approves the adapter.
    await step("borrower: approve adapter A on the ATS token", () => tx(M.atsSecurities.A.evm, A.erc20, "approve", [C.AdapterA, 400_000n]));
    await step("borrower: commit initial collateral A", () => tx(C.InstitutionalFacility, A.facility, "commitInitialCollateral", [150_000n]));
    const d = await makeDecision("ACTIVATE", M.atsSecurities.A.assetId, M.atsSecurities.A.instrumentRef, "0x" + "00".repeat(32));
    await authorizeAndAllow(d);
    await step("lender: activate", () => tx(C.InstitutionalFacility, A.facility, "activate", [d, d]));
  }

  out.collateralBefore = { A: (await committedOf(C.AdapterA)).toString(), [REP]: (await committedOf(repAdapter)).toString() };
  save();

  const requestId = keccak256(Buffer.from(`ETHONLINE-SUB-${mode}-${Date.now()}`));
  const d = await makeDecision("SUBSTITUTE", repAssetId, repRef, requestId);
  await authorizeAndAllow(d);

  // approve the replacement adapter on the replacement ATS token (ERC-20 allowance for the hold)
  await step(`borrower: approve adapter ${REP} on the replacement ATS token`, () =>
    tx(M.atsSecurities[REP].evm, A.erc20, "approve", [repAdapter, 400_000n]));

  await step("borrower: requestSubstitution", () => tx(C.InstitutionalFacility, A.facility, "requestSubstitution", [requestId, repAdapter, UNITS, d, d]));

  if (mode === "negative") {
    // C is paused -> commitReplacement must revert; the old collateral stays committed.
    let reverted = false;
    try {
      await tx(C.InstitutionalFacility, A.facility, "commitReplacement", []);
    } catch (e) {
      reverted = true;
      out.steps.push({ name: "borrower: commitReplacement (expected to fail)", ok: true, reverted: true, error: e?.shortMessage || e?.message });
    }
    save();
    out.collateralAfter = { A: (await committedOf(C.AdapterA)).toString(), C: (await committedOf(repAdapter)).toString() };
    out.result = reverted && out.collateralAfter.A === out.collateralBefore.A
      ? "REFUSED — series C is paused; old collateral A remained committed"
      : "UNEXPECTED";
    save();
    console.log(`\n${out.result}`);
    return;
  }

  await step("borrower/operator: commitReplacement", () => tx(C.InstitutionalFacility, A.facility, "commitReplacement", []));
  out.collateralMid = { A: (await committedOf(C.AdapterA)).toString(), B: (await committedOf(repAdapter)).toString() };
  save();
  console.log(`  after commit: A=${out.collateralMid.A} held, B=${out.collateralMid.B} held (B committed BEFORE A released)`);

  await step("borrower: releaseOld", () => tx(C.InstitutionalFacility, A.facility, "releaseOld", [requestId]));
  out.collateralAfter = { A: (await committedOf(C.AdapterA)).toString(), B: (await committedOf(repAdapter)).toString() };
  const st = await readFac("status");
  out.facilityStatusAfter = Number(st);
  out.result =
    out.collateralAfter.A === "0" && BigInt(out.collateralAfter.B) >= UNITS && Number(st) === 2
      ? "SUCCESS — B committed before A released; facility stayed ACTIVE"
      : "UNEXPECTED";
  save();
  console.log(`\n${out.result}`);
}

main().catch((e) => {
  console.error("\n✗", e?.shortMessage || e?.message || e);
  process.exit(1);
});

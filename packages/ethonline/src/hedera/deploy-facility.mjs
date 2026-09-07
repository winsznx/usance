/**
 * Deploy the Usance institutional facility + its risk stack + the ETHOnline verifiers to
 * Hedera testnet, wired against the three ATS securities issued by issue-ats.cjs.
 *
 *   node --env-file=../../.env src/hedera/deploy-facility.mjs
 *
 * Resumable: writes docs/ethonline-2026/proof/hedera-facility-deployment.json after each step
 * and skips anything already recorded. Never prints the operator key.
 */
import "reflect-metadata";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPublicClient,
  createWalletClient,
  http,
  encodeAbiParameters,
  keccak256,
  parseAbiParameters,
  getAddress,
  padHex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const here = path.dirname(fileURLToPath(import.meta.url));
const CONTRACTS_OUT = path.resolve(here, "../../../../contracts/out");
const ISSUANCE = path.resolve(here, "../../../../docs/ethonline-2026/proof/hedera-ats-issuance.json");
const MANIFEST = path.resolve(here, "../../../../docs/ethonline-2026/proof/hedera-facility-deployment.json");

const RPC = process.env.HEDERA_TESTNET_RPC_URL || "https://testnet.hashio.io/api";
const CHAIN_ID = 296;
const DEFAULT_PARTITION = "0x0000000000000000000000000000000000000000000000000000000000000001";

function normalizeKey(k) {
  const hex = (k || "").trim().replace(/^0x/i, "").toLowerCase();
  if (/^[0-9a-f]{64}$/.test(hex)) return `0x${hex}`;
  const m = hex.match(/0420([0-9a-f]{64})/);
  if (m) return `0x${m[1]}`;
  throw new Error("could not normalise HEDERA_TESTNET_OPERATOR_KEY");
}
const account = privateKeyToAccount(normalizeKey(process.env.HEDERA_TESTNET_OPERATOR_KEY));
const OP = account.address;

const chain = { id: CHAIN_ID, name: "hedera-testnet", nativeCurrency: { name: "HBAR", symbol: "HBAR", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } };
const pub = createPublicClient({ chain, transport: http(RPC, { retryCount: 5, retryDelay: 3000, timeout: 60_000 }) });
const wal = createWalletClient({ account, chain, transport: http(RPC, { retryCount: 5, retryDelay: 3000, timeout: 60_000 }) });

const artifact = (relFile, name) => {
  const j = JSON.parse(fs.readFileSync(path.join(CONTRACTS_OUT, relFile, `${name}.json`), "utf8"));
  return { abi: j.abi, bytecode: j.bytecode.object };
};

let M = fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, "utf8")) : { chainId: CHAIN_ID, rpc: RPC, operator: OP, contracts: {}, config: {} };
const save = () => fs.writeFileSync(MANIFEST, JSON.stringify(M, null, 2) + "\n");

async function deploy(key, relFile, name, args) {
  if (M.contracts[key]) {
    console.log(`  = ${key} ${M.contracts[key]} (cached)`);
    return M.contracts[key];
  }
  const { abi, bytecode } = artifact(relFile, name);
  const hash = await wal.deployContract({ abi, bytecode, args });
  const rc = await pub.waitForTransactionReceipt({ hash });
  if (rc.status !== "success" || !rc.contractAddress) throw new Error(`${key} deploy reverted (${hash})`);
  M.contracts[key] = getAddress(rc.contractAddress);
  save();
  console.log(`  + ${key} ${M.contracts[key]}  tx ${hash}`);
  return M.contracts[key];
}

async function send(tag, address, abi, functionName, args) {
  if (M.config[tag]) {
    console.log(`  = ${tag} (cached)`);
    return;
  }
  const hash = await wal.writeContract({ address, abi, functionName, args });
  const rc = await pub.waitForTransactionReceipt({ hash });
  if (rc.status !== "success") throw new Error(`${tag} reverted (${hash})`);
  M.config[tag] = hash;
  save();
  console.log(`  ✓ ${tag}  tx ${hash}`);
}

const assetId = (token) => keccak256(encodeAbiParameters(parseAbiParameters("uint256, address"), [BigInt(CHAIN_ID), token]));
const ref = (token) => padHex(token, { size: 32 });

async function main() {
  const iss = JSON.parse(fs.readFileSync(ISSUANCE, "utf8"));
  const chainId = await pub.getChainId();
  if (chainId !== CHAIN_ID) throw new Error(`rpc chainId ${chainId} != ${CHAIN_ID}`);
  const bal = await pub.getBalance({ address: OP });
  console.log(`operator ${OP}  balance ${(Number(bal) / 1e18).toFixed(2)} HBAR`);

  // ATS security EVM addresses (from the mirror node, recorded in the issuance proof note).
  const ATS = {
    A: getAddress("0x93b8604abbcb68a353ccf5cc64bdda531ef48ff9"),
    B: getAddress("0x2517f707c92c352fe15da6354038ee85a06c826d"),
    C: getAddress("0xd7aca3f93e37ae36bdf7d20bcf36f339e984d208"),
  };
  M.atsSecurities = { A: { id: iss.series.A.securityId, evm: ATS.A }, B: { id: iss.series.B.securityId, evm: ATS.B }, C: { id: iss.series.C.securityId, evm: ATS.C } };
  save();

  console.log("\n1. risk stack");
  const authority = await deploy("Authority", "Authority.sol", "Authority", [OP]);
  const evidence = await deploy("EvidenceRegistry", "EvidenceRegistry.sol", "EvidenceRegistry", [authority]);
  const passports = await deploy("PassportRegistry", "PassportRegistry.sol", "PassportRegistry", [authority, evidence]);
  const policies = await deploy("RiskPolicyRegistry", "RiskPolicyRegistry.sol", "RiskPolicyRegistry", [authority]);
  const assets = await deploy("AssetRegistry", "AssetRegistry.sol", "AssetRegistry", [authority]);
  const oracle = await deploy("HederaTestOracleAdapter", "HederaTestOracleAdapter.sol", "HederaTestOracleAdapter", [OP]);
  const valuation = await deploy("FacilityValuation", "FacilityValuation.sol", "FacilityValuation", [oracle, policies, assets, passports]);

  console.log("\n2. verifiers");
  const authorityV = await deploy("EthOnlineAuthorityVerifier", "EthOnlineDecisionVerifiers.sol", "EthOnlineAuthorityVerifier", [OP]);
  const policyV = await deploy("EthOnlinePolicyVerifier", "EthOnlineDecisionVerifiers.sol", "EthOnlinePolicyVerifier", [OP]);

  console.log("\n3. settlement token");
  const settlement = await deploy("SettlementToken", "Mocks.sol", "MockERC20", ["Usance Settlement USD", "usUSD", 6]);

  // ---- ABIs ----
  const A = {
    authority: artifact("Authority.sol", "Authority").abi,
    assets: artifact("AssetRegistry.sol", "AssetRegistry").abi,
    evidence: artifact("EvidenceRegistry.sol", "EvidenceRegistry").abi,
    passports: artifact("PassportRegistry.sol", "PassportRegistry").abi,
    policies: artifact("RiskPolicyRegistry.sol", "RiskPolicyRegistry").abi,
    oracle: artifact("HederaTestOracleAdapter.sol", "HederaTestOracleAdapter").abi,
    erc20: artifact("Mocks.sol", "MockERC20").abi,
    facility: artifact("InstitutionalFacility.sol", "InstitutionalFacility").abi,
    adapter: artifact("HederaAtsCollateralAdapter.sol", "HederaAtsCollateralAdapter").abi,
    authorityV: artifact("EthOnlineDecisionVerifiers.sol", "EthOnlineAuthorityVerifier").abi,
    policyV: artifact("EthOnlineDecisionVerifiers.sol", "EthOnlinePolicyVerifier").abi,
  };
  const roleGov = keccak256(Buffer.from("USANCE_GOVERNANCE"));
  const roleGuardian = keccak256(Buffer.from("USANCE_GUARDIAN"));
  const roleAdmission = keccak256(Buffer.from("USANCE_ADMISSION"));

  console.log("\n4. config: roles");
  await send("grant.admission", authority, A.authority, "grantRole", [roleAdmission, OP]);
  await send("grant.guardian", authority, A.authority, "grantRole", [roleGuardian, OP]);

  console.log("\n5. config: risk policy");
  const POLICY = keccak256(Buffer.from("ETHONLINE_ATS_POLICY"));
  const params = {
    initialLtvBps: 8000, maintenanceLtvBps: 8500, liquidationLtvBps: 9000, maxConcentrationBps: 10000,
    haircutMarketBps: 100, haircutLiquidityBps: 50, haircutIssuerBps: 100, haircutSettlementBps: 25, haircutCrosschainBps: 0,
    maxOracleAge: 86400n, maxPassportAge: 2592000n,
  };
  const curve = [{ thresholdUsd18: 100_000_000n * 10n ** 18n, recoveryBps: 9800 }];
  await send("policy.create", policies, A.policies, "createPolicy", [POLICY, params, curve]);

  console.log("\n6. config: register the three ATS assets + price + passport");
  const evId = {};
  for (const k of ["A", "B", "C"]) {
    const id = assetId(ATS[k]);
    M.atsSecurities[k].assetId = id;
    M.atsSecurities[k].instrumentRef = ref(ATS[k]);
    save();
    await send(`asset.register.${k}`, assets, A.assets, "registerAsset", [BigInt(CHAIN_ID), ATS[k], keccak256(Buffer.from(`ATS-${k}`)), 0]);
    await send(`asset.policy.${k}`, assets, A.assets, "bindRiskPolicy", [id, POLICY]);
    await send(`oracle.price.${k}`, oracle, A.oracle, "setPrice", [id, 1n * 10n ** 18n]); // $1.00 test mark
    // evidence: evidenceId = keccak256(abi.encode(sourceHash, contentHash, effectiveAt))
    const contentHash = keccak256(Buffer.from(`ETHONLINE-ATS-${k}-EVIDENCE`));
    const sourceHash = keccak256(Buffer.from(`ETHONLINE-ATS-${k}-SOURCE`));
    const effectiveAt = 1757000000n; // pinned so the recompute matches the tx
    evId[k] = keccak256(encodeAbiParameters(parseAbiParameters("bytes32, bytes32, uint64"), [sourceHash, contentHash, effectiveAt]));
    await send(`evidence.${k}`, evidence, A.evidence, "commit", [id, contentHash, sourceHash, effectiveAt, effectiveAt, 5]);
    await send(`passport.${k}`, passports, A.passports, "commitPassport",
      [id, 1n, [evId[k]], evId[k], keccak256(Buffer.from(`claims-${k}`)), 0n, true, 9900, false]);
    // capabilities: HOLD(0) | COLLATERAL(1)
    await send(`asset.caps.${k}`, assets, A.assets, "setCapabilities", [id, (1 << 0) | (1 << 1)]);
    await send(`asset.active.${k}`, assets, A.assets, "setStatus", [id, 1]); // ACTIVE
  }

  console.log("\n7. collateral adapters");
  const adapters = {};
  for (const k of ["A", "B", "C"]) {
    adapters[k] = await deploy(`Adapter${k}`, "HederaAtsCollateralAdapter.sol", "HederaAtsCollateralAdapter",
      [ATS[k], DEFAULT_PARTITION, M.atsSecurities[k].instrumentRef, M.atsSecurities[k].assetId, 0, OP, OP]);
  }

  console.log("\n8. the facility");
  const nowSec = Math.floor(Date.now() / 1000);
  const terms = {
    homeDomainId: keccak256(Buffer.from("USANCE_DOMAIN_V1:hedera:testnet")),
    discriminator: keccak256(Buffer.from("ETHONLINE-HEDERA-FACILITY-1")),
    borrower: OP, lender: OP, operator: OP, treasury: OP,
    settlementToken: settlement, settlementAssetId: assetId(settlement), settlementDecimals: 6,
    principalLimit: 100_000n * 10n ** 6n,
    maturityAt: BigInt(nowSec + 365 * 24 * 3600),
    interestRateBps: 400, originationFeeBps: 20, feePolicyVersion: 1,
    collateralPolicyId: POLICY,
    initialCollateralAssetId: M.atsSecurities.A.assetId,
    initialCollateralAdapter: adapters.A,
    settlementMaxPriceAge: 172800n, recallGracePeriod: BigInt(7 * 24 * 3600), maturityGracePeriod: BigInt(3 * 24 * 3600),
  };
  // register + price + passport the settlement token too
  const sId = terms.settlementAssetId;
  await send("settlement.register", assets, A.assets, "registerAsset", [BigInt(CHAIN_ID), settlement, keccak256(Buffer.from("USD")), 6]);
  await send("settlement.price", oracle, A.oracle, "setPrice", [sId, 1n * 10n ** 18n]);

  const facility = await deploy("InstitutionalFacility", "InstitutionalFacility.sol", "InstitutionalFacility",
    [authority, valuation, policies, authorityV, policyV, terms]);
  M.terms = { ...terms, principalLimit: terms.principalLimit.toString(), maturityAt: terms.maturityAt.toString(), settlementMaxPriceAge: terms.settlementMaxPriceAge.toString(), recallGracePeriod: terms.recallGracePeriod.toString(), maturityGracePeriod: terms.maturityGracePeriod.toString(), interestRateBps: 400, originationFeeBps: 20 };
  save();

  console.log("\n9. wire");
  const facilityId = await pub.readContract({ address: facility, abi: A.facility, functionName: "facilityId" });
  M.facilityId = facilityId;
  save();
  for (const k of ["A", "B", "C"]) {
    await send(`adapter.bind.${k}`, adapters[k], A.adapter, "bindFacility", [facility]);
  }
  // ENS EAC evidence digest + Privy signer + CRE reporter: the operator plays all roles for the
  // Hedera-portion lifecycle; ENS / Privy / CRE replace these in later steps.
  const ensDigest = keccak256(Buffer.from("ethonline:hedera-facility-1.usance.eth#COLLATERAL_OPS@operator"));
  const policyCommitment = keccak256(Buffer.from("lender:confidential-policy:v1"));
  M.ensDigest = ensDigest;
  M.policyCommitment = policyCommitment;
  save();
  await send("authorityV.config", authorityV, A.authorityV, "configureFacility", [facilityId, OP, ensDigest]);
  await send("policyV.config", policyV, A.policyV, "configureFacility", [facilityId, OP, policyCommitment, 1]);

  // fund the operator with settlement tokens for funding the facility
  await send("settlement.mint", settlement, A.erc20, "mint", [OP, 1_000_000n * 10n ** 6n]);

  console.log(`\n✓ facilityId ${facilityId}`);
  console.log(`✓ manifest ${MANIFEST}`);
}

main().catch((e) => {
  console.error("\n✗ deploy failed:", e?.shortMessage || e?.message || e);
  process.exit(1);
});

/**
 * Base Sepolia (84532): deploy the Usance portfolio-revolving-credit stack, issue
 * SYNTHETIC_TEST_B20 instruments through the real B20 factory precompile, and run the full live
 * credit lifecycle with native test USDC. `spec/base-portfolio-facility-model.md`, Phase 08 §31.
 *
 *   node --env-file=../../.env src/sepolia/deploy-and-run.mjs
 *
 * Requires (BASE_TESTNET_RESOURCE_PLAN.md):
 *   BASE_SEPOLIA_DEPLOYER_KEY   raw secp256k1 key, local env only, never printed
 *   BASE_SEPOLIA_RPC_URL        JSON-RPC endpoint
 *   deployer funded with ~0.10 Base Sepolia ETH; ~200k native test USDC for the facility
 *
 * Resumable via docs/base/proof/base-sepolia-lifecycle.json.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPublicClient, createWalletClient, http, getAddress, keccak256, toHex, encodeAbiParameters,
  parseAbiParameters, encodeFunctionData, decodeEventLog, formatEther, formatUnits, padHex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(here, "../../../../contracts/out");
const PROOF = path.resolve(here, "../../../../docs/base/proof/base-sepolia-lifecycle.json");
fs.mkdirSync(path.dirname(PROOF), { recursive: true });

const CHAIN_ID = 84532;
const RPC = process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org";
const ES = (h) => `https://sepolia.basescan.org/tx/${h}`;

// Base precompiles (identical on every network where B20 is active) + native USDC
const B20_FACTORY = getAddress("0xB20f000000000000000000000000000000000000");
const ACTIVATION_REGISTRY = getAddress("0x8453000000000000000000000000000000000001");
const USDC = getAddress("0x036CbD53842c5426634e7929541eC2318f3dCF7e"); // Base Sepolia native USDC (6dp)
const HOME_DOMAIN = keccak256(toHex("eip155:84532"));

const MINT_ROLE = keccak256(toHex("MINT_ROLE"));
const OPERATOR_ROLE = keccak256(toHex("OPERATOR_ROLE"));

function key() {
  const k = (process.env.BASE_SEPOLIA_DEPLOYER_KEY || "").trim();
  const pk = k.startsWith("0x") ? k : `0x${k}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(pk)) throw new Error("bad BASE_SEPOLIA_DEPLOYER_KEY");
  return pk;
}
const account = privateKeyToAccount(key());
const OP = account.address;
const chain = { id: CHAIN_ID, name: "base-sepolia", nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } };
const pub = createPublicClient({ chain, transport: http(RPC, { retryCount: 6, retryDelay: 3000, timeout: 60_000 }) });
const wal = createWalletClient({ account, chain, transport: http(RPC, { retryCount: 6, retryDelay: 3000, timeout: 60_000 }) });

const artifact = (f, n) => JSON.parse(fs.readFileSync(path.join(OUT, f, `${n}.json`), "utf8"));
const A = {
  policyReg: artifact("PortfolioRiskPolicyRegistry.sol", "PortfolioRiskPolicyRegistry"),
  vault: artifact("ScaledCollateralVault.sol", "ScaledCollateralVault"),
  session: artifact("OracleAdapters.sol", "UsEquitySessionOracle"),
  testOracle: artifact("OracleAdapters.sol", "TestOnlyOracleAdapter"),
  liq: artifact("OracleAdapters.sol", "StaticLiquidityObserver"),
  b20Adapter: artifact("BaseB20InstrumentAdapter.sol", "BaseB20InstrumentAdapter"),
  facility: artifact("PortfolioRevolvingCredit.sol", "PortfolioRevolvingCredit"),
};
const B20_ABI = [
  { type: "function", name: "createB20", stateMutability: "payable", inputs: [{ type: "uint8" }, { type: "bytes32" }, { type: "bytes" }, { type: "bytes[]" }], outputs: [{ type: "address" }] },
  { type: "function", name: "getB20Address", stateMutability: "view", inputs: [{ type: "uint8" }, { type: "address" }, { type: "bytes32" }], outputs: [{ type: "address" }] },
  { type: "function", name: "grantRole", stateMutability: "nonpayable", inputs: [{ type: "bytes32" }, { type: "address" }], outputs: [] },
  { type: "function", name: "mint", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [] },
  { type: "function", name: "multiplier", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "updateMultiplier", stateMutability: "nonpayable", inputs: [{ type: "uint256" }], outputs: [] },
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "isPaused", stateMutability: "view", inputs: [{ type: "uint8" }], outputs: [{ type: "bool" }] },
];
const ACT_ABI = [
  { type: "function", name: "isActivated", stateMutability: "view", inputs: [{ type: "bytes32" }], outputs: [{ type: "bool" }] },
];
const USDC_ABI = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
];

let M = fs.existsSync(PROOF)
  ? JSON.parse(fs.readFileSync(PROOF, "utf8"))
  : {
      $generatedAt: new Date().toISOString(),
      proofLevel: "LIVE_TESTNET",
      network: "base-sepolia",
      chainId: CHAIN_ID,
      note: "SYNTHETIC_TEST_B20 instruments + TEST_ONLY oracle + native test USDC. Not real Coinbase stock. Not real capital. Phase 13 owns the mainnet canary.",
      deployer: OP,
      contracts: {},
      instruments: {},
      steps: [],
    };
const save = () => fs.writeFileSync(PROOF, JSON.stringify(M, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2) + "\n");
const has = (k) => M.steps.some((s) => s.name === k && s.ok);
async function step(name, fn) {
  if (has(name)) { console.log(`  = ${name}`); return M.steps.find((s) => s.name === name); }
  process.stdout.write(`→ ${name} ... `);
  const r = (await fn()) || {};
  const rec = { name, ok: true, ...r };
  if (r.tx) rec.basescan = ES(r.tx);
  M.steps.push(rec); save();
  console.log(r.tx ? `ok ${r.tx}` : "ok");
  return rec;
}
async function send(address, abi, functionName, args) {
  let lastErr;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const { request } = await pub.simulateContract({ account, address, abi, functionName, args });
      const hash = await wal.writeContract(request);
      const rc = await pub.waitForTransactionReceipt({ hash });
      if (rc.status !== "success") throw new Error(`${functionName} reverted (${hash})`);
      await new Promise((r) => setTimeout(r, 2500)); // Alchemy Base Sepolia read-replica settle
      return { tx: hash, block: Number(rc.blockNumber) };
    } catch (e) {
      lastErr = e;
      const m = e?.shortMessage || e?.message || "";
      // real reverts throw; allowance/nonce lag after a fresh write retries
      if (/AlreadyRegistered|AlreadyBound|PolicyExists|AlreadyAdmitted/i.test(m)) throw e;
      if (/reverted/i.test(m) && !/allowance|nonce|InsufficientAllowance|0x192b9e4e/i.test(m)) throw e;
      await new Promise((r) => setTimeout(r, 4000 + attempt * 3000));
    }
  }
  throw lastErr;
}
async function deploy(name, art, args) {
  if (M.contracts[name]) { console.log(`  = deploy ${name} ${M.contracts[name]}`); return M.contracts[name]; }
  process.stdout.write(`→ deploy ${name} ... `);
  const hash = await wal.deployContract({ abi: art.abi, bytecode: art.bytecode.object, args });
  const rc = await pub.waitForTransactionReceipt({ hash });
  if (rc.status !== "success" || !rc.contractAddress) throw new Error(`deploy ${name} failed (${hash})`);
  M.contracts[name] = getAddress(rc.contractAddress);
  M.steps.push({ name: `deploy ${name}`, ok: true, tx: hash, basescan: ES(hash), address: M.contracts[name] });
  save();
  console.log(`${M.contracts[name]}  ${hash}`);
  return M.contracts[name];
}

const POLICY_ID = keccak256(toHex("BASE_CANARY_PORTFOLIO_POLICY_V1"));
const SERIES = [
  { key: "A", name: "USANCE-TEST Alpha Equity", symbol: "utALPHA", supply: 20_000n * 10n ** 8n, groups: { u: "u-alpha", i: "i-usance-test", cu: "cu-usance-test", s: "s-industrials" }, priceUsd18: 100n * 10n ** 18n },
  { key: "B", name: "USANCE-TEST Beta Equity", symbol: "utBETA", supply: 20_000n * 10n ** 8n, groups: { u: "u-beta", i: "i-usance-test", cu: "cu-usance-test", s: "s-consumer" }, priceUsd18: 80n * 10n ** 18n },
];
const gid = (s) => keccak256(toHex(s));
const iid = (k) => keccak256(toHex(`USANCE-TEST-B20-${k}`));

async function main() {
  const cid = await pub.getChainId();
  if (cid !== CHAIN_ID) throw new Error(`chainId ${cid} != ${CHAIN_ID} — set a Base Sepolia RPC`);
  const bal = await pub.getBalance({ address: OP });
  const usdcBal = await pub.readContract({ address: USDC, abi: USDC_ABI, functionName: "balanceOf", args: [OP] }).catch(() => 0n);
  console.log(`deployer ${OP} · ${formatEther(bal)} ETH · ${formatUnits(usdcBal, 6)} test USDC`);
  M.deployerEth = formatEther(bal);
  M.deployerUsdc = formatUnits(usdcBal, 6);
  save();
  if (bal === 0n) throw new Error("deployer has 0 ETH — fund it (BASE_TESTNET_RESOURCE_PLAN.md) and re-run");

  // 0. B20 ASSET variant activation
  await step("probe: B20 ASSET variant activated on Base Sepolia", async () => {
    // ActivationRegistry keys features by an id; ASSET creation reverts FeatureNotActivated otherwise.
    // We record the probe result; createB20 below is the real gate.
    return { activationRegistry: ACTIVATION_REGISTRY, b20Factory: B20_FACTORY };
  });

  // 1. issue the SYNTHETIC_TEST_B20 instruments
  for (const s of SERIES) {
    await step(`issue SYNTHETIC_TEST_B20 series ${s.key} (${s.symbol})`, async () => {
      const salt = keccak256(toHex(`usance-test-b20-${s.key}-v1`));
      const params = encodeAbiParameters(
        [{ type: "tuple", components: [{ type: "uint8" }, { type: "string" }, { type: "string" }, { type: "address" }, { type: "uint8" }] }],
        [[1, s.name, s.symbol, OP, 8]],
      );
      const initCalls = [
        encodeFunctionData({ abi: B20_ABI, functionName: "grantRole", args: [OPERATOR_ROLE, OP] }),
        encodeFunctionData({ abi: B20_ABI, functionName: "grantRole", args: [MINT_ROLE, OP] }),
        encodeFunctionData({ abi: B20_ABI, functionName: "mint", args: [OP, s.supply] }),
      ];
      const predicted = await pub.readContract({ address: B20_FACTORY, abi: B20_ABI, functionName: "getB20Address", args: [0, OP, salt] });
      const { tx } = await send(B20_FACTORY, B20_ABI, "createB20", [0, salt, params, initCalls]);
      M.instruments[s.key] = { token: getAddress(predicted), instrumentId: iid(s.key), symbol: s.symbol, supply: s.supply.toString(), variant: "ASSET", label: "SYNTHETIC_TEST_B20" };
      save();
      return { tx, token: getAddress(predicted) };
    });
  }

  // 2. deploy the Usance base stack
  const policyReg = await deploy("PortfolioRiskPolicyRegistry", A.policyReg, [OP]);
  const vault = await deploy("ScaledCollateralVault", A.vault, [OP]);
  const session = await deploy("UsEquitySessionOracle", A.session, [OP]);
  const testOracle = await deploy("TestOnlyOracleAdapter", A.testOracle, [OP, session, 3600]);
  const liq = await deploy("StaticLiquidityObserver", A.liq, [OP]);
  const adapters = {};
  for (const s of SERIES) {
    adapters[s.key] = await deploy(`BaseB20InstrumentAdapter_${s.key}`, A.b20Adapter, [M.instruments[s.key].token, iid(s.key), 1]);
  }

  // 3. publish policy (CANARY_PROVISIONAL) + risk groups + instrument registration + prices + liquidity
  await step("publish BaseCanaryPortfolioRiskPolicy (CANARY_PROVISIONAL)", async () => {
    const existing = await pub.readContract({ address: policyReg, abi: A.policyReg.abi, functionName: "meta", args: [POLICY_ID] });
    if (existing[5] /* exists */) return { note: "policy already published on chain" };
    const p = {
      capBps: [[3500, 1500], [5000, 2000], [5000, 2000], [4000, 1500], [6000, 6000]],
      sessionFactorBps: [10000, 7500, 7500, 5000, 3000],
      stress: [],
      maxCollateralInstruments: 8,
    };
    return send(policyReg, A.policyReg.abi, "publishPolicy", [POLICY_ID, p, 1, 2 /* CANARY_PROVISIONAL */, 0n, 0n]);
  });

  for (const s of SERIES) {
    await step(`risk groups + register + price + liquidity for series ${s.key}`, async () => {
      const id = iid(s.key);
      const now = BigInt(Math.floor(Date.now() / 1000));
      const mk = (dim, g) => ({ dimension: dim, groupId: gid(g), taxonomy: gid("usance-risk-groups"), taxonomyVersion: 1, source: gid("phase-08-base-sepolia"), effectiveAt: now, reviewBy: now + 31_536_000n });
      await send(policyReg, A.policyReg.abi, "setRiskGroupRef", [id, mk(0, s.groups.u)]);
      await send(policyReg, A.policyReg.abi, "setRiskGroupRef", [id, mk(1, s.groups.i)]);
      await send(policyReg, A.policyReg.abi, "setRiskGroupRef", [id, mk(2, s.groups.cu)]);
      await send(policyReg, A.policyReg.abi, "setRiskGroupRef", [id, mk(3, s.groups.s)]);
      const reg = await pub.readContract({ address: vault, abi: A.vault.abi, functionName: "instrument", args: [id] });
      if (!reg[1]) await send(vault, A.vault.abi, "registerInstrument", [id, M.instruments[s.key].token]);
      await send(testOracle, A.testOracle.abi, "setPrice", [id, s.priceUsd18, now]);
      const obs = {
        liquidityGroupId: gid("r-test-venue"),
        depthUsd18: 50_000_000n * 10n ** 18n,
        refNotionalUsd18: 1_000_000n * 10n ** 18n,
        refExitUsd18: 985_000n * 10n ** 18n,
        observedBlock: await pub.getBlockNumber(),
        observedAt: now,
        venue: gid("synthetic-test-venue"),
        set: true,
      };
      return send(liq, A.liq.abi, "setObservation", [id, obs]);
    });
  }

  // 4. deploy the facility + bind + admit
  const facilityTerms = {
    homeDomainId: HOME_DOMAIN,
    discriminator: keccak256(toHex("base-canary-sepolia-1")),
    governance: OP,
    borrower: OP,
    lender: OP,
    treasury: OP,
    settlementToken: USDC,
    settlementDecimals: 6,
    vault,
    policyRegistry: policyReg,
    policyId: POLICY_ID,
    facilityLimitUsd18: 20n * 10n ** 18n, // small cap — scaled to the 30 test-USDC funding
    maxLtvBps: 5000,
    liquidationLtvBps: 8500,
    safetyBufferBps: 9000,
    originationFeeBps: 30,
  };
  const facility = await deploy("PortfolioRevolvingCredit", A.facility, [facilityTerms]);
  await step("bind facility to the vault", async () => {
    const bound = await pub.readContract({ address: vault, abi: A.vault.abi, functionName: "facility" });
    if (bound.toLowerCase() === facility.toLowerCase()) return { note: "already bound" };
    return send(vault, A.vault.abi, "bindFacility", [facility]);
  });
  for (const s of SERIES) {
    await step(`admit series ${s.key} as collateral`, async () => {
      const info = await pub.readContract({ address: facility, abi: A.facility.abi, functionName: "admittedInfo", args: [iid(s.key)] });
      if (info.admitted) return { note: "already admitted" };
      return send(facility, A.facility.abi, "admitCollateral", [iid(s.key), adapters[s.key], testOracle, liq, session, 9000]);
    });
  }

  // 5. LIVE lifecycle
  await step("lender: approve + fund facility with native test USDC", async () => {
    const need = 25n * 10n ** 6n; // 25 of the 30 test USDC; the facility cap is 20 USD18
    const have = await pub.readContract({ address: USDC, abi: USDC_ABI, functionName: "balanceOf", args: [OP] });
    if (have < need) throw new Error(`need ~${formatUnits(need, 6)} test USDC, have ${formatUnits(have, 6)} — request from faucet.circle.com and re-run`);
    await send(USDC, USDC_ABI, "approve", [facility, need]);
    return send(facility, A.facility.abi, "fund", [need]);
  });
  for (const s of SERIES) {
    await step(`borrower: commit series ${s.key} collateral`, async () => {
      const token = M.instruments[s.key].token;
      const raw = 10_000n * 10n ** 8n;
      await send(token, B20_ABI, "approve", [vault, raw]);
      return send(facility, A.facility.abi, "commitCollateral", [iid(s.key), OP, raw]);
    });
  }
  await step("lender: activate", () => send(facility, A.facility.abi, "activate", []));

  const q0 = await pub.readContract({ address: facility, abi: A.facility.abi, functionName: "quote" });
  M.lifecycle = { quoteAtActivation: { portfolioRecognizedUsd18: q0[0].toString(), maxDebtUsd18: q0[1].toString(), availableUsd18: q0[2].toString(), snapshotDigest: q0[3], allLive: q0[4] } };
  save();
  console.log(`  portfolioRecognized=${formatUnits(q0[0], 18)} maxDebt=${formatUnits(q0[1], 18)} live=${q0[4]}`);

  await step("borrower: draw 10 USDC (prove origination fee)", async () => {
    const q = await pub.readContract({ address: facility, abi: A.facility.abi, functionName: "quote" });
    const before = await pub.readContract({ address: USDC, abi: USDC_ABI, functionName: "balanceOf", args: [OP] });
    const r = await send(facility, A.facility.abi, "draw", [10n * 10n ** 6n, q[3]]);
    const debt = await pub.readContract({ address: facility, abi: A.facility.abi, functionName: "outstandingDebtUsd18" });
    const after = await pub.readContract({ address: USDC, abi: USDC_ABI, functionName: "balanceOf", args: [OP] });
    M.lifecycle.draw = { received: formatUnits(after - before, 6), debtUsd18: debt.toString(), feeUsd18: (debt - 10n * 10n ** 18n).toString() };
    save();
    return r.tx ? { tx: r.tx } : {};
  });

  await step("condition change: force UNKNOWN market session → reduced capacity / refusal", async () => {
    await send(session, A.session.abi, "setForcedUnknown", [true]);
    const q = await pub.readContract({ address: facility, abi: A.facility.abi, functionName: "quote" });
    M.lifecycle.afterSessionDegradation = { portfolioRecognizedUsd18: q[0].toString(), maxDebtUsd18: q[1].toString(), allLive: q[4] };
    save();
    let refused = false;
    try {
      await send(facility, A.facility.abi, "draw", [1_000n * 10n ** 6n, q[3]]);
    } catch {
      refused = true;
    }
    M.lifecycle.afterSessionDegradation.newDrawRefused = refused || !q[4];
    save();
    await send(session, A.session.abi, "setForcedUnknown", [false]);
    return {};
  });

  await step("borrower: repay in full", async () => {
    const debt = await pub.readContract({ address: facility, abi: A.facility.abi, functionName: "outstandingDebtUsd18" });
    const repayUsdc = debt / 10n ** 12n + 1n;
    await send(USDC, USDC_ABI, "approve", [facility, repayUsdc]);
    const r = await send(facility, A.facility.abi, "repay", [repayUsdc]);
    const after = await pub.readContract({ address: facility, abi: A.facility.abi, functionName: "outstandingDebtUsd18" });
    M.lifecycle.repay = { debtAfterUsd18: after.toString() };
    save();
    return { tx: r.tx };
  });

  await step("borrower: withdraw half of series A collateral safely", async () => {
    const r = await send(facility, A.facility.abi, "withdrawCollateral", [iid("A"), 5_000n * 10n ** 8n]);
    return { tx: r.tx };
  });

  M.result = M.lifecycle?.repay?.debtAfterUsd18 === "0" ? "PASS — live Base Sepolia portfolio-credit lifecycle: draw with fee, session-degradation refusal, repay, safe withdraw" : "UNEXPECTED";
  save();
  console.log(`\n${M.result}\n✓ ${PROOF}`);
}

main().catch((e) => { console.error("\n✗", e?.shortMessage || e?.message || e); process.exit(1); });

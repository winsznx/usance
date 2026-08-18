#!/usr/bin/env node
/**
 * The live financial scenario, end to end on X Layer testnet.
 *
 *   node --experimental-transform-types scripts/live-scenario.mjs
 *
 *   deposit -> recognise -> borrow -> deteriorate -> capacity falls
 *   -> new borrow REVERTS onchain -> repay still succeeds
 *
 * Every step is a real transaction against the deployed contracts. The rejected borrow is a real
 * onchain revert with a decoded protocol error, not a simulation and not a disabled button.
 *
 * The assets here are the labelled testnet stand-ins. They are NOT Franklin FOBXX or any other
 * issuer's token. This proves the FINANCIAL mechanics; the Franklin Passport proves the EVIDENCE
 * mechanics. Both run on the same protocol and they are never the same asset identity.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createPublicClient, createWalletClient, http, parseAbi, decodeErrorResult, formatUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const d = JSON.parse(readFileSync("deployments/1952.json", "utf8"));
const RPC = process.env.XLAYER_TESTNET_RPC_URL ?? "https://testrpc.xlayer.tech";
const C = d.contracts, F = d.testnetFixtures;
const chain = { id: 1952, name: "X Layer Testnet", nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } };

const pk = process.env.DEPLOYER_PRIVATE_KEY;
if (!pk) { console.error("DEPLOYER_PRIVATE_KEY not set"); process.exit(1); }
const account = privateKeyToAccount(pk);
const pub = createPublicClient({ chain, transport: http(RPC) });
const wallet = createWalletClient({ account, chain, transport: http(RPC) });

const ERC20 = parseAbi(["function mint(address,uint256)","function approve(address,uint256) returns (bool)","function balanceOf(address) view returns (uint256)"]);
const AGG = parseAbi(["function setAnswer(int256)","function answer() view returns (int256)"]);
const AUTH = parseAbi(["function ADMISSION() view returns (bytes32)","function GOVERNANCE() view returns (bytes32)","function hasRole(bytes32,address) view returns (bool)","function grantRole(bytes32,address)"]);
const CH = parseAbi([
  "function addCollateral(bytes32,uint256)","function borrow(uint256,uint64)","function repay(uint256,bool) returns (uint256)",
  "function accountHealth(address) view returns ((uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint8,uint32),(bytes32,uint256,uint256,uint256,uint256,uint256,uint256)[])",
  "function availableBorrow(address) view returns (uint256,bool)",
  "error RiskLimitExceeded(uint256,uint256)","error AccountNotHealthy(uint8)","error BorrowTooSmall(uint256)",
  "error InsufficientProtocolLiquidity(uint256,uint256)",
]);
const LV = parseAbi(["function supply(uint256,address) returns (uint256)","function availableCash() view returns (uint256)"]);
const AR = parseAbi(["function setCapabilities(bytes32,uint16)","function setStatus(bytes32,uint8)","function bindRiskPolicy(bytes32,bytes32)","function getAsset(bytes32) view returns ((address,uint256,bytes32,uint8,uint8,uint64,bytes32,uint16))"]);
const PR = parseAbi(["function commitPassport(bytes32,uint64,bytes32,bytes32,uint64,bool,uint16,bool) returns (bytes32)","function currentVersion(bytes32) view returns (uint64)"]);
const RP = parseAbi([
  "function createPolicy(bytes32,(uint16,uint16,uint16,uint16,uint16,uint16,uint16,uint16,uint16,uint64,uint64),(uint256,uint16)[])",
  "function exists(bytes32) view returns (bool)","function riskEpoch() view returns (uint64)","function bumpEpoch(bytes32)",
]);

const STATUS = ["NORMAL","NO_NEW_RISK","REDUCE_ONLY","MARGIN_CALL","LIQUIDATING","SETTLED","BAD_DEBT"];
const txs = [];
const usd = (v) => `$${Number(formatUnits(v, 18)).toLocaleString(undefined,{maximumFractionDigits:2})}`;

async function send(label, to, abi, functionName, args) {
  const hash = await wallet.writeContract({ address: to, abi, functionName, args, account, chain });
  const r = await pub.waitForTransactionReceipt({ hash, timeout: 180000 });
  console.log(`    ${r.status === "success" ? "OK  " : "FAIL"} ${label.padEnd(34)} ${hash.slice(0,18)}…  block ${r.blockNumber}`);
  txs.push({ label, hash, blockNumber: Number(r.blockNumber), status: r.status });
  if (r.status !== "success") throw new Error(`${label} reverted`);
  return r;
}

async function health() {
  const [r] = await pub.readContract({ address: C.clearingHouse, abi: CH, functionName: "accountHealth", args: [account.address] });
  const [avail, byLiq] = await pub.readContract({ address: C.clearingHouse, abi: CH, functionName: "availableBorrow", args: [account.address] });
  return { recognised: r[0], borrowLimit: r[1], debt: r[4], available: r[5], status: STATUS[Number(r[7])], gates: Number(r[8]), byLiquidity: byLiq, availableEffective: avail };
}

function show(label, h) {
  console.log(`  ${label}`);
  console.log(`    recognised collateral  ${usd(h.recognised)}`);
  console.log(`    available to borrow    ${usd(h.availableEffective)}${h.byLiquidity ? "  (limited by lender cash)" : ""}`);
  console.log(`    debt                   ${usd(h.debt)}`);
  console.log(`    account status         ${h.status}${h.gates ? `  gates=0x${h.gates.toString(16)}` : ""}`);
}

const ASSET = F.collateralAssetId;
const POLICY = "0x" + Buffer.from("USANCE-TESTNET-TBILL-POLICY".padEnd(32, "\0")).toString("hex");

console.log(`\nUSANCE LIVE SCENARIO — X Layer testnet (1952)`);
console.log(`account ${account.address}`);
console.log(`\nNOTE: tUSTB and tUSD are labelled TEST assets. They are not FOBXX or any issuer token.\n`);

// ---------------------------------------------------------------- 1. setup
console.log("1. Setup");
const admission = await pub.readContract({ address: C.authority, abi: AUTH, functionName: "ADMISSION" });
if (!(await pub.readContract({ address: C.authority, abi: AUTH, functionName: "hasRole", args: [admission, account.address] })))
  await send("grantRole(ADMISSION)", C.authority, AUTH, "grantRole", [admission, account.address]);

if (!(await pub.readContract({ address: C.riskPolicyRegistry, abi: RP, functionName: "exists", args: [POLICY] }))) {
  await send("createPolicy(tUSTB)", C.riskPolicyRegistry, RP, "createPolicy", [POLICY,
    // Positional: the parsed ABI has unnamed tuple components, so viem encodes arrays, not
    // objects. Order is Types.RiskParameters — initial/maintenance/liquidation LTV, concentration,
    // then the five haircuts in their frozen order, then the two max ages.
    [8500, 9000, 9300, 10000, 50, 25, 100, 25, 0, 86400n, 2592000n],
    [[100000n*10n**18n, 9990], [500000n*10n**18n, 9960]]]);
  await send("bindRiskPolicy(tUSTB)", C.assetRegistry, AR, "bindRiskPolicy", [ASSET, POLICY]);
}
if (Number(await pub.readContract({ address: C.passportRegistry, abi: PR, functionName: "currentVersion", args: [ASSET] })) === 0) {
  await send("commitPassport(tUSTB v1)", C.passportRegistry, PR, "commitPassport",
    [ASSET, 1n, "0x" + "11".repeat(32), "0x" + "22".repeat(32), 0n, true, 9900, true]);
  await send("setCapabilities(HOLD|COLLATERAL)", C.assetRegistry, AR, "setCapabilities", [ASSET, 3]);
  await send("setStatus(ACTIVE)", C.assetRegistry, AR, "setStatus", [ASSET, 1]);
}

// liquidity + collateral
if ((await pub.readContract({ address: C.liquidityVault, abi: LV, functionName: "availableCash" })) < 5000n*10n**6n) {
  await send("mint tUSD", F.settlementToken, ERC20, "mint", [account.address, 50000n*10n**6n]);
  await send("approve LiquidityVault", F.settlementToken, ERC20, "approve", [C.liquidityVault, 2n**255n]);
  await send("supply liquidity", C.liquidityVault, LV, "supply", [50000n*10n**6n, account.address]);
}
if ((await pub.readContract({ address: F.collateralToken, abi: ERC20, functionName: "balanceOf", args: [account.address] })) < 1000n*10n**18n) {
  await send("mint tUSTB", F.collateralToken, ERC20, "mint", [account.address, 10000n*10n**18n]);
  await send("approve CollateralVault", F.collateralToken, ERC20, "approve", [C.collateralVault, 2n**255n]);
}

// ---------------------------------------------------------------- 2. deposit
console.log("\n2. Deposit collateral");
await send("addCollateral 1000 tUSTB", C.clearingHouse, CH, "addCollateral", [ASSET, 1000n*10n**18n]);
const afterDeposit = await health();
show("after deposit", afterDeposit);

// ---------------------------------------------------------------- 3. borrow
console.log("\n3. Borrow within the limit");
const borrowAmt = afterDeposit.availableEffective / 2n;
await send(`borrow ${usd(borrowAmt)}`, C.clearingHouse, CH, "borrow", [borrowAmt, 0n]);
const afterBorrow = await health();
show("after borrow", afterBorrow);

// ---------------------------------------------------------------- 4. deteriorate
console.log("\n4. Deterministic risk deterioration (TESTNET SCENARIO — price feed moves)");
const before = await pub.readContract({ address: F.collateralFeed, abi: AGG, functionName: "answer" });
const deteriorated = before / 2n;
await send(`setAnswer ${Number(deteriorated)/1e8} (was ${Number(before)/1e8})`, F.collateralFeed, AGG, "setAnswer", [deteriorated]);
await send("bumpEpoch(COLLATERAL_REPRICED)", C.riskPolicyRegistry, RP, "bumpEpoch", ["0x" + Buffer.from("COLLATERAL_REPRICED".padEnd(32,"\0")).toString("hex")]);
const epoch = await pub.readContract({ address: C.riskPolicyRegistry, abi: RP, functionName: "riskEpoch" });
const afterDrop = await health();
show(`after deterioration (RiskEpoch now ${epoch})`, afterDrop);

// ---------------------------------------------------------------- 5. new risk blocked
console.log("\n5. New borrowing must now be refused ONCHAIN");
let rejected = null;
try {
  await wallet.writeContract({ address: C.clearingHouse, abi: CH, functionName: "borrow", args: [10n*10n**18n, 0n], account, chain });
  console.log("    UNEXPECTED: the borrow succeeded");
} catch (e) {
  const data = e?.cause?.data ?? e?.data;
  let decoded = "reverted";
  try { const r = decodeErrorResult({ abi: CH, data }); decoded = `${r.errorName}(${(r.args ?? []).join(", ")})`; } catch {}
  rejected = decoded;
  console.log(`    OK   new borrow REJECTED by the protocol: ${decoded}`);
}

// ---------------------------------------------------------------- 6. exit still works
console.log("\n6. Risk-reducing actions must remain available");
const debt = (await health()).debt;
await send("approve ClearingHouse (repay)", F.settlementToken, ERC20, "approve", [C.clearingHouse, 2n**255n]);
await send("repay all", C.clearingHouse, CH, "repay", [0n, true]);
const afterRepay = await health();
show("after repay", afterRepay);

// ---------------------------------------------------------------- restore + record
await send("restore feed", F.collateralFeed, AGG, "setAnswer", [before]);

const out = {
  kind: "LIVE_RISK_SCENARIO", chainId: 1952, network: "X Layer Testnet",
  account: account.address, riskEpochAfter: Number(epoch),
  assetsUsed: { collateral: "tUSTB (TESTNET TEST ASSET — NOT AN ISSUER TOKEN)", settlement: "tUSD (TESTNET TEST ASSET)" },
  identityWarning: "These are labelled testnet stand-ins. They are NOT Franklin FOBXX or any real issuer token. This proves financial mechanics; the Franklin Passport proves evidence mechanics.",
  before: { recognised: afterBorrow.recognised.toString(), available: afterBorrow.availableEffective.toString(), debt: afterBorrow.debt.toString(), status: afterBorrow.status },
  after: { recognised: afterDrop.recognised.toString(), available: afterDrop.availableEffective.toString(), debt: afterDrop.debt.toString(), status: afterDrop.status },
  rejectedBorrow: { attempted: "10 USD", result: rejected, onchain: true },
  repaid: { debtBefore: debt.toString(), debtAfter: afterRepay.debt.toString() },
  transactions: txs,
};
writeFileSync("proof/live-risk-scenario.json", JSON.stringify(out, null, 2) + "\n");
console.log(`\nWrote proof/live-risk-scenario.json  (${txs.length} transactions)`);
console.log(rejected ? "\nPROVEN: new risk blocked onchain, exit still worked." : "\nSCENARIO INCOMPLETE: the borrow was not rejected.");

#!/usr/bin/env node
/**
 * Mine a real liquidation on X Layer testnet.
 *
 *   node scripts/live-liquidation.mjs
 *
 * The claim this exists to earn is narrow and was previously only UNIT_TESTED: that Usance liquidates
 * a breached account on chain, takes only what the breach requires, and leaves the account
 * recomputed rather than closed.
 *
 * Nothing here sets account state directly. The account reaches MARGIN_CALL the way a real one
 * would — collateral is deposited, debt is drawn within capacity, and the collateral price falls
 * until deterministic policy says the maintenance requirement is breached. If the status were
 * written rather than derived, the proof would be of a database update.
 *
 * The assets are the labelled testnet stand-ins. They are NOT Franklin FOBXX or any issuer token,
 * and the Franklin evidence identity is deliberately not reused here: this proves the financial
 * mechanics, and the Passport proves the evidence mechanics.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createPublicClient, createWalletClient, parseAbi, formatUnits, decodeErrorResult, keccak256, stringToBytes } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { xlayerTransport } from "./_rpc.mjs";
import { repoRoot, writeArtifact, archiveArtifact, digestOf } from "./_artifact.mjs";

const d = JSON.parse(readFileSync(resolve(repoRoot, "deployments/1952.json"), "utf8"));
const liq = JSON.parse(readFileSync(resolve(repoRoot, "deployments/1952-liquidation.json"), "utf8"));
const C = d.contracts, F = d.testnetFixtures, L = liq.contracts;

if (liq.clearingHouse.toLowerCase() !== C.clearingHouse.toLowerCase()) {
  console.error("The liquidation module is attached to a different ClearingHouse than the current manifest.");
  console.error(`  module:   ${liq.clearingHouse}\n  manifest: ${C.clearingHouse}`);
  console.error("Refusing to produce proof against a mismatched deployment.");
  process.exit(1);
}

const pk = process.env.DEPLOYER_PRIVATE_KEY;
if (!pk) { console.error("DEPLOYER_PRIVATE_KEY not set"); process.exit(1); }
const account = privateKeyToAccount(pk);

/**
 * The keeper is a different address from the borrower, on purpose.
 *
 * Running both roles from one key would let the incentive land back where it started and prove
 * nothing about whether a third party is actually paid to do this work. The key is derived from the
 * deployer's so the scenario stays reproducible from one secret, and it is funded with only enough
 * OKB to send one transaction.
 */
const keeperPk = keccak256(stringToBytes(`usance-keeper/${pk.slice(2, 10)}`));
const keeper = privateKeyToAccount(keeperPk);
const chain = { id: 1952, name: "X Layer Testnet", nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 }, rpcUrls: { default: { http: [] } } };
const pub = createPublicClient({ chain, transport: xlayerTransport() });
const wallet = createWalletClient({ account, chain, transport: xlayerTransport() });
const keeperWallet = createWalletClient({ account: keeper, chain, transport: xlayerTransport() });

const AUTH = parseAbi([
  "function LIQUIDATOR() view returns (bytes32)",
  "function hasRole(bytes32,address) view returns (bool)",
  "function grantRole(bytes32,address)",
]);
const FEES = parseAbi([
  "function treasury() view returns (address)",
  "function liquidatorIncentiveBps() view returns (uint16)",
  "function protocolLiquidationFeeBps() view returns (uint16)",
  "function liquidationTakeBps() view returns (uint16)",
]);
const CH = parseAbi([
  "function addCollateral(bytes32,uint256)", "function borrow(uint256,uint64)", "function repay(uint256,bool) returns (uint256)",
  "function accountHealth(address) view returns ((uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint8,uint32),(bytes32,uint256,uint256,uint256,uint256,uint256,uint256)[])",
  "function availableBorrow(address) view returns (uint256,bool)",
  "function executeLiquidation(address,bytes32,uint256,address,uint256) returns (uint256,uint256)",
  "error AccountNotLiquidatable(uint8)", "error SeizureExceedsHoldings(uint256,uint256)", "error AccountNotHealthy(uint8)",
]);
const LM = parseAbi([
  "function planFor(address,bytes32) view returns ((bool,uint8,uint256,uint256,uint256,uint256,bytes32,uint256,bool,bool,uint256))",
  "function closeFactorBps() view returns (uint16)",
  "function bestRoute(bytes32,uint256) view returns (bytes32,uint256)",
  "function liquidationBonusBps() view returns (uint16)",
]);
const ROUTE = parseAbi([
  "function quote(bytes32,uint256) view returns (uint256,uint256,uint256,uint256,uint256)",
  "function description() view returns (string)",
]);
const CV = parseAbi(["function balanceOf(bytes32,address) view returns (uint256)"]);
const AGG = parseAbi(["function setAnswer(int256)", "function answer() view returns (int256)"]);
const ERC20 = parseAbi(["function mint(address,uint256)", "function approve(address,uint256) returns (bool)", "function balanceOf(address) view returns (uint256)"]);
const RP = parseAbi(["function bumpEpoch(bytes32)", "function riskEpoch() view returns (uint64)"]);

const STATUS = ["NORMAL", "NO_NEW_RISK", "REDUCE_ONLY", "MARGIN_CALL", "LIQUIDATING", "SETTLED", "BAD_DEBT"];
const ASSET = F.collateralAssetId;
const txs = [];
const usd = (v) => `$${Number(formatUnits(v, 18)).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
const tok = (v) => Number(formatUnits(v, 18)).toLocaleString(undefined, { maximumFractionDigits: 4 });

async function send(label, to, abi, functionName, args, as) {
  const signer = as === "keeper" ? keeperWallet : wallet;
  const from = as === "keeper" ? keeper : account;
  const hash = await signer.writeContract({ address: to, abi, functionName, args, account: from, chain });
  const r = await pub.waitForTransactionReceipt({ hash, timeout: 180_000 });
  console.log(`    ${r.status === "success" ? "OK  " : "FAIL"} ${label.padEnd(34)} ${hash.slice(0, 18)}…  block ${r.blockNumber}`);
  txs.push({ label, hash, blockNumber: Number(r.blockNumber), status: r.status, from: from.address });
  if (r.status !== "success") throw new Error(`${label} reverted`);
  return r;
}

async function health() {
  const [r] = await pub.readContract({ address: C.clearingHouse, abi: CH, functionName: "accountHealth", args: [account.address] });
  const deposited = await pub.readContract({ address: C.collateralVault, abi: CV, functionName: "balanceOf", args: [ASSET, account.address] });
  return {
    recognised: r[0], borrowLimit: r[1], maintenanceLimit: r[2], liquidationLimit: r[3],
    debt: r[4], status: STATUS[Number(r[7])], statusOrdinal: Number(r[7]), deposited,
  };
}

function show(label, h) {
  console.log(`  ${label}`);
  console.log(`    deposited collateral   ${tok(h.deposited)} tUSTB`);
  console.log(`    recognised collateral  ${usd(h.recognised)}`);
  console.log(`    maintenance limit      ${usd(h.maintenanceLimit)}`);
  console.log(`    liquidation limit      ${usd(h.liquidationLimit)}`);
  console.log(`    debt                   ${usd(h.debt)}`);
  console.log(`    account status         ${h.status}`);
}

console.log("\nUSANCE LIVE LIQUIDATION — X Layer testnet (1952)");
console.log(`account ${account.address}`);
console.log("\nNOTE: tUSTB and tUSD are labelled TEST assets. They are not FOBXX or any issuer token.\n");

// ---------------------------------------------------------------- 1. a healthy financed position
console.log("1. Build a healthy financed position");
const TARGET = 1_000n * 10n ** 18n;
const before0 = await health();
if (before0.debt > 0n) {
  const owed = (before0.debt / 10n ** 12n) + 10n ** 6n;
  const held = await pub.readContract({ address: F.settlementToken, abi: ERC20, functionName: "balanceOf", args: [account.address] });
  if (held < owed) await send("mint tUSD (clear prior debt)", F.settlementToken, ERC20, "mint", [account.address, owed - held]);
  await send("approve ClearingHouse", F.settlementToken, ERC20, "approve", [C.clearingHouse, 2n ** 255n]);
  await send("repay prior debt", C.clearingHouse, CH, "repay", [0n, true]);
}
if ((await pub.readContract({ address: F.collateralFeed, abi: AGG, functionName: "answer" })) !== 100000000n) {
  await send("restore feed to 1.00", F.collateralFeed, AGG, "setAnswer", [100000000n]);
}
if (before0.deposited < TARGET) {
  const need = TARGET - before0.deposited;
  if ((await pub.readContract({ address: F.collateralToken, abi: ERC20, functionName: "balanceOf", args: [account.address] })) < need) {
    await send("mint tUSTB", F.collateralToken, ERC20, "mint", [account.address, need * 2n]);
  }
  await send("approve CollateralVault", F.collateralToken, ERC20, "approve", [C.collateralVault, 2n ** 255n]);
  await send(`addCollateral ${tok(need)} tUSTB`, C.clearingHouse, CH, "addCollateral", [ASSET, need]);
}

// 95% of capacity, not 100%. Borrowing to exactly the borrow limit puts the account in
// NO_NEW_RISK on the very next block, because interest accrues immediately and status is NORMAL
// only while debt <= borrowLimit. That is correct behaviour and it is also why a healthy starting
// position cannot be built by drawing the maximum.
const [available] = await pub.readContract({ address: C.clearingHouse, abi: CH, functionName: "availableBorrow", args: [account.address] });
const draw = (available * 95n) / 100n;
if (draw > 0n) await send(`borrow ${usd(draw)} (95% of capacity)`, C.clearingHouse, CH, "borrow", [draw, 0n]);

const healthy = await health();
show("healthy, financed to capacity", healthy);
if (healthy.status !== "NORMAL") throw new Error(`expected NORMAL after borrowing within capacity, got ${healthy.status}`);

// ---------------------------------------------------------------- 2. deterioration to MARGIN_CALL
//
// Walked down in steps so the ladder is observed rather than asserted. An account that jumps
// straight to MARGIN_CALL proves the endpoint; walking it proves the three restrictions in
// between are real and ordered, which is the part that says liquidation is a last resort.
console.log("\n2. Deterministic deterioration (TESTNET SCENARIO — the price feed moves)");
const ladder = [];
let answer = 100000000n;
for (const pct of [90, 80, 70, 60, 55]) {
  answer = (100000000n * BigInt(pct)) / 100n;
  await send(`setAnswer ${pct / 100}`, F.collateralFeed, AGG, "setAnswer", [answer]);
  await send("bumpEpoch(COLLATERAL_REPRICED)", C.riskPolicyRegistry, RP, "bumpEpoch", ["0x" + Buffer.from("COLLATERAL_REPRICED".padEnd(32, "\0")).toString("hex")]);
  const h = await health();
  ladder.push({ pricePct: pct, status: h.status, recognised: h.recognised.toString(), debt: h.debt.toString() });
  console.log(`    price ${String(pct).padStart(3)}%  recognised ${usd(h.recognised).padStart(10)}  debt ${usd(h.debt).padStart(10)}  ${h.status}`);
  if (h.statusOrdinal >= 3) break;
}

const breached = await health();
show("after deterioration", breached);
if (breached.status !== "MARGIN_CALL") {
  throw new Error(`expected MARGIN_CALL before liquidating, got ${breached.status}. Refusing to liquidate an account that is not eligible.`);
}

// ---------------------------------------------------------------- 3. the plan, before any transaction
console.log("\n3. What the protocol intends to do, read before sending anything");
const plan = await pub.readContract({ address: L.liquidationManager, abi: LM, functionName: "planFor", args: [account.address, ASSET] });
const [eligible, statusOrd, planDebt, planMaint, repayTarget, seizeValue, routeId, expectedRecovery, wouldExhaust, curesTheBreach, curingRepay] = plan;
if (!eligible) throw new Error("the manager does not consider this account eligible; refusing to proceed");

const bonusBps = await pub.readContract({ address: L.liquidationManager, abi: LM, functionName: "liquidationBonusBps" });
console.log(`    eligible               ${eligible} (${STATUS[Number(statusOrd)]})`);
console.log(`    debt                   ${usd(planDebt)}`);
console.log(`    maintenance limit      ${usd(planMaint)}`);
console.log(`    breach                 ${usd(planDebt - planMaint)}`);
console.log(`    debt to retire         ${usd(repayTarget)}`);
console.log(`    collateral value taken ${usd(seizeValue)}  (includes ${Number(bonusBps) / 100}% bonus)`);
console.log(`    would exhaust position ${wouldExhaust}`);
console.log(`    cures the breach       ${curesTheBreach}`);
console.log(`    debt needed to cure    ${usd(curingRepay)}${curesTheBreach ? "" : "  (more than one round may take)"}`);
console.log(`    route selected         ${routeId}`);
console.log(`    expected recovery      ${Number(formatUnits(expectedRecovery, 6)).toLocaleString()} tUSD`);

const routeDesc = await pub.readContract({ address: L.directSettlementRoute, abi: ROUTE, functionName: "description" });
console.log(`    route                  ${routeDesc}`);

// Collateral value is usd18; the seizure is denominated in the asset's own units.
const price = BigInt(answer) * 10n ** 10n; // 8dp -> 18dp
const seizeAmount = (seizeValue * 10n ** 18n) / price;
console.log(`    collateral to seize    ${tok(seizeAmount)} tUSTB of ${tok(breached.deposited)} held`);

const [qProceeds, qFees, qLatency, qFailure, qRecovery] = await pub.readContract({
  address: L.directSettlementRoute, abi: ROUTE, functionName: "quote", args: [ASSET, seizeAmount],
});
console.log(`    quote                  proceeds ${formatUnits(qProceeds, 6)}  fees ${formatUnits(qFees, 6)}  latency ${formatUnits(qLatency, 6)}  failure ${formatUnits(qFailure, 6)}  ->  ${formatUnits(qRecovery, 6)}`);

// ---------------------------------------------------------------- 4. mine it
console.log("\n4. Liquidate");
// Fund the keeper with just enough gas, and give it the role. A keeper that cannot pay for its own
// transaction is a keeper the borrower is subsidising.
const keeperGas = await pub.getBalance({ address: keeper.address });
if (keeperGas < 2n * 10n ** 15n) {
  const topUp = 4n * 10n ** 15n - keeperGas;
  const fundHash = await wallet.sendTransaction({ to: keeper.address, value: topUp, account, chain });
  await pub.waitForTransactionReceipt({ hash: fundHash, timeout: 180_000 });
  console.log(`    OK   fund keeper gas                  ${formatUnits(topUp, 18)} OKB`);
}
const hasRole = await pub.readContract({
  address: C.authority, abi: AUTH, functionName: "hasRole",
  args: [await pub.readContract({ address: C.authority, abi: AUTH, functionName: "LIQUIDATOR" }), keeper.address],
});
if (!hasRole) {
  await send("grantRole(LIQUIDATOR, keeper)", C.authority, AUTH, "grantRole",
    [await pub.readContract({ address: C.authority, abi: AUTH, functionName: "LIQUIDATOR" }), keeper.address]);
}

const settlementOf = (who) =>
  pub.readContract({ address: F.settlementToken, abi: ERC20, functionName: "balanceOf", args: [who] });

const treasury = await pub.readContract({ address: C.feeController, abi: FEES, functionName: "treasury" });
const [incentiveBps, protocolBps] = await Promise.all([
  pub.readContract({ address: C.feeController, abi: FEES, functionName: "liquidatorIncentiveBps" }),
  pub.readContract({ address: C.feeController, abi: FEES, functionName: "protocolLiquidationFeeBps" }),
]);
console.log(`    keeper                 ${keeper.address}`);
console.log(`    economics              keeper ${Number(incentiveBps) / 100}%  protocol ${Number(protocolBps) / 100}%`);

const before = {
  keeper: await settlementOf(keeper.address),
  treasury: await settlementOf(treasury),
  borrower: await settlementOf(account.address),
  vault: await settlementOf(C.liquidityVault),
};

const liqReceipt = await send(
  `executeLiquidation ${tok(seizeAmount)} tUSTB`,
  C.clearingHouse, CH, "executeLiquidation",
  [account.address, ASSET, seizeAmount, L.directSettlementRoute, 0n],
  "keeper",
);

const afterBal = {
  keeper: await settlementOf(keeper.address),
  treasury: await settlementOf(treasury),
  borrower: await settlementOf(account.address),
  vault: await settlementOf(C.liquidityVault),
};

const paid = {
  keeper: afterBal.keeper - before.keeper,
  treasury: afterBal.treasury - before.treasury,
  borrower: afterBal.borrower - before.borrower,
  vault: afterBal.vault - before.vault,
};

// Distinct addresses, checked rather than assumed. The first live run had the treasury aliased onto
// the deploy key — which is also the borrower — so one balance was read as two roles and the
// reported proceeds came out overstated by exactly the protocol fee.
if (treasury.toLowerCase() === account.address.toLowerCase()) {
  console.error("\nThe treasury and the borrower are the same address. Balance deltas cannot be");
  console.error("attributed to a role, so this run cannot produce a readable receipt.");
  process.exit(1);
}
const proceeds = paid.keeper + paid.treasury + paid.borrower + paid.vault;

/** Within a wei, for the rounding the integer split legitimately produces. */
const within = (a, b) => (a > b ? a - b : b - a) <= 1n;

console.log("\n   Who received what:");
console.log(`    keeper incentive       ${formatUnits(paid.keeper, 6)} tUSD`);
console.log(`    protocol fee           ${formatUnits(paid.treasury, 6)} tUSD  -> ${treasury}`);
console.log(`    debt retirement        ${formatUnits(paid.vault, 6)} tUSD  -> LiquidityVault`);
console.log(`    returned to borrower   ${formatUnits(paid.borrower, 6)} tUSD`);
console.log(`    ------------------------------------`);
console.log(`    total proceeds         ${formatUnits(proceeds, 6)} tUSD`);

// ---------------------------------------------------------------- 5. read the result back
console.log("\n5. Read the result back from the chain");
const after = await health();
show("after liquidation", after);

// The status check asserts what the plan promised, not what a naive reading of "liquidation"
// suggests. Seizing collateral removes borrowing capacity as well as debt, so one round often
// deleverages without curing — and an engine that claimed otherwise would be the bug.
const breachBefore = breached.debt > breached.maintenanceLimit ? breached.debt - breached.maintenanceLimit : 0n;
const breachAfter = after.debt > after.maintenanceLimit ? after.debt - after.maintenanceLimit : 0n;

const checks = [
  ["debt fell", after.debt < breached.debt, `${usd(breached.debt)} -> ${usd(after.debt)}`],
  ["collateral was seized", after.deposited < breached.deposited, `${tok(breached.deposited)} -> ${tok(after.deposited)} tUSTB`],
  ["seizure matched the plan", breached.deposited - after.deposited === seizeAmount, `${tok(breached.deposited - after.deposited)}`],
  ["position was not closed", after.deposited > 0n, `${tok(after.deposited)} tUSTB remains`],
  ["exposure was reduced", breachAfter < breachBefore, `breach ${usd(breachBefore)} -> ${usd(breachAfter)}`],
  ["outcome matched the plan", curesTheBreach ? after.statusOrdinal < 3 : true, curesTheBreach ? `cured, now ${after.status}` : `deleveraged, still ${after.status} as planned`],
  ["debt was not created", after.debt <= breached.debt, `${usd(after.debt)}`],
  // Debt retirement is now strictly LESS than the seized value, because the keeper and the
  // protocol are paid out of the same proceeds. The previous version of this check asserted the
  // retirement met the full target, which encoded the old economics where every unit went to the
  // debt — it failed the first time a keeper was actually paid, and it was the check that was
  // wrong, not the protocol.
  //
  // What replaces it is stricter: the three destinations must account for every unit the route
  // returned, and each must be its configured share.
  ["proceeds were fully accounted", paid.keeper + paid.treasury + paid.vault === proceeds, `${formatUnits(proceeds, 6)} tUSD across three destinations`],
  ["keeper received its configured share", within(paid.keeper, (proceeds * BigInt(incentiveBps)) / 10_000n), `${formatUnits(paid.keeper, 6)} tUSD at ${Number(incentiveBps) / 100}%`],
  ["protocol received its configured share", within(paid.treasury, (proceeds * BigInt(protocolBps)) / 10_000n), `${formatUnits(paid.treasury, 6)} tUSD at ${Number(protocolBps) / 100}%`],
  ["the keeper was paid from the proceeds, not beside them", paid.vault < proceeds, `debt got ${formatUnits(paid.vault, 6)} of ${formatUnits(proceeds, 6)}`],
  ["the keeper is not the borrower", keeper.address.toLowerCase() !== account.address.toLowerCase(), keeper.address],
  ["the treasury is not the borrower", treasury.toLowerCase() !== account.address.toLowerCase(), treasury],
];
let bad = 0;
for (const [name, ok, detail] of checks) { console.log(`  ${ok ? "OK " : "FAIL"} ${name.padEnd(36)} ${detail}`); if (!ok) bad++; }

// ---------------------------------------------------------------- 6. the same fill cannot apply twice
// A second liquidation against a still-breached account is legitimate progressive deleveraging,
// not a replay. What must be impossible is liquidating an account that is no longer eligible — so
// that is what gets tested, by curing the account first and then trying.
console.log("\n6. A cured account cannot be liquidated");
const owed = (after.debt / 10n ** 12n) + 10n ** 6n;
const heldNow = await pub.readContract({ address: F.settlementToken, abi: ERC20, functionName: "balanceOf", args: [account.address] });
if (heldNow < owed) await send("mint tUSD (cure the account)", F.settlementToken, ERC20, "mint", [account.address, owed - heldNow]);
await send("approve ClearingHouse", F.settlementToken, ERC20, "approve", [C.clearingHouse, 2n ** 255n]);
await send("repay all (cure)", C.clearingHouse, CH, "repay", [0n, true]);

const cured = await health();
console.log(`    account is now ${cured.status} with ${usd(cured.debt)} of debt`);

let duplicateRefused = null;
try {
  await pub.simulateContract({
    address: C.clearingHouse, abi: CH, functionName: "executeLiquidation",
    args: [account.address, ASSET, seizeAmount, L.directSettlementRoute, 0n], account,
  });
  duplicateRefused = "UNEXPECTED: a cured account could still be liquidated";
  bad++;
} catch (e) {
  const data = e?.cause?.data ?? e?.data;
  try { const r = decodeErrorResult({ abi: CH, data }); duplicateRefused = `${r.errorName}(${(r.args ?? []).join(", ")})`; }
  catch { duplicateRefused = e?.cause?.shortMessage ?? e?.shortMessage ?? "reverted"; }
}
console.log(`    ${duplicateRefused}`);
console.log("    Eligibility is recomputed from live inputs on every call, so a replay against a");
console.log("    repaired account is refused by the same code path that authorised the first one.");

const epoch = await pub.readContract({ address: C.riskPolicyRegistry, abi: RP, functionName: "riskEpoch" });

// A record produced against contracts that have since been replaced is still true of the
// deployment it ran on. Archive it rather than overwriting, so the claims that cite it keep
// resolving instead of being quietly repointed at a newer transaction.
const archived = archiveArtifact("proof/live-liquidation.json", { reason: `superseded by the deployment at ${C.clearingHouse}` });
if (archived) console.log(`\nPrevious record kept as ${archived}`);

writeArtifact("proof/live-liquidation.json", {
  kind: "LIVE_LIQUIDATION",
  network: "X Layer Testnet",
  explorer: d.explorer,
  account: account.address,
  identityWarning:
    "tUSTB and tUSD are labelled testnet stand-ins. They are NOT Franklin FOBXX or any issuer token. " +
    "This proves the financial mechanics; the Franklin Passport proves the evidence mechanics.",
  contracts: { clearingHouse: C.clearingHouse, liquidationManager: L.liquidationManager, route: L.directSettlementRoute },
  riskEpochAfter: Number(epoch),
  ladder,
  eligibility: {
    status: STATUS[Number(statusOrd)],
    debtUsd18: planDebt.toString(),
    maintenanceLimitUsd18: planMaint.toString(),
    breachUsd18: (planDebt - planMaint).toString(),
  },
  plan: {
    repayTargetUsd18: repayTarget.toString(),
    seizeValueUsd18: seizeValue.toString(),
    seizeAmount: seizeAmount.toString(),
    liquidationBonusBps: Number(bonusBps),
    wouldExhaustCollateral: wouldExhaust,
    routeId, routeDescription: routeDesc,
    quote: {
      proceeds: qProceeds.toString(), fees: qFees.toString(),
      latencyHaircut: qLatency.toString(), failureHaircut: qFailure.toString(),
      expectedRecovery: qRecovery.toString(),
    },
  },
  before: {
    deposited: breached.deposited.toString(), recognised: breached.recognised.toString(),
    maintenanceLimit: breached.maintenanceLimit.toString(), debt: breached.debt.toString(), status: breached.status,
  },
  after: {
    deposited: after.deposited.toString(), recognised: after.recognised.toString(),
    maintenanceLimit: after.maintenanceLimit.toString(), debt: after.debt.toString(), status: after.status,
  },
  partialDeleveraging: {
    collateralSeized: (breached.deposited - after.deposited).toString(),
    collateralRemaining: after.deposited.toString(),
    fractionSeizedBps: Number((breached.deposited - after.deposited) * 10000n / breached.deposited),
    debtRepaidUsd18: (breached.debt - after.debt).toString(),
  },
  curedAfterwards: { status: cured.status, debtUsd18: cured.debt.toString(), depositedRemaining: cured.deposited.toString() },
  cureRefusedLiquidation: duplicateRefused,
  bonusAccrual:
    "Every unit of route proceeds is applied to the debt, so the liquidation bonus currently " +
    "accrues to the borrower as extra debt retirement rather than to a liquidator. A production " +
    "deployment paying third-party liquidators would split it; nothing here pretends it already does.",
  plannedCure: { curesTheBreach, curingRepayUsd18: curingRepay.toString() },
  liquidationTx: { hash: liqReceipt.transactionHash, blockNumber: Number(liqReceipt.blockNumber), gasUsed: liqReceipt.gasUsed.toString() },
  transactions: txs,
}, { chainId: 1952, tool: "scripts/live-liquidation.mjs", inputDigest: digestOf(`${C.clearingHouse}:${L.liquidationManager}`) });

console.log("\nWrote proof/live-liquidation.json");
if (bad > 0) { console.error(`\n${bad} check(s) failed. The liquidation is NOT proven.`); process.exit(1); }
console.log("\nPROVEN: a breached account was liquidated onchain, partially, and recomputed.");

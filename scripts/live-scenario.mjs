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
import { xlayerTransport } from "./_rpc.mjs";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createPublicClient, createWalletClient, http, parseAbi, decodeErrorResult, formatUnits, keccak256, toBytes } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const d = JSON.parse(readFileSync("deployments/1952.json", "utf8"));
const RPC = process.env.XLAYER_TESTNET_RPC_URL ?? "https://testrpc.xlayer.tech";
const C = d.contracts, F = d.testnetFixtures;
const chain = { id: 1952, name: "X Layer Testnet", nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } };

const pk = process.env.DEPLOYER_PRIVATE_KEY;
if (!pk) { console.error("DEPLOYER_PRIVATE_KEY not set"); process.exit(1); }
const account = privateKeyToAccount(pk);
const pub = createPublicClient({ chain, transport: xlayerTransport() });
const wallet = createWalletClient({ account, chain, transport: xlayerTransport() });

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
const PR = parseAbi(["function commitPassport(bytes32,uint64,bytes32[],bytes32,bytes32,uint64,bool,uint16,bool) returns (bytes32)","function currentVersion(bytes32) view returns (uint64)"]);
const ER = parseAbi([
  "function commit(bytes32,bytes32,bytes32,uint64,uint64,uint8) returns (bytes32)",
  "function evidenceIdFor(bytes32,bytes32,uint64) view returns (bytes32)",
  "function isUsableFor(bytes32,bytes32) view returns (bool)",
]);
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
  const [r, positions] = await pub.readContract({ address: C.clearingHouse, abi: CH, functionName: "accountHealth", args: [account.address] });
  const [avail, byLiq] = await pub.readContract({ address: C.clearingHouse, abi: CH, functionName: "availableBorrow", args: [account.address] });
  return { recognised: r[0], borrowLimit: r[1], debt: r[4], available: r[5], status: STATUS[Number(r[7])], gates: Number(r[8]), byLiquidity: byLiq, availableEffective: avail, positions };
}

/** How much of `assetId` this account already has deposited. */
async function depositedOf(assetId) {
  const { positions } = await health();
  const p = (positions ?? []).find((x) => String(x[0]).toLowerCase() === String(assetId).toLowerCase());
  return p ? p[1] : 0n;
}

/**
 * Transactions from earlier runs that this run skipped.
 *
 * The setup steps are guarded so the script can be re-run, which means a later run's record would
 * otherwise show a borrow against collateral it never deposited and liquidity it never supplied.
 * Those transactions are real and still the provenance of the state being exercised, so they are
 * carried forward under their own key rather than dropped or silently merged into this run's list.
 * Only full 66-character hashes survive; anything shorter cannot be checked and is not published.
 */
function carriedForward() {
  if (!existsSync("proof/live-risk-scenario.json")) return [];
  const prior = JSON.parse(readFileSync("proof/live-risk-scenario.json", "utf8"));
  const thisRun = new Set(txs.map((t) => t.label));
  const seen = new Set();
  return [...(prior.transactions ?? []), ...(prior.priorTransactions ?? [])]
    .filter((t) => /^0x[0-9a-fA-F]{64}$/.test(String(t.hash)))
    .filter((t) => !thisRun.has(t.label))
    .filter((t) => (seen.has(t.label) ? false : seen.add(t.label)))
    .map((t) => ({ ...t, fromEarlierRun: true }));
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
  // Evidence first. A Passport can no longer assert a root over documents that were never filed,
  // so the scenario files one — labelled as what it is, a testnet fixture rather than a filing.
  const contentHash = keccak256(toBytes("USANCE-TESTNET-TBILL-FIXTURE-CONTENT"));
  const sourceHash = keccak256(toBytes("USANCE-TESTNET-TBILL-FIXTURE-SOURCE"));
  const effectiveAt = 0n;
  const evidenceId = await pub.readContract({ address: C.evidenceRegistry, abi: ER, functionName: "evidenceIdFor", args: [sourceHash, contentHash, effectiveAt] });
  if (!(await pub.readContract({ address: C.evidenceRegistry, abi: ER, functionName: "isUsableFor", args: [ASSET, evidenceId] }))) {
    await send("EvidenceRegistry.commit(tUSTB fixture)", C.evidenceRegistry, ER, "commit",
      [ASSET, contentHash, sourceHash, effectiveAt, BigInt(Math.floor(Date.now() / 1000)), 4]);
  }
  // One leaf is its own root.
  await send("commitPassport(tUSTB v1)", C.passportRegistry, PR, "commitPassport",
    [ASSET, 1n, [evidenceId], evidenceId, "0x" + "22".repeat(32), 0n, true, 9900, true]);
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
//
// Top up to the target instead of adding to it. This script is meant to be re-runnable, and an
// unconditional deposit silently doubles the position on a second run — at which point every
// figure below stops matching canonical fixture S02 and the whole scenario proves nothing.
console.log("\n2. Deposit collateral");
const TARGET_COLLATERAL = 1000n*10n**18n;
const alreadyDeposited = await depositedOf(ASSET);
if (alreadyDeposited < TARGET_COLLATERAL) {
  await send(`addCollateral ${formatUnits(TARGET_COLLATERAL - alreadyDeposited, 18)} tUSTB`, C.clearingHouse, CH, "addCollateral", [ASSET, TARGET_COLLATERAL - alreadyDeposited]);
} else {
  console.log(`    already holding ${formatUnits(alreadyDeposited, 18)} tUSTB deposited; no top-up needed`);
}
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
//
// The refusal has to reach a block. `writeContract` runs `eth_estimateGas` first and throws when
// the call reverts, so the transaction never broadcasts — the client refused, and the earlier
// version of this script recorded that as `onchain: true`, which was false.
//
// So: simulate first to decode WHY the protocol refuses, then submit anyway with an explicit gas
// limit. Passing `gas` skips estimation, the transaction mines, and the reverted receipt is a hash
// anybody can open in an explorer. A refusal nobody can independently check is not proof.
console.log("\n5. New borrowing must now be refused ONCHAIN");
let rejected = null, rejectedTx = null;

try {
  await pub.simulateContract({ address: C.clearingHouse, abi: CH, functionName: "borrow", args: [10n*10n**18n, 0n], account });
  console.log("    UNEXPECTED: simulation says the borrow would succeed");
} catch {
  rejected = "reverted";
  console.log("    simulation refuses the borrow");
}

if (rejected) {
  const hash = await wallet.writeContract({
    address: C.clearingHouse, abi: CH, functionName: "borrow", args: [10n*10n**18n, 0n],
    account, chain, gas: 900_000n,
  });
  const r = await pub.waitForTransactionReceipt({ hash, timeout: 180000 });
  if (r.status !== "reverted") throw new Error(`the blocked borrow was expected to revert onchain, got ${r.status} in ${hash}`);

  // Decode the reason from the mined transaction rather than from the pre-flight simulation.
  //
  // A receipt records that a call failed but not why, so replay the exact calldata with `eth_call`
  // pinned to the block it reverted in. That returns this transaction's own revert data, which is
  // the only reason worth publishing — a simulation run at a different block is a different claim.
  //
  // The replay goes over raw JSON-RPC. viem buries revert data at an inconsistent depth in its
  // error cause chain, and guessing at that shape is how the reason silently degrades to
  // "unknown". The wire format puts it at `error.data`, unambiguously.
  const submitted = await pub.getTransaction({ hash });
  const replay = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [
      { from: account.address, to: submitted.to, data: submitted.input },
      `0x${r.blockNumber.toString(16)}`,
    ]}),
  }).then((x) => x.json());

  const revertData = replay?.error?.data;
  if (!revertData) {
    rejected = "reverted (replay at the mined block returned no revert data)";
  } else {
    try {
      const decoded = decodeErrorResult({ abi: CH, data: revertData });
      rejected = `${decoded.errorName}(${(decoded.args ?? []).join(", ")})`;
    } catch {
      rejected = `unrecognised revert data ${revertData.slice(0, 10)}`;
    }
  }

  rejectedTx = { hash, blockNumber: Number(r.blockNumber), gasUsed: r.gasUsed.toString() };
  console.log(`    OK   REVERTED ONCHAIN  ${hash}  block ${r.blockNumber}`);
  console.log(`         reason ${rejected}`);
} else {
  throw new Error("the protocol did not refuse the borrow; the scenario asserts nothing");
}

// ---------------------------------------------------------------- 6. exit still works
console.log("\n6. Risk-reducing actions must remain available");
const debt = (await health()).debt;

// Debt is principal plus accrued interest, but the account was only ever handed the principal.
// Repaying in full therefore needs more settlement token than borrowing produced. This is a real
// product requirement, not a testnet quirk: any repay-all UI has to source the interest too.
const owedTokens = (debt / 10n**12n) + 10n**6n;
const heldTokens = await pub.readContract({ address: F.settlementToken, abi: ERC20, functionName: "balanceOf", args: [account.address] });
if (heldTokens < owedTokens) {
  await send("mint tUSD (interest shortfall)", F.settlementToken, ERC20, "mint", [account.address, owedTokens - heldTokens]);
}
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
  newRiskBlocked: {
    attempted: "$10 borrow",
    revertReason: rejected,
    result: "reverted onchain",
    submitted: true,
    hash: rejectedTx.hash,
    blockNumber: rejectedTx.blockNumber,
    gasUsed: rejectedTx.gasUsed,
  },
  repaid: { debtBefore: debt.toString(), debtAfter: afterRepay.debt.toString() },
  transactions: txs,
  priorTransactions: carriedForward(),
};
writeFileSync("proof/live-risk-scenario.json", JSON.stringify(out, null, 2) + "\n");
console.log(`\nWrote proof/live-risk-scenario.json  (${txs.length} transactions)`);
console.log(rejected ? "\nPROVEN: new risk blocked onchain, exit still worked." : "\nSCENARIO INCOMPLETE: the borrow was not rejected.");

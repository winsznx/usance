#!/usr/bin/env node
/**
 * A delegated action on X Layer testnet, performed by an agent that is not the owner.
 *
 *   node scripts/live-mandate.mjs
 *
 * The claim being proved is narrow and load-bearing:
 *
 *     a delegated agent can reduce risk, and cannot withdraw collateral
 *
 * Both halves are mined. The permitted repayment lands, and the attempted withdrawal is sent with
 * an explicit gas limit so it reaches a block and reverts there — a revert caught at estimation is
 * the same contract refusing, but it is not a transaction anybody can look up, and this repository
 * has already made that mistake once.
 *
 * Owner and agent are distinct addresses. Running both roles from one key would prove nothing about
 * delegation at all. The agent's key is derived from the deployer's so the scenario reproduces from
 * one secret, and it is funded with only enough OKB to send its own transactions.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  createPublicClient, createWalletClient, parseAbi, formatUnits,
  keccak256, stringToBytes, encodeAbiParameters, decodeErrorResult,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { xlayerTransport } from "./_rpc.mjs";
import { repoRoot, writeArtifact, archiveArtifact, digestOf } from "./_artifact.mjs";

const d = JSON.parse(readFileSync(resolve(repoRoot, "deployments/1952.json"), "utf8"));
const C = d.contracts, F = d.testnetFixtures;

if (!C.mandateRegistry || !C.delegationGateway) {
  console.error("This deployment has no MandateRegistry or DelegationGateway. Redeploy first.");
  process.exit(1);
}

const pk = process.env.DEPLOYER_PRIVATE_KEY;
if (!pk) { console.error("DEPLOYER_PRIVATE_KEY not set"); process.exit(1); }

const chain = { id: 1952, name: "X Layer Testnet", nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 }, rpcUrls: { default: { http: [] } } };
const owner = privateKeyToAccount(pk);
const agentPk = keccak256(stringToBytes(`usance-mandate-agent/${pk.slice(2, 10)}`));
const agent = privateKeyToAccount(agentPk);

const pub = createPublicClient({ chain, transport: xlayerTransport() });
const ownerWallet = createWalletClient({ account: owner, chain, transport: xlayerTransport() });
const agentWallet = createWalletClient({ account: agent, chain, transport: xlayerTransport() });

const ERC20 = parseAbi(["function mint(address,uint256)", "function approve(address,uint256) returns (bool)", "function balanceOf(address) view returns (uint256)"]);
const CH = parseAbi([
  "function debtOf(address) view returns (uint256)",
  "function addCollateral(bytes32,uint256)",
  "function borrow(uint256,uint64)",
  "function withdrawCollateral(bytes32,uint256)",
]);
const GW = parseAbi([
  "function execute(address,bytes32,uint8,bytes32,uint256,bytes32,bytes32[],bytes32[]) returns (uint256)",
  "error ActionNotDelegable(uint8)",
  "error AgentIsNotTheAccount()",
]);
const MR = parseAbi([
  "function accountIdFor(address) view returns (bytes32)",
  "function mandateIdFor(address,uint256) view returns (bytes32)",
  "function leafFor(bytes32) view returns (bytes32)",
  "function mandateDigest((address,address,bytes32,uint64,uint64,uint256,uint256,uint16,uint16,uint16,uint64,bytes32,bytes32,uint256)) view returns (bytes32)",
  "function registerMandate((address,address,bytes32,uint64,uint64,uint256,uint256,uint16,uint16,uint16,uint64,bytes32,bytes32,uint256), bytes) returns (bytes32)",
  "function revokeMandate(bytes32,bytes32)",
  "function isLive(bytes32) view returns (bool)",
]);

const txs = [];
const usd = (v) => `$${Number(formatUnits(v, 18)).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

/**
 * Read at a specific block.
 *
 * The RPC endpoint is load-balanced, so a read issued immediately after a receipt can land on a node
 * that has not applied the block yet — and it answers with pre-transaction state rather than
 * erroring. That produced a run where a repayment visibly succeeded, the agent's balance visibly
 * fell, and the script reported the debt as unchanged. Pinning post-state reads to the block the
 * transaction landed in removes the race entirely.
 */
async function readAt(blockNumber, address, abi, functionName, args) {
  return pub.readContract({ address, abi, functionName, args, blockNumber });
}

async function send(label, to, abi, functionName, args, as = "owner") {
  const signer = as === "agent" ? agentWallet : ownerWallet;
  const from = as === "agent" ? agent : owner;
  const hash = await signer.writeContract({ address: to, abi, functionName, args, account: from, chain });
  const r = await pub.waitForTransactionReceipt({ hash, timeout: 180_000 });
  console.log(`    ${r.status === "success" ? "OK  " : "FAIL"} ${label.padEnd(36)} ${hash.slice(0, 18)}…  block ${r.blockNumber}`);
  txs.push({ label, hash, blockNumber: Number(r.blockNumber), status: r.status, from: from.address });
  if (r.status !== "success") throw new Error(`${label} reverted`);
  return r;
}

console.log("\nUSANCE LIVE DELEGATED AUTHORITY — X Layer testnet (1952)");
console.log(`owner ${owner.address}`);
console.log(`agent ${agent.address}`);
console.log("\nNOTE: tUSTB and tUSD are labelled TEST assets, not any issuer's token.\n");

// ---------------------------------------------------------------- 0. fund the agent
const agentGas = await pub.getBalance({ address: agent.address });
if (agentGas < 3n * 10n ** 15n) {
  const hash = await ownerWallet.sendTransaction({ to: agent.address, value: 6n * 10n ** 15n - agentGas, account: owner, chain });
  await pub.waitForTransactionReceipt({ hash, timeout: 180_000 });
  console.log(`    OK   fund agent gas`);
}

// ---------------------------------------------------------------- 1. a position with debt
console.log("1. Owner opens a financed position");
const ASSET = F.collateralAssetId;
const held = await pub.readContract({ address: F.collateralToken, abi: ERC20, functionName: "balanceOf", args: [owner.address] });
if (held < 1_000n * 10n ** 18n) await send("mint tUSTB", F.collateralToken, ERC20, "mint", [owner.address, 5_000n * 10n ** 18n]);
await send("approve CollateralVault", F.collateralToken, ERC20, "approve", [C.collateralVault, 2n ** 255n]);
await send("addCollateral 1000 tUSTB", C.clearingHouse, CH, "addCollateral", [ASSET, 1_000n * 10n ** 18n]);
if ((await pub.readContract({ address: C.clearingHouse, abi: CH, functionName: "debtOf", args: [owner.address] })) === 0n) {
  await send("borrow $200", C.clearingHouse, CH, "borrow", [200n * 10n ** 18n, 0n]);
}
const head = await pub.getBlockNumber();
const debtBefore = await readAt(head, C.clearingHouse, CH, "debtOf", [owner.address]);
console.log(`    debt ${usd(debtBefore)}`);

// ---------------------------------------------------------------- 2. sign a bounded mandate
console.log("\n2. Owner signs a mandate: this agent may REPAY, nothing else");
const accountId = await pub.readContract({ address: C.mandateRegistry, abi: MR, functionName: "accountIdFor", args: [owner.address] });
const assetLeaf = await pub.readContract({ address: C.mandateRegistry, abi: MR, functionName: "leafFor", args: [ASSET] });
const now = BigInt(Math.floor(Date.now() / 1000));

const REPAY_BIT = 1 << 1;
const mandate = [
  owner.address, agent.address, accountId,
  now - 60n, now + 86_400n,
  5_000n * 10n ** 18n, 10_000n * 10n ** 18n,
  30_000, 50, REPAY_BIT,
  604_800n, assetLeaf, assetLeaf, now,
];

const digest = await pub.readContract({ address: C.mandateRegistry, abi: MR, functionName: "mandateDigest", args: [mandate] });
// `sign`, not `signMessage`. signMessage applies the EIP-191 personal-sign prefix, which is right
// for a human-readable message and wrong for a digest the contract already built with EIP-712 —
// the recovered address comes out as somebody else entirely and registerMandate reverts on it.
const signature = await owner.sign({ hash: digest });

const reg = await send("registerMandate", C.mandateRegistry, MR, "registerMandate", [mandate, signature]);
// Read from the contract rather than recomputed here. Two derivations of the same identity is one
// derivation that will eventually disagree.
const mandateId = await pub.readContract({
  address: C.mandateRegistry, abi: MR, functionName: "mandateIdFor", args: [owner.address, now],
});
console.log(`    mandate covers REPAY only, expires in 24h`);

// ---------------------------------------------------------------- 3. the agent reduces risk
console.log("\n3. The agent repays on the owner's behalf");
const agentFunds = await pub.readContract({ address: F.settlementToken, abi: ERC20, functionName: "balanceOf", args: [agent.address] });
if (agentFunds < 100n * 10n ** 6n) await send("mint tUSD to agent", F.settlementToken, ERC20, "mint", [agent.address, 1_000n * 10n ** 6n]);
await send("agent approves ClearingHouse", F.settlementToken, ERC20, "approve", [C.clearingHouse, 2n ** 255n], "agent");

const NO_VENUE = `0x${"00".repeat(32)}`;
const repayReceipt = await send(
  "gateway.execute(REPAY $50)", C.delegationGateway, GW, "execute",
  [owner.address, mandateId, 1, ASSET, 50n * 10n ** 18n, NO_VENUE, [], []],
  "agent",
);
const debtAfter = await readAt(repayReceipt.blockNumber, C.clearingHouse, CH, "debtOf", [owner.address]);
console.log(`    debt ${usd(debtBefore)} -> ${usd(debtAfter)}`);

// ---------------------------------------------------------------- 4. the agent cannot withdraw
console.log("\n4. The same agent attempts to take collateral. It must be refused ONCHAIN.");
let refusal = null;
try {
  const hash = await agentWallet.writeContract({
    address: C.delegationGateway, abi: GW, functionName: "execute",
    args: [owner.address, mandateId, 5, ASSET, 1n * 10n ** 18n, NO_VENUE, [], []],
    account: agent, chain, gas: 900_000n, // explicit, so the refusal is mined rather than estimated
  });
  const r = await pub.waitForTransactionReceipt({ hash, timeout: 180_000 });
  refusal = { hash, blockNumber: Number(r.blockNumber), status: r.status };
  console.log(`    ${r.status === "reverted" ? "OK  " : "UNEXPECTED"} refused onchain  ${hash}  block ${r.blockNumber}`);
  txs.push({ label: "agent attempts collateral outflow", hash, blockNumber: Number(r.blockNumber), status: r.status, from: agent.address });
} catch (e) {
  const data = e?.cause?.data ?? e?.data;
  let decoded = "reverted";
  try { const x = decodeErrorResult({ abi: CH, data }); decoded = `${x.errorName}(${(x.args ?? []).join(", ")})`; } catch {}
  refusal = { hash: null, decoded, submitted: false };
  console.log(`    OK   refused before submission: ${decoded}`);
}

// ---------------------------------------------------------------- 5. revoke, then try again
//
// The half that proves delegation can be taken back. Everything above shows an agent acting inside
// limits; without this it shows a grant with no exit, which is the version of delegated authority
// nobody should accept.
console.log("\n5. Owner revokes the mandate, and the same agent tries the same permitted action");

const liveBefore = await pub.readContract({ address: C.mandateRegistry, abi: MR, functionName: "isLive", args: [mandateId] });
console.log(`    mandate live before revocation: ${liveBefore}`);

const revokeReceipt = await send(
  "revokeMandate", C.mandateRegistry, MR, "revokeMandate",
  [mandateId, keccak256(stringToBytes("owner ended the delegation"))],
);

const liveAfter = await readAt(revokeReceipt.blockNumber, C.mandateRegistry, MR, "isLive", [mandateId]);
console.log(`    mandate live after revocation:  ${liveAfter}`);

const debtBeforeRetry = await readAt(revokeReceipt.blockNumber, C.clearingHouse, CH, "debtOf", [owner.address]);

let postRevocation = null;
try {
  const hash = await agentWallet.writeContract({
    address: C.delegationGateway, abi: GW, functionName: "execute",
    args: [owner.address, mandateId, 1, ASSET, 10n * 10n ** 18n, NO_VENUE, [], []],
    account: agent, chain,
    // Explicit, so the refusal is mined rather than caught at estimation. A revert nobody can look
    // up is not proof that the protocol refused anything.
    gas: 900_000n,
  });
  const r = await pub.waitForTransactionReceipt({ hash, timeout: 180_000 });
  postRevocation = { hash, blockNumber: Number(r.blockNumber), status: r.status };
  console.log(`    ${r.status === "reverted" ? "OK  " : "UNEXPECTED"} refused onchain  ${hash}  block ${r.blockNumber}`);
  txs.push({ label: "agent retries after revocation", hash, blockNumber: Number(r.blockNumber), status: r.status, from: agent.address });
} catch (e) {
  const data = e?.cause?.data ?? e?.data;
  let decoded = "reverted";
  try { const x = decodeErrorResult({ abi: GW, data }); decoded = `${x.errorName}(${(x.args ?? []).join(", ")})`; } catch {}
  postRevocation = { hash: null, decoded, submitted: false };
  console.log(`    refused before submission: ${decoded}`);
}

const debtAfterRetry = postRevocation?.blockNumber
  ? await readAt(BigInt(postRevocation.blockNumber), C.clearingHouse, CH, "debtOf", [owner.address])
  : debtBeforeRetry;
console.log(`    debt after the refused attempt: ${usd(debtBeforeRetry)} -> ${usd(debtAfterRetry)}`);
console.log(`    difference is accrued interest only: ${debtAfterRetry - debtBeforeRetry} wei`);

const results = {
  kind: "LIVE_DELEGATED_AUTHORITY",
  chainId: 1952,
  clearingHouse: C.clearingHouse,
  mandateRegistry: C.mandateRegistry,
  delegationGateway: C.delegationGateway,
  owner: owner.address,
  agent: agent.address,
  identityWarning:
    "tUSTB and tUSD are labelled testnet stand-ins, not any issuer's token. This proves the "
    + "authority mechanics; the Franklin Passport proves the evidence mechanics.",
  debtBefore: debtBefore.toString(),
  debtAfter: debtAfter.toString(),
  mandate: { actions: ["REPAY"], expiresInSeconds: 86_400 },
  withdrawalRefusal: refusal,
  revocation: {
    liveBefore,
    liveAfter,
    revokeTx: revokeReceipt.transactionHash ?? null,
    postRevocationAttempt: postRevocation,
    debtBeforeRetry: debtBeforeRetry.toString(),
    debtAfterRetry: debtAfterRetry.toString(),
    note:
      "Revocation is terminal: MandateRegistry has no un-revoke function on any path. The retry "
      + "was submitted with an explicit gas limit so the refusal was mined rather than estimated.",
  },
  transactions: txs,
};

const archived = archiveArtifact("proof/live-delegated.json", { reason: `superseded by ${C.clearingHouse}` });
if (archived) console.log(`\nPrevious record kept as ${archived}`);
writeArtifact("proof/live-delegated.json", results, {
  chainId: 1952, tool: "scripts/live-mandate.mjs", inputDigest: digestOf(C.clearingHouse),
});

// Both halves, and the refusal has to have been mined rather than merely estimated.
const checks = [
  ["a delegated agent reduced the owner's debt", debtAfter < debtBefore],
  ["the same agent could not take collateral", refusal?.status === "reverted"],
  ["the mandate was live before revocation", liveBefore === true],
  ["the mandate is not live after revocation", liveAfter === false],
  ["the revoked agent's retry was refused onchain", postRevocation?.status === "reverted"],
  // Not equality. Sixty-five blocks pass between the revocation and the retry, and interest
  // accrues over them — asserting the debt is unchanged asserts that interest does not exist. What
  // a refused repayment must not do is REDUCE the debt, and the residual must be dust rather than a
  // partially-applied payment.
  ["the refused retry did not reduce the debt", debtAfterRetry >= debtBeforeRetry],
  ["the refused retry moved only accrued interest", debtAfterRetry - debtBeforeRetry < 10n ** 15n],
];
console.log("");
let bad = 0;
for (const [name, pass] of checks) { console.log(`  ${pass ? "OK  " : "FAIL"} ${name}`); if (!pass) bad++; }

const ok = bad === 0;
console.log(`\n${ok ? "PROVEN: an owner delegated, the agent acted within limits, the owner revoked, and the agent's authority ended." : `NOT PROVEN — ${bad} check(s) failed`}`);
process.exit(ok ? 0 : 1);

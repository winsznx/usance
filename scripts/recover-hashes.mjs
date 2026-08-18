/**
 * Recover full transaction hashes for `proof/live-risk-scenario.json`.
 *
 * Fifteen of that file's entries carry 18-character hashes. They were reconstructed from console
 * output that printed `hash.slice(0,18)`, so the record is a truthful prefix of a real transaction
 * but not something a reader can paste into an explorer.
 *
 * Zero-padding them to 66 characters would produce a link that resolves to nothing — a fabricated
 * hash wearing the shape of a real one. So this script goes back to the chain instead. Each entry
 * names a block; a 16-hex-character prefix inside one block is unambiguous, and the recovered hash
 * is checked to start with the recorded prefix before it is written.
 *
 * Anything that cannot be recovered stays truncated and is marked `hashTruncated: true`, which the
 * UI renders as plain text rather than a link.
 */
import { createPublicClient, http } from "viem";
import { readFileSync, writeFileSync } from "node:fs";

const RPC = process.env.XLAYER_TESTNET_RPC_URL ?? "https://testrpc.xlayer.tech";
const chain = { id: 1952, name: "X Layer Testnet", nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } };
const pub = createPublicClient({ chain, transport: http(RPC, { retryCount: 6, retryDelay: 2000, timeout: 60_000 }) });

const path = "proof/live-risk-scenario.json";
const doc = JSON.parse(readFileSync(path, "utf8"));
const account = String(doc.account).toLowerCase();

let recovered = 0, already = 0, failed = 0;

for (const t of [...doc.transactions, ...(doc.priorTransactions ?? [])]) {
  const hash = String(t.hash);
  if (hash.length === 66) { already++; t.blockNumber ??= t.block; delete t.block; continue; }

  const blockNumber = BigInt(t.block ?? t.blockNumber);
  let match = null;
  try {
    const block = await pub.getBlock({ blockNumber, includeTransactions: true });
    const hits = block.transactions.filter((tx) => tx.hash.startsWith(hash));
    if (hits.length === 1) match = hits[0].hash;
    else if (hits.length > 1) console.log(`  AMBIGUOUS ${t.label}: ${hits.length} candidates in block ${blockNumber}`);
  } catch (e) {
    console.log(`  RPC FAILED ${t.label}: ${e.shortMessage ?? e.message}`);
  }

  if (match) {
    if (!match.startsWith(hash)) throw new Error(`recovered hash does not extend the recorded prefix for ${t.label}`);
    const receipt = await pub.getTransactionReceipt({ hash: match });
    t.hash = match;
    t.blockNumber = Number(receipt.blockNumber);
    t.status = receipt.status;
    delete t.block;
    delete t.hashTruncated;
    recovered++;
    console.log(`  OK  ${t.label.padEnd(34)} ${match}`);
  } else {
    t.hashTruncated = true;
    t.blockNumber = Number(blockNumber);
    delete t.block;
    failed++;
    console.log(`  KEPT TRUNCATED  ${t.label}`);
  }
}

// The rejected borrow was submitted and reverted but no hash was recorded. Look for it between the
// epoch bump that caused the deterioration and the next recorded transaction.
if (doc.newRiskBlocked && !doc.newRiskBlocked.hash) {
  const bump = doc.transactions.find((t) => String(t.label).includes("bumpEpoch"));
  const next = doc.transactions.find((t) => String(t.label).includes("approve ClearingHouse"));
  if (bump && next) {
    const from = BigInt(bump.blockNumber), to = BigInt(next.blockNumber);
    console.log(`\nSearching blocks ${from}..${to} for the rejected borrow`);
    for (let b = from; b <= to && !doc.newRiskBlocked.hash; b++) {
      const block = await pub.getBlock({ blockNumber: b, includeTransactions: true });
      for (const tx of block.transactions) {
        if (tx.from.toLowerCase() !== account) continue;
        const r = await pub.getTransactionReceipt({ hash: tx.hash });
        if (r.status === "reverted") {
          doc.newRiskBlocked.hash = tx.hash;
          doc.newRiskBlocked.blockNumber = Number(r.blockNumber);
          console.log(`  FOUND rejected borrow ${tx.hash} block ${r.blockNumber}`);
          break;
        }
      }
    }
    if (!doc.newRiskBlocked.hash) console.log("  not found in range; leaving unhashed");
  }
}

writeFileSync(path, JSON.stringify(doc, null, 2) + "\n");
console.log(`\n${recovered} recovered, ${already} already full, ${failed} still truncated`);

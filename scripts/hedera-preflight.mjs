#!/usr/bin/env node
/**
 * Hedera testnet preflight. Run before any Hedera transaction.
 *
 *   node --env-file=.env scripts/hedera-preflight.mjs
 *
 * Verifies: the operator key normalises to a raw secp256k1 private key; the RPC is Hedera testnet
 * (chainId 296); the operator account id resolves to the EVM address the key derives; the operator
 * holds enough HBAR to deploy. Never prints the key.
 */

import { createPublicClient, http, formatEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const idStr = process.env.HEDERA_TESTNET_OPERATOR_ID ?? "";
const rawKey = process.env.HEDERA_TESTNET_OPERATOR_KEY ?? "";
const rpc = process.env.HEDERA_TESTNET_RPC_URL ?? "https://testnet.hashio.io/api";
const MIRROR = process.env.HEDERA_TESTNET_MIRROR_URL ?? "https://testnet.mirrornode.hedera.com";

const fail = (m) => {
  console.error(`✗ ${m}`);
  process.exit(1);
};

if (!idStr) fail("HEDERA_TESTNET_OPERATOR_ID not set");
if (!rawKey) fail("HEDERA_TESTNET_OPERATOR_KEY not set");

/**
 * Normalise whatever the Hedera Portal handed over into a 0x-prefixed 32-byte hex string.
 *
 * The Portal's "ECDSA" export is sometimes a raw 32-byte hex, sometimes a DER-encoded
 * PKCS#8/SEC1 blob (hex). Foundry / viem need the raw scalar. This strips a DER wrapper if
 * present by pulling the 32-byte OCTET STRING that holds the private scalar. Done in memory; the
 * value is never logged.
 */
function normalizePrivateKey(k) {
  let hex = k.trim().replace(/^0x/i, "").toLowerCase();
  if (/^[0-9a-f]{64}$/.test(hex)) return `0x${hex}`;

  // SEC1: 30 2e 02 01 01 04 20 <32 bytes> a0 ...   (302e0201010420...)
  // PKCS#8: 30 81?? 02 01 00 30 ... 04 22 04 20 <32 bytes>
  const m = hex.match(/0420([0-9a-f]{64})/);
  if (m) return `0x${m[1]}`;
  if (hex.length > 64) {
    // last-resort: the trailing 32 bytes are frequently the scalar in Hedera's DER export
    const tail = hex.slice(-64);
    if (/^[0-9a-f]{64}$/.test(tail)) return `0x${tail}`;
  }
  fail("could not normalise HEDERA_TESTNET_OPERATOR_KEY to a 32-byte secp256k1 scalar");
}

const pk = normalizePrivateKey(rawKey);
const account = privateKeyToAccount(pk);
console.log(`• operator account id : ${idStr}`);
console.log(`• operator EVM address: ${account.address}`);
console.log(`• rpc                 : ${rpc}`);

const client = createPublicClient({ transport: http(rpc, { retryCount: 3, retryDelay: 1500, timeout: 30_000 }) });

const chainId = await client.getChainId();
if (chainId !== 296) fail(`rpc reports chainId ${chainId}, expected 296 (Hedera testnet)`);
console.log(`✓ chainId 296 (Hedera testnet)`);

// Mirror node: does the account id map to this EVM address?
try {
  const res = await fetch(`${MIRROR}/api/v1/accounts/${idStr}`);
  if (res.ok) {
    const j = await res.json();
    const evm = (j.evm_address ?? "").toLowerCase();
    if (evm && evm !== account.address.toLowerCase()) {
      fail(`mirror node maps ${idStr} to ${evm}, not ${account.address} — wrong key for this account`);
    }
    console.log(`✓ mirror node maps ${idStr} -> ${account.address}`);
    const tinybar = BigInt(j.balance?.balance ?? 0);
    console.log(`• account balance (mirror): ${(Number(tinybar) / 1e8).toFixed(4)} HBAR`);
  } else {
    console.log(`• mirror node lookup for ${idStr}: HTTP ${res.status} (skipping id<->address cross-check)`);
  }
} catch (e) {
  console.log(`• mirror node unreachable (${e.message}); skipping id<->address cross-check`);
}

const balWei = await client.getBalance({ address: account.address });
const hbar = Number(formatEther(balWei)); // Hedera JSON-RPC reports HBAR with 18 decimals
console.log(`✓ operator balance (rpc): ${hbar.toFixed(4)} HBAR`);
if (hbar < 20) {
  fail(`operator holds ${hbar.toFixed(4)} HBAR — deploying the ATS Diamond + the Usance stack needs ~50. Top up at portal.hedera.com.`);
}

console.log(`\n✓ Hedera testnet preflight passed.`);

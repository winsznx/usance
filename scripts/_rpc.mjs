/**
 * Transport policy for every script that talks to X Layer.
 *
 * Two endpoints, not one. The public testnet RPC drops DNS resolution for stretches at a time, and
 * viem's `retryCount` does not cover `ENOTFOUND` — a name that will not resolve is not a request
 * that failed, so the retry logic never sees it. That killed a twenty-minute extraction run on the
 * very first `eth_call` after the model work was already done.
 *
 * `fallback` moves to the next transport on any error, including that one. Both endpoints serve
 * chain 1952 and are checked to agree on chain id before either is used for anything.
 */
import { fallback, http } from "viem";

export const XLAYER_TESTNET_RPCS = [
  process.env.XLAYER_TESTNET_RPC_URL ?? "https://testrpc.xlayer.tech",
  "https://xlayertestrpc.okx.com",
];

export const XLAYER_MAINNET_RPCS = [
  process.env.XLAYER_RPC_URL ?? "https://rpc.xlayer.tech",
  "https://xlayerrpc.okx.com",
];

/** Retries within an endpoint, then falls through to the next one. */
export function xlayerTransport(urls = XLAYER_TESTNET_RPCS) {
  return fallback(
    [...new Set(urls)].map((u) => http(u, { retryCount: 3, retryDelay: 1500, timeout: 60_000 })),
    { rank: false },
  );
}

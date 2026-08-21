#!/usr/bin/env node
/**
 * Testnet faucet — mint the collateral (tUSTB) and settlement (tUSD) stand-ins to any address.
 *
 *   node scripts/faucet.mjs 0xYourWallet
 *   node scripts/faucet.mjs 0xYourWallet 2000 200     # 2000 tUSTB, 200 tUSD
 *
 * Both tokens are open-mint on testnet — their own contracts call themselves faucets — so
 * DEPLOYER_PRIVATE_KEY is used only to pay gas for the two mint transactions. It mints TO the
 * address you pass, never to itself.
 *
 * tUSTB and tUSD are labelled TEST assets with no real value, and the deploy script refuses to put
 * them on mainnet, so there is no chain on which this mints anything worth anything.
 *
 * Note: this hands out tokens, not gas. The wallet you are testing with still needs testnet OKB to
 * sign anything — https://www.okx.com/xlayer/faucet.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createPublicClient, createWalletClient, parseAbi, formatUnits, parseUnits, isAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { xlayerTransport } from "./_rpc.mjs";
import { repoRoot } from "./_artifact.mjs";

const to = process.argv[2];
if (!to || !isAddress(to)) {
  console.error("Usage: node scripts/faucet.mjs <address> [tUSTB whole] [tUSD whole]");
  console.error("  e.g. node scripts/faucet.mjs 0xYourWallet 2000 200");
  process.exit(1);
}
const ustbWhole = process.argv[3] ?? "2000";
const usdWhole = process.argv[4] ?? "200";

const pk = process.env.DEPLOYER_PRIVATE_KEY;
if (!pk) {
  console.error("DEPLOYER_PRIVATE_KEY not set. It only pays gas for the mints (tokens go to <address>).");
  process.exit(1);
}

const d = JSON.parse(readFileSync(resolve(repoRoot, "deployments/1952.json"), "utf8"));
const F = d.testnetFixtures;
const S = d.settlementAsset;
// The collateral fixture (tUSTB) is 18-decimal; the settlement fixture (tUSD) states its own.
const collateral = { token: F.collateralToken, decimals: 18, symbol: "tUSTB" };
const settlement = { token: S.token, decimals: S.decimals, symbol: S.symbol };

const chain = {
  id: 1952,
  name: "X Layer Testnet",
  nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 },
  rpcUrls: { default: { http: [] } },
};
const account = privateKeyToAccount(pk);
const pub = createPublicClient({ chain, transport: xlayerTransport() });
const wallet = createWalletClient({ account, chain, transport: xlayerTransport() });

const ERC20 = parseAbi([
  "function mint(address,uint256)",
  "function balanceOf(address) view returns (uint256)",
]);

async function mint({ token, decimals, symbol }, whole) {
  const amount = parseUnits(String(whole), decimals);
  const hash = await wallet.writeContract({ address: token, abi: ERC20, functionName: "mint", args: [to, amount], account, chain });
  const r = await pub.waitForTransactionReceipt({ hash, timeout: 180_000 });
  const bal = await pub.readContract({ address: token, abi: ERC20, functionName: "balanceOf", args: [to] });
  const ok = r.status === "success";
  console.log(`  ${ok ? "OK  " : "FAIL"} mint ${whole} ${symbol}  ${hash.slice(0, 18)}…  balance now ${formatUnits(bal, decimals)} ${symbol}`);
  if (!ok) process.exitCode = 1;
}

console.log(`\nUSANCE testnet faucet → ${to}`);
console.log(`gas payer ${account.address}`);
console.log("NOTE: tUSTB and tUSD are labelled TEST assets — no real value.\n");

const gas = await pub.getBalance({ address: account.address });
if (gas === 0n) {
  console.error("The gas payer has 0 OKB. Fund it first: https://www.okx.com/xlayer/faucet");
  process.exit(1);
}

await mint(collateral, ustbWhole);
await mint(settlement, usdWhole);

console.log("\nAdd these tokens in your wallet to see the balances:");
console.log(`  ${collateral.symbol}  ${collateral.token}  (${collateral.decimals} decimals)`);
console.log(`  ${settlement.symbol}  ${settlement.token}  (${settlement.decimals} decimals)`);
console.log("\nThe wallet you test with also needs OKB gas: https://www.okx.com/xlayer/faucet");
console.log("Then: /app → Add collateral → Borrow → Repay → Withdraw.\n");

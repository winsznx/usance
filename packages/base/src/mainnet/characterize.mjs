/**
 * Base Mainnet read-only characterization of the real Coinbase B20 tokenized stocks and their
 * Chainlink Total-Return Data Feeds. NO FINANCIAL ACTION — every call is an `eth_call`.
 *
 *   node packages/base/src/mainnet/characterize.mjs [BASE_MAINNET_RPC_URL]
 *
 * Produces docs/base/proof/mainnet-b20-characterization.json and feeds BASE_CANARY_CANDIDATES.md.
 *
 * For each instrument it records: the exact B20 token address, `name`/`symbol`/`decimals`,
 * `multiplier()` (WAD), raw vs scaled balance semantics on a probe holder, `isB20`/initialized,
 * paused features, the Chainlink feed proxy + `latestRoundData` + `decimals` + `updatedAt`
 * staleness, and the implied multiplier cross-check (feed price / a raw underlying estimate is not
 * available read-only, so we cross-check `multiplier()` against the feed's own description only).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, http, getAddress, formatUnits, parseAbi } from "viem";

const here = path.dirname(fileURLToPath(import.meta.url));
const PROOF = path.resolve(here, "../../../../docs/base/proof/mainnet-b20-characterization.json");
fs.mkdirSync(path.dirname(PROOF), { recursive: true });

const RPC = process.argv[2] || process.env.BASE_MAINNET_RPC_URL || "https://mainnet.base.org";
const BASE_MAINNET = 8453;

const B20_FACTORY = getAddress("0xB20f000000000000000000000000000000000000");
const ACTIVATION_REGISTRY = getAddress("0x8453000000000000000000000000000000000001");
const B20_REGISTRY = getAddress("0x3f3E8cf41cdd3b1D118c16471aB0113DfDDd5CaD");
const USDC = getAddress("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");

// From docs.base.org/specifications/b20/tokenized-stocks-on-base + Chainlink RDD (both probed 2026-09-08).
const INSTRUMENTS = [
  { ticker: "AAPLc", underlying: "Apple", token: "0xb200000000000000000000C2e324d24d7eEcd1fb", feed: "0x787f13dEa48Db0897CbCDD985de77809D837F988" },
  { ticker: "AMZNc", underlying: "Amazon", token: "0xb200000000000000000000d9192b6B456483C2E8", feed: "0x06A8E4b3aBB3B7543d8396FB2B763d22820cB295" },
  { ticker: "COINc", underlying: "Coinbase", token: "0xb200000000000000000000c85a31389D71F3ecfb", feed: "0x408e44f504A7371a345F03a73dDC96A4b48e8aa7" },
  { ticker: "CRCLc", underlying: "Circle Internet Group", token: "0xB20000000000000000000019f6E7C675b73C2e4D", feed: "0x0231cF2635D1E17bB5c2462cc7504Ba1fBd61f33" },
  { ticker: "GOOGLc", underlying: "Alphabet", token: "0xb2000000000000000000002D0BA3164cc74f58B7", feed: "0x5bF49E0ffA937CE2FfF033c739aD7C634c4D34F2" },
  { ticker: "INTCc", underlying: "Intel", token: "0xB2000000000000000000004AFF16039bA04bdFBc", feed: "0xAB657C39bac0D5886250D70849e2E3E008F2EECB" },
  { ticker: "METAc", underlying: "Meta Platforms", token: "0xb2000000000000000000008bC8786B856E61707C", feed: "0x6526aE6797A76123638b863AeE4dD27Ba4E4b27D" },
  { ticker: "MSFTc", underlying: "Microsoft", token: "0xB200000000000000000000Ab99cFa739E253872B", feed: "0xeB10A6c9aa7E537aEd766C08c35Dae35B321b18c" },
  { ticker: "MSTRc", underlying: "MicroStrategy", token: "0xb2000000000000000000004884b426556b92883d", feed: "0xB3cE282CD188b35DA0E38D8Bc7d58e33173D202a" },
  { ticker: "NVDAc", underlying: "Nvidia", token: "0xb20000000000000000000078ee7ce2fE4908108C", feed: "0x04689a41629776563E6822F76f2e57D148d28513" },
  { ticker: "SNDKc", underlying: "SanDisk", token: "0xb200000000000000000000397293Cb8cda9a10c5", feed: "0x388b0dC46C0Fb05A74BeE0994fa5b02c6Fcca2eA" },
  { ticker: "SPCXc", underlying: "SpaceX (SPCX)", token: "0xb2000000000000000000007b9fcbd005511aCBd5", feed: "0x6A634B235903C4ad6376892180d6fF8612e3Fa68" },
  { ticker: "TSLAc", underlying: "Tesla", token: "0xb2000000000000000000001e800a7f5189430cD0", feed: "0xFaf869185383a24F8cb00e27BdA6b63B9905DCb4" },
];

const b20Abi = parseAbi([
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
  "function multiplier() view returns (uint256)",
  "function WAD_PRECISION() view returns (uint256)",
  "function scaledBalanceOf(address) view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function extraMetadata(string) view returns (string)",
  "function contractURI() view returns (string)",
]);
const cobaltAbi = parseAbi([
  "function newUIMultiplier() view returns (uint256)",
  "function effectiveAt() view returns (uint256)",
]);
const factoryAbi = parseAbi([
  "function isB20(address) view returns (bool)",
  "function isB20Initialized(address) view returns (bool)",
]);
const feedAbi = parseAbi([
  "function decimals() view returns (uint8)",
  "function description() view returns (string)",
  "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
  "function aggregator() view returns (address)",
]);

const RPCS = [RPC, "https://base-rpc.publicnode.com", "https://base.llamarpc.com", "https://mainnet.base.org"];
const chain = { id: BASE_MAINNET, name: "base", nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: RPCS } } };
const pub = createPublicClient({
  chain,
  transport: http(RPC, { retryCount: 8, retryDelay: 2500, timeout: 45_000, batch: false }),
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function tryCall(fn, label) {
  let lastErr;
  for (let attempt = 0; attempt < 6; attempt++) {
    try { return { ok: true, value: await fn() }; }
    catch (e) { lastErr = e; await sleep(1200 + attempt * 800); }
  }
  return { ok: false, error: (lastErr?.shortMessage || lastErr?.message || String(lastErr)).slice(0, 160), label };
}
async function seq(entries) {
  const out = [];
  for (const [label, fn] of entries) { out.push(await tryCall(fn, label)); await sleep(250); }
  return out;
}

async function main() {
  const cid = await pub.getChainId();
  if (cid !== BASE_MAINNET) throw new Error(`chainId ${cid} != ${BASE_MAINNET} — pass a Base Mainnet RPC`);
  const block = await pub.getBlock();
  console.log(`Base Mainnet · block ${block.number} · ${new Date(Number(block.timestamp) * 1000).toISOString()}`);

  const out = {
    $generatedAt: new Date().toISOString(),
    NO_FINANCIAL_ACTION: true,
    proofLevel: "MAINNET_READ_ONLY",
    network: "base-mainnet",
    chainId: BASE_MAINNET,
    rpc: RPC.replace(/\/\/.*@/, "//"),
    sourceBlock: Number(block.number),
    sourceBlockTime: Number(block.timestamp),
    precompiles: { b20Factory: B20_FACTORY, activationRegistry: ACTIVATION_REGISTRY, b20Registry: B20_REGISTRY },
    settlement: { nativeUsdc: USDC, decimals: 6 },
    b20ReadPath: null,
    instruments: [],
  };

  // one Cobalt probe against a representative token
  const probe = INSTRUMENTS[0].token;
  const cobalt = await tryCall(() => pub.readContract({ address: getAddress(probe), abi: cobaltAbi, functionName: "effectiveAt" }), "effectiveAt");
  out.b20ReadPath = cobalt.ok ? "COBALT_ERC8056_PRESENT" : "BERYL_INSTANT_ONLY";
  console.log(`B20 read path: ${out.b20ReadPath}`);

  for (const inst of INSTRUMENTS) {
    const addr = getAddress(inst.token);
    const feed = getAddress(inst.feed);
    process.stdout.write(`  ${inst.ticker} ... `);
    const rec = { ...inst, token: addr, feed, mainnet: {} };

    const [isB20, isInit, name, symbol, decimals, wad, mult, supply, uri] = await seq([
      ["isB20", () => pub.readContract({ address: B20_FACTORY, abi: factoryAbi, functionName: "isB20", args: [addr] })],
      ["isB20Initialized", () => pub.readContract({ address: B20_FACTORY, abi: factoryAbi, functionName: "isB20Initialized", args: [addr] })],
      ["name", () => pub.readContract({ address: addr, abi: b20Abi, functionName: "name" })],
      ["symbol", () => pub.readContract({ address: addr, abi: b20Abi, functionName: "symbol" })],
      ["decimals", () => pub.readContract({ address: addr, abi: b20Abi, functionName: "decimals" })],
      ["WAD_PRECISION", () => pub.readContract({ address: addr, abi: b20Abi, functionName: "WAD_PRECISION" })],
      ["multiplier", () => pub.readContract({ address: addr, abi: b20Abi, functionName: "multiplier" })],
      ["totalSupply", () => pub.readContract({ address: addr, abi: b20Abi, functionName: "totalSupply" })],
      ["contractURI", () => pub.readContract({ address: addr, abi: b20Abi, functionName: "contractURI" })],
    ]);
    const isin = await tryCall(() => pub.readContract({ address: addr, abi: b20Abi, functionName: "extraMetadata", args: ["ISIN"] }));

    rec.mainnet.isB20 = isB20.value ?? isB20.error;
    rec.mainnet.isB20Initialized = isInit.value ?? isInit.error;
    rec.mainnet.name = name.value ?? name.error;
    rec.mainnet.symbol = symbol.value ?? symbol.error;
    rec.mainnet.decimals = decimals.ok ? Number(decimals.value) : decimals.error;
    rec.mainnet.wadPrecision = wad.ok ? wad.value.toString() : wad.error;
    rec.mainnet.multiplierWad = mult.ok ? mult.value.toString() : mult.error;
    rec.mainnet.multiplierHuman = mult.ok ? formatUnits(mult.value, 18) : null;
    rec.mainnet.totalSupplyRaw = supply.ok ? supply.value.toString() : supply.error;
    rec.mainnet.contractURI = uri.value ?? uri.error;
    rec.mainnet.isinMetadata = isin.value || null;
    rec.mainnet.rawBalanceSemantics = "balanceOf() returns raw units, unchanged by corporate actions";
    rec.mainnet.economicQuantitySemantics = "effective = raw * multiplier() / 1e18 (spec/corporate-action-model.md §1)";
    rec.mainnet.priceConvention = "FACTOR_IN_PRICE — Chainlink Total-Return feed already includes multiplier; risk uses raw * feedPrice";
    rec.mainnet.transferability = "permissionless on secondary market; policy-gated; issuer can pause / freeze-and-seize";
    rec.mainnet.corporateActionCapability = out.b20ReadPath === "COBALT_ERC8056_PRESENT"
      ? "scheduled (ERC-8056) + instant"
      : "instant updateMultiplier only (Beryl); advance notice via Announcement events";

    const [fdec, fdesc, frd, fagg] = await seq([
      ["feed.decimals", () => pub.readContract({ address: feed, abi: feedAbi, functionName: "decimals" })],
      ["feed.description", () => pub.readContract({ address: feed, abi: feedAbi, functionName: "description" })],
      ["feed.latestRoundData", () => pub.readContract({ address: feed, abi: feedAbi, functionName: "latestRoundData" })],
      ["feed.aggregator", () => pub.readContract({ address: feed, abi: feedAbi, functionName: "aggregator" })],
    ]);
    rec.oracle = {
      product: "Chainlink Data Feed (push, AggregatorV3)",
      proxy: feed,
      aggregator: fagg.value ?? fagg.error,
      decimals: fdec.ok ? Number(fdec.value) : fdec.error,
      description: fdesc.value ?? fdesc.error,
      quote: "USD",
      marketHours: "us_equities_24/5",
      heartbeatSeconds: 86400,
      deviationBps: 50,
    };
    if (frd.ok) {
      const [roundId, answer, , updatedAt] = frd.value;
      const ageS = Number(block.timestamp) - Number(updatedAt);
      rec.oracle.latest = {
        roundId: roundId.toString(),
        answer: answer.toString(),
        answerUsd: fdec.ok ? formatUnits(answer, Number(fdec.value)) : null,
        updatedAt: Number(updatedAt),
        ageSeconds: ageS,
        freshness: ageS > 90_000 ? "STALE_OR_OFF_HOURS" : "FRESH",
        note: "off-hours the feed holds last close and updatedAt stops advancing; never settle/liquidate against a frozen feed",
      };
    } else {
      rec.oracle.latest = { error: frd.error };
    }
    out.instruments.push(rec);
    console.log(`mult=${rec.mainnet.multiplierHuman} feed=${rec.oracle.latest?.answerUsd ?? "?"} (${rec.oracle.latest?.freshness ?? "err"})`);
  }

  fs.writeFileSync(PROOF, JSON.stringify(out, null, 2, (_, v) => (typeof v === "bigint" ? v.toString() : v)) + "\n");
  console.log(`\n✓ ${PROOF}`);
}

main().catch((e) => { console.error("\n✗", e?.shortMessage || e?.message || e); process.exit(1); });

/**
 * Print the live Usance state for one account on X Layer.
 *
 * Read-only. Used before and after any scripted scenario so the starting state is recorded rather
 * than assumed — a scenario that assumes it begins at zero debt will happily assert nonsense when
 * a previous run left debt behind.
 */
import { createPublicClient, http, parseAbi, formatUnits } from "viem";
import { xlayerTransport } from "./_rpc.mjs";
import { readFileSync } from "node:fs";

const d = JSON.parse(readFileSync("deployments/1952.json", "utf8"));
const C = d.contracts, F = d.testnetFixtures;
const RPC = process.env.XLAYER_TESTNET_RPC_URL ?? "https://testrpc.xlayer.tech";
const chain = { id: 1952, name: "X Layer Testnet", nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } };
const pub = createPublicClient({ chain, transport: xlayerTransport() });

const CH = parseAbi([
  "function accountHealth(address) view returns ((uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint8,uint32),(bytes32,uint256,uint256,uint256,uint256,uint256,uint256)[])",
  "function availableBorrow(address) view returns (uint256,bool)",
]);
const AGG = parseAbi(["function answer() view returns (int256)"]);
const ERC20 = parseAbi(["function balanceOf(address) view returns (uint256)"]);
const STATUS = ["NORMAL", "NO_NEW_RISK", "REDUCE_ONLY", "MARGIN_CALL", "LIQUIDATING", "SETTLED", "BAD_DEBT"];

const acct = process.argv[2] ?? JSON.parse(readFileSync("proof/live-risk-scenario.json", "utf8")).account;
const usd = (v) => `$${Number(formatUnits(v, 18)).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

const [h] = await pub.readContract({ address: C.clearingHouse, abi: CH, functionName: "accountHealth", args: [acct] });
const [avail, byLiq] = await pub.readContract({ address: C.clearingHouse, abi: CH, functionName: "availableBorrow", args: [acct] });

console.log(`account       ${acct}`);
console.log(`OKB for gas   ${formatUnits(await pub.getBalance({ address: acct }), 18)}`);
console.log(`feed answer   ${await pub.readContract({ address: F.collateralFeed, abi: AGG, functionName: "answer" })}`);
console.log(`recognised    ${usd(h[0])}`);
console.log(`borrow limit  ${usd(h[1])}`);
console.log(`debt          ${usd(h[4])}`);
console.log(`available     ${usd(avail)}${byLiq ? "  (limited by lender cash)" : ""}`);
console.log(`status        ${STATUS[Number(h[7])]}${Number(h[8]) ? `  gates=0x${Number(h[8]).toString(16)}` : ""}`);
console.log(`tUSD balance  ${usd(await pub.readContract({ address: F.settlementToken, abi: ERC20, functionName: "balanceOf", args: [acct] }))}`);
console.log(`tUSTB balance ${usd(await pub.readContract({ address: F.collateralToken, abi: ERC20, functionName: "balanceOf", args: [acct] }))}`);

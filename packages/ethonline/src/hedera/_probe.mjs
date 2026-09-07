import { createPublicClient, http } from "viem";
import M from "../../../../docs/ethonline-2026/proof/hedera-facility-deployment.json" with { type: "json" };

const A_TOK = M.atsSecurities.A.evm;
const B_TOK = M.atsSecurities.B.evm;
const ADAPTER = M.contracts.AdapterA;
const OP = "0x06622c6a328cc0a54C906Fde66Bc597B7FA904C1";
const P = "0x0000000000000000000000000000000000000000000000000000000000000001";
const pub = createPublicClient({ transport: http(process.env.HEDERA_TESTNET_RPC_URL) });

const ct = [{ type: "function", name: "canTransferByPartition", stateMutability: "view", inputs: [{ type: "address" }, { type: "address" }, { type: "bytes32" }, { type: "uint256" }, { type: "bytes" }, { type: "bytes" }], outputs: [{ type: "bool" }, { type: "bytes1" }, { type: "bytes32" }] }];
const al = [{ type: "function", name: "allowance", stateMutability: "view", inputs: [{ type: "address" }, { type: "address" }], outputs: [{ type: "uint256" }] }];
const bp = [{ type: "function", name: "balanceOfByPartition", stateMutability: "view", inputs: [{ type: "bytes32" }, { type: "address" }], outputs: [{ type: "uint256" }] }];
const pausedAbi = [{ type: "function", name: "isPaused", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] }];
const holdAbi = [{ type: "function", name: "createHoldFromByPartition", stateMutability: "nonpayable", inputs: [{ type: "bytes32" }, { type: "address" }, { type: "tuple", components: [{ type: "uint256" }, { type: "uint256" }, { type: "address" }, { type: "address" }, { type: "bytes" }] }, { type: "bytes" }], outputs: [{ type: "bool" }, { type: "uint256" }] }];

for (const [name, tok] of [["A", A_TOK], ["B", B_TOK]]) {
  try { console.log(name, "canTransfer:", await pub.readContract({ address: tok, abi: ct, functionName: "canTransferByPartition", args: [OP, OP, P, 100000n, "0x", "0x"] })); } catch (e) { console.log(name, "canTransfer ERR:", e.shortMessage || e.message); }
  try { console.log(name, "isPaused:", await pub.readContract({ address: tok, abi: pausedAbi, functionName: "isPaused" })); } catch (e) { console.log(name, "isPaused ERR:", e.shortMessage); }
  try { console.log(name, "allowance OP->adapterA:", (await pub.readContract({ address: tok, abi: al, functionName: "allowance", args: [OP, ADAPTER] })).toString()); } catch (e) { console.log(name, "allowance ERR:", e.shortMessage); }
  try { console.log(name, "balByPartition default:", (await pub.readContract({ address: tok, abi: bp, functionName: "balanceOfByPartition", args: [P, OP] })).toString()); } catch (e) { console.log(name, "bal ERR:", e.shortMessage); }
}
// simulate the third-party hold from OP as the ADAPTER caller
try {
  await pub.simulateContract({ account: ADAPTER, address: A_TOK, abi: holdAbi, functionName: "createHoldFromByPartition", args: [P, OP, [100000n, 0n, ADAPTER, OP, "0x"], "0x"] });
  console.log("createHoldFromByPartition simulate: OK");
} catch (e) { console.log("createHoldFromByPartition simulate ERR:", e.shortMessage || e.message, "| data:", e.data || (e.cause && e.cause.data)); }

/**
 * ENSv2 (Sepolia beta) — register the Usance institutional name and delegate a REAL
 * resource-scoped Enhanced Access Control role to the treasury operator.
 *
 *   node --env-file=../../.env src/ens/register-and-delegate.mjs
 *
 * Resumable: writes docs/ethonline-2026/proof/ensv2-authority.json after each step and skips
 * anything already recorded. Never prints the private key.
 *
 * Deployment addresses are the docs-pinned ENSv2 Sepolia set
 * (contracts-v2 @ 97a57293, contracts/docs/addresses/sepolia.md, deployed 2026-07-30):
 *   ETHRegistrar 0xa88553f454b77203b0d036a05c894d555eaaa2cc
 *   ETHRegistry  0xbdc85dd5b15d7ecb354cd7cb6f2c50b4f2c4f0e2
 *   MockUSDC     0x768f42455a2d082e23ceef7d51e5787c82d67a39
 *   PublicResolverV2 0xe7b9a25607e02da8145e4eb1836ca539e53f11f7
 *   RootRegistry 0x8115186e8f2e0b0281e86ab91f0f48ba90364354
 * Resolver / registry addresses are re-read live (getState) before any write.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPublicClient, createWalletClient, http, keccak256, encodeAbiParameters, parseAbiParameters,
  toHex, stringToBytes, getAddress, formatEther,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const here = path.dirname(fileURLToPath(import.meta.url));
const PROOF = path.resolve(here, "../../../../docs/ethonline-2026/proof/ensv2-authority.json");

const RPC = process.env.SEPOLIA_RPC_URL;
const SEPOLIA = 11155111;
const ETH_REGISTRAR = getAddress("0xa88553f454b77203b0d036a05c894d555eaaa2cc");
const ETH_REGISTRY = getAddress("0xbdc85dd5b15d7ecb354cd7cb6f2c50b4f2c4f0e2");
const MOCK_USDC = getAddress("0x768f42455a2d082e23ceef7d51e5787c82d67a39");
const PUBLIC_RESOLVER_V2 = getAddress("0xe7b9a25607e02da8145e4eb1836ca539e53f11f7");
const ROOT_REGISTRY = getAddress("0x8115186e8f2e0b0281e86ab91f0f48ba90364354");
const ETHERSCAN = (h) => `https://sepolia.etherscan.io/tx/${h}`;

// contracts-v2 RegistryRolesLib.sol — nybble-packed, one 4-bit slot per role.
const ROLE_SET_SUBREGISTRY = 1n << 20n; // "authorizes changing a name's child registry"
const ROLE_SET_RESOLVER = 1n << 24n; //   "authorizes changing a name's resolver"
const DELEGATED_ROLE_BITMAP = ROLE_SET_SUBREGISTRY | ROLE_SET_RESOLVER;

// The name and the delegate.
const LABEL = process.env.ENS_LABEL || "usance-institutional";
const DURATION = 31_536_000n; // 1 year
// The treasury operator: the Hedera institutional-facility operator's EVM address. The ENS role
// says "this address may administer the facility namespace"; on Hedera the same address is the
// Privy org-approval signer. Both are required (I-102).
const DELEGATE = getAddress(process.env.ENS_DELEGATE || "0x06622c6a328cc0a54C906Fde66Bc597B7FA904C1");

const registrarAbi = [
  { type: "function", name: "MIN_COMMITMENT_AGE", stateMutability: "view", inputs: [], outputs: [{ type: "uint64" }] },
  { type: "function", name: "MAX_COMMITMENT_AGE", stateMutability: "view", inputs: [], outputs: [{ type: "uint64" }] },
  { type: "function", name: "isAvailable", stateMutability: "view", inputs: [{ type: "string" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "getRegisterPrice", stateMutability: "view", inputs: [{ type: "string" }, { type: "uint64" }, { type: "address" }], outputs: [{ type: "uint256" }, { type: "uint256" }] },
  { type: "function", name: "commitmentAt", stateMutability: "view", inputs: [{ type: "bytes32" }], outputs: [{ type: "uint64" }] },
  { type: "function", name: "makeCommitment", stateMutability: "pure", inputs: [{ type: "string" }, { type: "address" }, { type: "bytes32" }, { type: "address" }, { type: "address" }, { type: "uint64" }, { type: "bytes32" }], outputs: [{ type: "bytes32" }] },
  { type: "function", name: "commit", stateMutability: "nonpayable", inputs: [{ type: "bytes32" }], outputs: [] },
  { type: "function", name: "register", stateMutability: "nonpayable", inputs: [{ type: "string" }, { type: "address" }, { type: "bytes32" }, { type: "address" }, { type: "address" }, { type: "uint64" }, { type: "address" }, { type: "bytes32" }], outputs: [{ type: "uint256" }] },
];
const registryAbi = [
  { type: "function", name: "getState", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "tuple", components: [{ name: "status", type: "uint8" }, { name: "expiry", type: "uint64" }, { name: "latestOwner", type: "address" }, { name: "tokenId", type: "uint256" }, { name: "resource", type: "uint256" }] }] },
  { type: "function", name: "grantRoles", stateMutability: "nonpayable", inputs: [{ type: "uint256" }, { type: "uint256" }, { type: "address" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "revokeRoles", stateMutability: "nonpayable", inputs: [{ type: "uint256" }, { type: "uint256" }, { type: "address" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "hasRoles", stateMutability: "view", inputs: [{ type: "uint256" }, { type: "uint256" }, { type: "address" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "roles", stateMutability: "view", inputs: [{ type: "uint256" }, { type: "address" }], outputs: [{ type: "uint256" }] },
];
const erc20Abi = [
  { type: "function", name: "mint", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [] },
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "allowance", stateMutability: "view", inputs: [{ type: "address" }, { type: "address" }], outputs: [{ type: "uint256" }] },
];

function key() {
  const k = (process.env.ENS_SEPOLIA_DEPLOYER_KEY || "").trim();
  const pk = k.startsWith("0x") ? k : `0x${k}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(pk)) throw new Error("bad ENS_SEPOLIA_DEPLOYER_KEY");
  return pk;
}
const account = privateKeyToAccount(key());
const chain = { id: SEPOLIA, name: "sepolia", nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } };
const pub = createPublicClient({ chain, transport: http(RPC, { retryCount: 5, retryDelay: 3000, timeout: 60_000 }) });
const wal = createWalletClient({ account, chain, transport: http(RPC, { retryCount: 5, retryDelay: 3000, timeout: 60_000 }) });

let P = fs.existsSync(PROOF) ? JSON.parse(fs.readFileSync(PROOF, "utf8")) : { $generatedAt: new Date().toISOString(), network: "sepolia", chainId: SEPOLIA, ensv2: { source: "contracts-v2@97a57293 / docs addresses/sepolia.md (deployed 2026-07-30)", ethRegistrar: ETH_REGISTRAR, ethRegistry: ETH_REGISTRY, mockUsdc: MOCK_USDC }, steps: [] };
const save = () => fs.writeFileSync(PROOF, JSON.stringify(P, null, 2) + "\n");
const done = (n) => P.steps.some((s) => s.name === n && s.ok);
async function step(name, fn) {
  if (done(name)) { console.log(`  = ${name} (cached)`); return P.steps.find((s) => s.name === name); }
  process.stdout.write(`→ ${name} ... `);
  const r = await fn();
  const rec = { name, ok: true, ...r };
  if (r?.tx) rec.etherscan = ETHERSCAN(r.tx);
  P.steps.push(rec); save();
  console.log(r?.tx ? `ok ${r.tx}` : "ok");
  return rec;
}
async function write(addr, abi, functionName, args) {
  const hash = await wal.writeContract({ address: addr, abi, functionName, args });
  const rc = await pub.waitForTransactionReceipt({ hash });
  if (rc.status !== "success") throw new Error(`${functionName} reverted ${hash}`);
  return { tx: hash, block: Number(rc.blockNumber) };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const cid = await pub.getChainId();
  if (cid !== SEPOLIA) throw new Error(`chainId ${cid} != ${SEPOLIA}`);
  const bal = await pub.getBalance({ address: account.address });
  console.log(`wallet ${account.address} · ${formatEther(bal)} ETH · label "${LABEL}" · delegate ${DELEGATE}`);
  P.owner = account.address;
  P.name = `${LABEL}.eth`;
  P.delegate = DELEGATE;
  save();

  const labelhash = keccak256(stringToBytes(LABEL));
  P.labelhash = labelhash;

  // ---- registration (commit-reveal) ----
  if (!done("register .eth name")) {
    const available = await pub.readContract({ address: ETH_REGISTRAR, abi: registrarAbi, functionName: "isAvailable", args: [LABEL] });
    if (!available) throw new Error(`"${LABEL}" is not available — set ENS_LABEL to a free name`);
    const [base, premium] = await pub.readContract({ address: ETH_REGISTRAR, abi: registrarAbi, functionName: "getRegisterPrice", args: [LABEL, DURATION, MOCK_USDC] });
    const price = base + premium;
    P.registerPrice = { base: base.toString(), premium: premium.toString(), total: price.toString(), token: "MockUSDC" };
    console.log(`  price: ${Number(price) / 1e6} MockUSDC (base ${base}, premium ${premium})`);
    save();

    const minAge = await pub.readContract({ address: ETH_REGISTRAR, abi: registrarAbi, functionName: "MIN_COMMITMENT_AGE" });
    const maxAge = await pub.readContract({ address: ETH_REGISTRAR, abi: registrarAbi, functionName: "MAX_COMMITMENT_AGE" });
    P.commitmentWindow = { minAgeSeconds: Number(minAge), maxAgeSeconds: Number(maxAge) };

    let secret = P.secret;
    if (!secret) { secret = keccak256(toHex(`usance-ethonline-${Date.now()}-${Math.random()}`)); P.secret = secret; save(); }

    const commitment = await pub.readContract({
      address: ETH_REGISTRAR, abi: registrarAbi, functionName: "makeCommitment",
      args: [LABEL, account.address, secret, "0x0000000000000000000000000000000000000000", PUBLIC_RESOLVER_V2, DURATION, "0x0000000000000000000000000000000000000000000000000000000000000000"],
    });
    P.commitment = commitment; save();

    await step("mint MockUSDC", () => write(MOCK_USDC, erc20Abi, "mint", [account.address, price * 2n]));
    await step("approve MockUSDC to the registrar", () => write(MOCK_USDC, erc20Abi, "approve", [ETH_REGISTRAR, price * 2n]));

    if (!done("commit")) {
      const at = await pub.readContract({ address: ETH_REGISTRAR, abi: registrarAbi, functionName: "commitmentAt", args: [commitment] });
      if (at === 0n) await step("commit", () => write(ETH_REGISTRAR, registrarAbi, "commit", [commitment]));
      else { P.steps.push({ name: "commit", ok: true, note: "already committed on chain" }); save(); }
    }
    const committedAt = Number(await pub.readContract({ address: ETH_REGISTRAR, abi: registrarAbi, functionName: "commitmentAt", args: [commitment] }));
    const now = Math.floor(Date.now() / 1000);
    const wait = Math.max(0, committedAt + Number(minAge) + 5 - now);
    if (wait > 0) { console.log(`  waiting ${wait}s for the commitment to age (min ${minAge}s)`); await sleep(wait * 1000); }

    // gas estimate before the register write
    const gas = await pub.estimateContractGas({
      account, address: ETH_REGISTRAR, abi: registrarAbi, functionName: "register",
      args: [LABEL, account.address, secret, "0x0000000000000000000000000000000000000000", PUBLIC_RESOLVER_V2, DURATION, MOCK_USDC, "0x0000000000000000000000000000000000000000000000000000000000000000"],
    });
    P.registerGasEstimate = gas.toString();
    console.log(`  register gas estimate: ${gas}`);
    save();

    await step("register .eth name", () => write(
      ETH_REGISTRAR, registrarAbi, "register",
      [LABEL, account.address, secret, "0x0000000000000000000000000000000000000000", PUBLIC_RESOLVER_V2, DURATION, MOCK_USDC, "0x0000000000000000000000000000000000000000000000000000000000000000"],
    ));
  }

  // ---- resource + role delegation ----
  const state = await pub.readContract({ address: ETH_REGISTRY, abi: registryAbi, functionName: "getState", args: [BigInt(labelhash)] });
  P.tokenIdSnapshot = state.tokenId.toString(); // snapshot only — NOT stable name identity (regenerates on role change)
  P.resource = "0x" + state.resource.toString(16).padStart(64, "0");
  P.owner = state.latestOwner;
  P.expiry = Number(state.expiry);
  P.roleBitmap = "0x" + DELEGATED_ROLE_BITMAP.toString(16);
  P.roleNames = ["ROLE_SET_SUBREGISTRY (1<<20)", "ROLE_SET_RESOLVER (1<<24)"];
  save();
  console.log(`  name resource: ${P.resource}  (labelhash ${labelhash}, EAC version 0)`);

  await step("grant the resource-scoped EAC role to the delegate", () =>
    write(ETH_REGISTRY, registryAbi, "grantRoles", [BigInt(labelhash), DELEGATED_ROLE_BITMAP, DELEGATE]));

  const has = await pub.readContract({ address: ETH_REGISTRY, abi: registryAbi, functionName: "hasRoles", args: [BigInt(labelhash), DELEGATED_ROLE_BITMAP, DELEGATE] });
  const effective = await pub.readContract({ address: ETH_REGISTRY, abi: registryAbi, functionName: "roles", args: [state.resource, DELEGATE] });
  P.delegateHasRole = has;
  P.delegateEffectiveRoles = "0x" + effective.toString(16);
  save();
  if (!has) throw new Error("hasRoles returned false after grant");
  console.log(`  hasRoles(delegate) = ${has}  effective roles = ${P.delegateEffectiveRoles}`);

  // ---- authority evidence + digest ----
  const block = await pub.getBlock();
  P.authorityEvidence = {
    name: `${LABEL}.eth`,
    canonicalHierarchy: `${LABEL}.eth (2LD, registered directly in the ENSv2 ETHRegistry)`,
    ensv2Contract: ETH_REGISTRY,
    ensv2Version: "ENSv2-beta-sepolia / contracts-v2@97a57293",
    resource: P.resource,
    requiredRole: P.roleBitmap,
    requiredRoleNames: P.roleNames,
    resolvedAccount: DELEGATE,
    sepoliaBlock: Number(block.number),
    sepoliaBlockHash: block.hash,
    sepoliaBlockTimestamp: Number(block.timestamp),
    decisionTimestamp: Math.floor(Date.now() / 1000),
    freshnessRule: "the evidence is valid while hasRoles(resource, roleBitmap, resolvedAccount) is true AND the pinned block is within Sepolia's safe reorg depth; re-checked before any release",
  };
  P.authorityEvidenceDigest = keccak256(encodeAbiParameters(
    parseAbiParameters("string, string, address, string, uint256, uint256, address, uint256"),
    ["USANCE_ENS_AUTHORITY_V1", `${LABEL}.eth`, ETH_REGISTRY, P.authorityEvidence.ensv2Version, state.resource, DELEGATED_ROLE_BITMAP, DELEGATE, block.number],
  ));
  save();

  console.log(`\n✓ authority evidence digest: ${P.authorityEvidenceDigest}`);
  console.log(`✓ ${PROOF}`);
  console.log(`\nNext: configure EthOnlineAuthorityVerifier on Hedera with this digest + delegate as orgApprover,`);
  console.log(`      then run the positive substitution, then revoke the role and run the refusal.`);
}

main().catch((e) => { console.error("\n✗", e?.shortMessage || e?.message || e); process.exit(1); });

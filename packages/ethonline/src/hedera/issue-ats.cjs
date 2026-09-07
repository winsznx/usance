/* eslint-disable */
// SPDX-License-Identifier: BUSL-1.1
/**
 * Issue the three ETHOnline collateral series (A / B / C) as real Hedera ATS security tokens.
 *
 *   node --env-file=../../.env src/hedera/issue-ats.cjs
 *
 * A and B: the borrower is granted internal KYC — an eligible replacement candidate.
 * C:       the borrower is NOT granted KYC — an ineligible candidate (canTransferByPartition fails).
 *
 * Writes docs/ethonline-2026/proof/hedera-ats-issuance.json. Never prints the operator key.
 *
 * ATS SDK v8.0.0 against the canonical Hedera testnet deployment
 * (factory 0.0.9213391, resolver/BLR 0.0.9212226 — apps/ats/web/.env.example in the v8.0.0 tree).
 * The SDK ships a broken ESM build, so this is CJS and reaches the DI container through a small
 * `pnpm patch` that exposes `./cjs/*`.
 */
require("reflect-metadata");
// The SDK gates its RPC (Metamask) transaction adapter on `!!global.window`. Headless signing
// still goes through an ethers Wallet we set explicitly below; `debug: true` on connect skips the
// browser Metamask handshake. A bare window object is enough to select the RPC adapter.
if (typeof global.window === "undefined") global.window = {};
const { ethers } = require("ethers");
const fs = require("node:fs");
const path = require("node:path");

const sdk = require("@hashgraph/asset-tokenization-sdk");
const {
  Network,
  Equity,
  Security,
  Kyc,
  Management,
  InitializationRequest,
  ConnectRequest,
  CreateEquityRequest,
  IssueRequest,
  PauseRequest,
  Role,
  RoleRequest,
  ResolveLatestConfigVersionRequest,
  SupportedWallets,
} = sdk;

// ATS protocol role constants (contracts/constants/roles.sol / SDK SecurityRole).
const ISSUER_ROLE = "0x5eeaf5602c75bf26e73b5206d0bd6ee82f621166255e5fd73cc06bc7bd84a95f";
const PAUSER_ROLE = "0x3cb8b459fdb6e7dc3d2a2aa529e530f885d45e03584adb438423209c86a2731f";
const cjs = (p) => require(`@hashgraph/asset-tokenization-sdk/cjs/${p}`);
const Injectable = cjs("core/injectable/Injectable").default;
const { RPCTransactionAdapter } = cjs("port/out/rpc/RPCTransactionAdapter");
const { RPCQueryAdapter } = cjs("port/out/rpc/RPCQueryAdapter");
const NetworkService = cjs("app/service/network/NetworkService").default;

// ---- config ----------------------------------------------------------------

const FACTORY = "0.0.9213391";
const RESOLVER = "0.0.9212226";
const EQUITY_CONFIG_ID = "0x0000000000000000000000000000000000000000000000000000000000000001";
const RPC = process.env.HEDERA_TESTNET_RPC_URL || "https://testnet.hashio.io/api";
const MIRROR = (process.env.HEDERA_TESTNET_MIRROR_URL || "https://testnet.mirrornode.hedera.com") + "/api/v1/";
const OPERATOR_ID = process.env.HEDERA_TESTNET_OPERATOR_ID;
const RAW_KEY = process.env.HEDERA_TESTNET_OPERATOR_KEY;

const PROOF = path.resolve(__dirname, "../../../../docs/ethonline-2026/proof/hedera-ats-issuance.json");
const writeProof = (o) => {
  fs.mkdirSync(path.dirname(PROOF), { recursive: true });
  fs.writeFileSync(PROOF, JSON.stringify(o, null, 2) + "\n");
};
const HASHSCAN = (id) => `https://hashscan.io/testnet/token/${id}`;
const HASHSCAN_TX = (tx) => `https://hashscan.io/testnet/transaction/${tx}`;

function normalizeKey(k) {
  const hex = (k || "").trim().replace(/^0x/i, "").toLowerCase();
  if (/^[0-9a-f]{64}$/.test(hex)) return `0x${hex}`;
  const m = hex.match(/0420([0-9a-f]{64})/);
  if (m) return `0x${m[1]}`;
  throw new Error("could not normalise HEDERA_TESTNET_OPERATOR_KEY");
}

// A minimal, compliance-on equity. internalKycActivated => canTransferByPartition consults KYC.
function equityRequest({ name, symbol, isin, configVersion }) {
  return new CreateEquityRequest({
    name,
    symbol,
    isin,
    decimals: 0,
    isWhiteList: false,
    erc20VotesActivated: false,
    isControllable: true,
    arePartitionsProtected: false,
    isMultiPartition: false,
    clearingActive: false,
    internalKycActivated: false,
    diamondOwnerAccount: OPERATOR_ID,
    votingRight: false,
    informationRight: false,
    liquidationRight: true,
    subscriptionRight: false,
    conversionRight: false,
    redemptionRight: true,
    putRight: false,
    dividendRight: 1,
    currency: "0x555344", // "USD"
    numberOfShares: "1000000000", // max supply
    nominalValue: "100",
    nominalValueDecimals: 2,
    regulationType: 1, // REG_S
    regulationSubType: 0,
    isCountryControlListWhiteList: false,
    countries: "",
    info: "",
    configId: EQUITY_CONFIG_ID,
    configVersion,
  });
}

async function main() {
  if (!OPERATOR_ID || !RAW_KEY) throw new Error("HEDERA_TESTNET_OPERATOR_ID / _KEY not set");
  const pk = normalizeKey(RAW_KEY);
  const wallet = new ethers.Wallet(pk);
  const evmAddress = wallet.address;
  console.log(`operator ${OPERATOR_ID} -> ${evmAddress}`);
  console.log(`factory ${FACTORY} · resolver ${RESOLVER} · rpc ${RPC}`);

  const mirrorNode = { name: "hedera-testnet", baseUrl: MIRROR };
  const rpcNode = { name: "hedera-testnet", baseUrl: RPC };

  // Headless flow (mirrors the SDK's own Equity integration test): configure the NetworkService
  // directly and hand the RPC adapter an ethers Wallet, rather than Network.init() which
  // unconditionally tries a browser Metamask handshake.
  const th = Injectable.resolve(RPCTransactionAdapter);
  const ns = Injectable.resolve(NetworkService);
  const rpcQuery = Injectable.resolve(RPCQueryAdapter);
  rpcQuery.init();
  ns.environment = "testnet";
  ns.configuration = { factoryAddress: FACTORY, resolverAddress: RESOLVER };
  ns.mirrorNode = mirrorNode;
  ns.rpcNode = rpcNode;

  await th.init(true); // debug -> skip the Metamask handshake
  await th.register(undefined, true);
  th.setSignerOrProvider(new ethers.Wallet(pk, new ethers.JsonRpcProvider(RPC)));

  await Network.connect(
    new ConnectRequest({
      account: { accountId: OPERATOR_ID, privateKey: { key: pk, type: "ECDSA" }, evmAddress },
      network: "testnet",
      wallet: SupportedWallets.METAMASK,
      mirrorNode,
      rpcNode,
      debug: true,
    }),
  );

  const { payload: configVersion } = await Management.resolveLatestConfigVersion(
    new ResolveLatestConfigVersionRequest({ resolverAddress: RESOLVER, configurationId: EQUITY_CONFIG_ID }),
  );
  console.log(`equity config version: ${configVersion}`);

  const series = [
    { key: "A", name: "Usance ETHOnline Collateral A", symbol: "USNCA", isin: "USUSANCEA010", eligible: true },
    { key: "B", name: "Usance ETHOnline Collateral B", symbol: "USNCB", isin: "USUSANCEB026", eligible: true },
    { key: "C", name: "Usance ETHOnline Collateral C", symbol: "USNCC", isin: "USUSANCEC032", eligible: false },
  ];
  const idStr = (v) => {
    if (typeof v === "string") return v;
    if (v && typeof v.value === "string") return v.value;
    const s = v?.toString?.();
    return s && s !== "[object Object]" ? s : String(v);
  };

  const out = {
    $generatedAt: new Date().toISOString(),
    network: "hedera-testnet",
    chainId: 296,
    standard: "ERC-1400 (ATS equity, controllable, transfer-restrictable via pause)",
    atsFactory: FACTORY,
    atsResolver: RESOLVER,
    equityConfigId: EQUITY_CONFIG_ID,
    equityConfigVersion: configVersion,
    operator: { accountId: OPERATOR_ID, evmAddress },
    // The borrower in the live lifecycle is the operator itself for the demo (single account
    // holds the collateral series); the substitution facility's borrower is set to this address.
    borrower: { accountId: OPERATOR_ID, evmAddress },
    series: {},
  };

  // Resume from a partial proof file if one exists (creation is not free to re-run).
  if (fs.existsSync(PROOF)) {
    const prev = JSON.parse(fs.readFileSync(PROOF, "utf8"));
    if (prev.equityConfigVersion === configVersion) Object.assign(out.series, prev.series ?? {});
  }
  const ISSUE_AMOUNT = "10000000"; // 10M whole shares to the borrower

  for (const s of series) {
    if (out.series[s.key]?.issueTx) {
      console.log(`\n=== series ${s.key}: already issued (${out.series[s.key].securityId}), skipping ===`);
      continue;
    }
    console.log(`\n=== series ${s.key}: ${s.name} ===`);
    let securityId = out.series[s.key]?.securityId ? idStr(out.series[s.key].securityId) : null;
    let createTx = out.series[s.key]?.createTx ?? null;
    if (!securityId) {
      const created = await Equity.create(equityRequest({ ...s, configVersion }));
      securityId = idStr(
        created.security.diamondAddress || created.security.evmDiamondAddress || created.security.address,
      );
      createTx = created.transactionId;
      console.log(`  created ${securityId}  tx ${createTx}`);
      out.series[s.key] = { name: s.name, symbol: s.symbol, isin: s.isin, securityId, createTx };
      writeProof(out);
    }

    // The deployer is diamond admin but not issuer/pauser by default — grant those.
    if (!out.series[s.key]?.issueTx) {
      await Role.grantRole(new RoleRequest({ securityId, targetId: evmAddress, role: ISSUER_ROLE }));
      await Role.grantRole(new RoleRequest({ securityId, targetId: evmAddress, role: PAUSER_ROLE }));
      console.log(`  granted ISSUER + PAUSER to the operator`);
    }

    const issue = await Security.issue(new IssueRequest({ securityId, targetId: evmAddress, amount: ISSUE_AMOUNT }));
    console.log(`  issued ${ISSUE_AMOUNT} to the borrower  tx ${issue.transactionId}`);

    // Series C is the ineligible candidate: the borrower holds it, then the issuer PAUSES the
    // security — an authoritative ATS lifecycle control. canTransferByPartition returns false for
    // a paused token, so C can never be committed as replacement collateral.
    let pause = null;
    if (!s.eligible) {
      pause = await Security.pause(new PauseRequest({ securityId }));
      console.log(`  PAUSED series ${s.key} — now non-transferable  tx ${pause.transactionId}`);
    }

    out.series[s.key] = {
      name: s.name,
      symbol: s.symbol,
      isin: s.isin,
      securityId,
      hashscan: HASHSCAN(securityId),
      createTx,
      createTxHashscan: createTx ? HASHSCAN_TX(createTx) : null,
      issueTx: issue.transactionId,
      issued: ISSUE_AMOUNT,
      eligible: s.eligible,
      pausedTx: pause?.transactionId ?? null,
    };
    writeProof(out);
  }

  console.log(`\n✓ wrote ${PROOF}`);
}

main().catch((e) => {
  console.error("\n✗ issuance failed:", e?.message || e);
  if (e?.stack) console.error(e.stack.split("\n").slice(1, 6).join("\n"));
  process.exit(1);
});

/**
 * Generate deployments/instrument-bindings.json.
 *
 * The explicit, provenance-bearing map from every historical `assetId` to an `InstrumentIdentity`
 * (spec/identity-model.md §3). It is regenerated from source — the deployment manifest plus the
 * identity inputs held in this file — and `scripts/check-instrument-bindings.mjs` proves the
 * committed artifact is byte-identical to a fresh run, so a hand edit fails a gate.
 *
 * This is a migration record, not a reinterpretation: the deployed `assetId` values are unchanged
 * and every historical `passportId` / proof reference stays valid.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { registerWorkspaceResolver, repoRoot } from "./_workspace.mjs";
import { writeArtifact, digestOf } from "./_artifact.mjs";

registerWorkspaceResolver();
const {
  instrumentIdentitySchema,
  instrumentBindingsArtifactSchema,
  instrumentBindingId,
} = await import("@usance/schemas");

const ZERO32 = `0x${"00".repeat(32)}`;
const CHAIN_ID = 1952;

const manifestRaw = readFileSync(resolve(repoRoot, `deployments/${CHAIN_ID}.json`), "utf8");
const manifest = JSON.parse(manifestRaw);

// The X Layer testnet deployment digest current when this binding was authored. A later redeploy
// changes it, and the freshness check refuses the stale artifact.
const deploymentDigest = digestOf(manifestRaw);

/**
 * Identity inputs, authored here. Every derived id comes from `instrumentIdentitySchema.parse`,
 * so the artifact and `spec/identity-model.md` cannot drift apart silently.
 *
 * The X Layer testnet settlement and collateral tokens are labelled stand-ins with no issuer
 * relationship — `deployments/1952.json.testnetFixtures.note` says so. Their identity records say
 * so too: a synthetic "Usance Testnet" issuer, and an underlying name that carries the caveat.
 */
const TESTNET_ISSUER = { legalName: "Usance Testnet Fixtures", jurisdiction: "ZZ" };

const inputs = [
  {
    legacyAssetId: manifest.settlementAsset.assetId,
    legacyAssetIdKind: "DERIVED",
    boundAtDomain: "eip155:1952",
    note:
      "X Layer testnet settlement stand-in tUSD (deployments/1952.json settlementAsset). " +
      "TEST ASSET, no real value, no issuer relationship. Bound under Product Lock Phase 01.",
    identity: {
      domain: { caip2: "eip155:1952", label: "X Layer testnet" },
      canonicalRef: { kind: "evm", token: manifest.settlementAsset.token },
      issuer: TESTNET_ISSUER,
      standard: "ERC20",
      instrumentVersion: 1,
      underlying: {
        assetClass: "CASH",
        isin: "",
        figi: "",
        ticker: "",
        name: "US Dollar (Usance testnet stand-in, not a real claim)",
      },
      accountingMode: "FIXED_UNIT",
    },
  },
  {
    legacyAssetId: manifest.testnetFixtures.collateralAssetId,
    legacyAssetIdKind: "DERIVED",
    boundAtDomain: "eip155:1952",
    note:
      "X Layer testnet collateral stand-in tUSTB (deployments/1952.json testnetFixtures). " +
      "TEST ASSET, no real value, not FOBXX/OUSG/ARCOIN or any issuer token. " +
      "Bound under Product Lock Phase 01.",
    identity: {
      domain: { caip2: "eip155:1952", label: "X Layer testnet" },
      canonicalRef: { kind: "evm", token: manifest.testnetFixtures.collateralToken },
      issuer: TESTNET_ISSUER,
      standard: "ERC20",
      instrumentVersion: 1,
      underlying: {
        assetClass: "TREASURY",
        isin: "",
        figi: "",
        ticker: "",
        name: "US Treasury bill (Usance testnet stand-in, not a real claim)",
      },
      accountingMode: "FIXED_UNIT",
    },
  },
  {
    // proof/passport-franklin-fobxx-2026-v1.json committed a Passport under a UTF-8 label packed
    // into bytes32, not a derived assetId. No token was ever deployed and nothing was deposited.
    // The binding preserves the historical proof reference and links it to the real fund.
    legacyAssetId: "0x7573616e63652d666978747572652d61737365743a6672616e6b6c696e2d666f",
    legacyAssetIdKind: "FIXTURE_LABEL",
    boundAtDomain: "eip155:1952",
    note:
      "The Franklin FOBXX demo Passport (proof/passport-franklin-fobxx-2026-v1.json) was committed " +
      "on X Layer testnet under assetId 0x7573...666f, which decodes to the ASCII " +
      "'usance-fixture-asset:franklin-fo' — a non-derived fixture label, exactly the ticker-shaped " +
      "identity the Product Lock forbids for production. No token was deployed; nothing was ever " +
      "deposited. Bound to the real fund's identity so the historical proof stays valid and " +
      "unedited. instrumentStandard and accountingMode are recorded as ERC20/FIXED_UNIT by default " +
      "and are NOT authoritative for the real Franklin token.",
    identity: {
      domain: { caip2: "eip155:1952", label: "X Layer testnet" },
      canonicalRef: {
        kind: "raw",
        value: "0x7573616e63652d666978747572652d61737365743a6672616e6b6c696e2d666f",
      },
      // From the committed evidence itself: SEC Form 497K, CIK 1786958, "Franklin Templeton Trust".
      issuer: { legalName: "Franklin Templeton Trust", jurisdiction: "US" },
      standard: "ERC20",
      instrumentVersion: 1,
      underlying: {
        assetClass: "MONEY_MARKET_FUND",
        isin: "",
        figi: "",
        ticker: "FOBXX",
        name: "Franklin OnChain U.S. Government Money Fund",
      },
      accountingMode: "FIXED_UNIT",
    },
  },
];

// Deterministic boundAt: the deployment timestamp, so re-running the generator is byte-stable.
const boundAt = Math.floor(Date.parse(manifest.deployedAt) / 1000);

const instruments = [];
const bindings = [];
const seenInstrumentIds = new Set();

for (const inp of inputs) {
  const parsed = instrumentIdentitySchema.parse(inp.identity);
  if (!seenInstrumentIds.has(parsed.instrumentId)) {
    seenInstrumentIds.add(parsed.instrumentId);
    instruments.push({
      instrumentId: parsed.instrumentId,
      domainId: parsed.domain.domainId,
      caip2: parsed.domain.caip2,
      canonicalRef: parsed.canonicalRefHex,
      canonicalRefKind: parsed.canonicalRef.kind,
      ...(parsed.canonicalRef.kind === "evm" ? { token: parsed.canonicalRef.token } : {}),
      ...(parsed.canonicalRef.kind === "native" ? { nativeId: parsed.canonicalRef.nativeId } : {}),
      issuerId: parsed.issuer.issuerId,
      issuerLegalName: parsed.issuer.legalName,
      issuerJurisdiction: parsed.issuer.jurisdiction,
      instrumentStandard: parsed.standard,
      instrumentStandardId: parsed.instrumentStandardId,
      instrumentVersion: parsed.instrumentVersion,
      underlyingReferenceId: parsed.underlying.underlyingReferenceId,
      underlying: {
        assetClass: parsed.underlying.assetClass,
        isin: parsed.underlying.isin,
        figi: parsed.underlying.figi,
        ticker: parsed.underlying.ticker,
        name: parsed.underlying.name,
      },
      accountingMode: parsed.accountingMode,
    });
  }

  const legacyAssetId = inp.legacyAssetId.toLowerCase();
  bindings.push({
    bindingId: instrumentBindingId(legacyAssetId, parsed.instrumentId, boundAt),
    legacyAssetId,
    legacyAssetIdKind: inp.legacyAssetIdKind,
    instrumentId: parsed.instrumentId,
    boundAt,
    boundAtBlock: 0,
    boundBy: "scripts/gen-instrument-bindings.mjs (Product Lock Phase 01)",
    boundAtDomain: inp.boundAtDomain,
    deploymentDigest,
    supersedes: ZERO32,
    note: inp.note,
  });
}

const body = { instruments, bindings };
const inputDigest = digestOf({ manifest: manifestRaw, inputs });

// Validate before writing — a broken artifact must never reach disk.
instrumentBindingsArtifactSchema.parse({
  $provenance: {
    generatedAt: "x",
    generatedBy: "x",
    gitCommit: "x",
    chainId: CHAIN_ID,
    deploymentDigest: null,
    inputDigest,
    schema: 1,
  },
  ...body,
});

writeArtifact("deployments/instrument-bindings.json", body, {
  chainId: CHAIN_ID,
  inputDigest,
  tool: "scripts/gen-instrument-bindings.mjs",
});

console.log(
  `instrument-bindings.json: ${instruments.length} instruments, ${bindings.length} bindings`,
);

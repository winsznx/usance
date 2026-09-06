/**
 * Generate deployments/facility-descriptors.json.
 *
 * The descriptive layer of `spec/facility-model.md`: the DomainDescriptor for each domain Usance
 * knows about, and the CapitalFacilityDescriptor for each FacilityImplementation — today just the
 * X Layer testnet revolving-credit facility (`ClearingHouse`).
 *
 * A descriptor owns no financial state. It is regenerated from the deployment manifest plus the
 * domain metadata held in this file, and `scripts/check-facility-descriptors.mjs` refuses a hand
 * edit or a stale controller address.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { registerWorkspaceResolver, repoRoot } from "./_workspace.mjs";
import { writeArtifact, digestOf } from "./_artifact.mjs";

registerWorkspaceResolver();
const { domainDescriptorSchema, capitalFacilityDescriptorSchema, facilityDescriptorsArtifactSchema } =
  await import("@usance/schemas");

const CHAIN_ID = 1952;
const manifestRaw = readFileSync(resolve(repoRoot, `deployments/${CHAIN_ID}.json`), "utf8");
const manifest = JSON.parse(manifestRaw);

// Domain metadata, authored here. X Layer testnet values verified in docs/INTEGRATIONS.md and
// packages/xlayer/src/chains.ts. Registering a domain admits nothing (invariant I-76).
const domainInputs = [
  {
    caip2: "eip155:1952",
    label: "X Layer testnet",
    environment: "TESTNET",
    finalityModel: {
      kind: "l2-sequencer",
      // ChainlinkFeedAdapter already consumes the X Layer L2 sequencer uptime feed; the read model
      // treats a position as safe only well behind head. 64 is conservative for a testnet.
      safeDepthBlocks: 64,
      notes: "OP-stack-style L2; sequencer uptime feed gated in ChainlinkFeedAdapter",
    },
    nativeAsset: { symbol: "OKB", decimals: 18 },
    explorerUrl: "https://www.oklink.com/x-layer-testnet",
    adapterVersions: { oracle: "ChainlinkFeedAdapter@1952" },
    status: "ACTIVE",
  },
];

const facilityInputs = [
  {
    facilityType: "REVOLVING_CREDIT",
    homeDomainCaip2: "eip155:1952",
    controller: { kind: "evm", address: manifest.contracts.clearingHouse },
    // A revolving-credit facility is distinguished by its settlement asset.
    discriminator: manifest.settlementAsset.assetId,
    settlementAssetId: manifest.settlementAsset.assetId,
    status: "ACTIVE",
    implementation: ["ClearingHouse", "CollateralVault", "FinancingEngine", "LiquidityVault"],
    note:
      "The existing consumer revolving-credit engine, named as a facility without any bytecode " +
      "change (spec/facility-model.md §5). ClearingHouse remains the sole financial authority.",
  },
];

const domains = domainInputs.map((d) => {
  const parsed = domainDescriptorSchema.parse(d);
  return {
    domainId: parsed.domainId,
    caip2: parsed.caip2,
    label: parsed.label,
    environment: parsed.environment,
    finalityModel: parsed.finalityModel,
    nativeAsset: parsed.nativeAsset,
    explorerUrl: parsed.explorerUrl,
    adapterVersions: parsed.adapterVersions,
    status: parsed.status,
  };
});

const facilities = facilityInputs.map((f) => {
  const parsed = capitalFacilityDescriptorSchema.parse(f);
  return {
    facilityId: parsed.facilityId,
    facilityType: parsed.facilityType,
    homeDomainCaip2: parsed.homeDomainCaip2,
    homeDomainId: parsed.homeDomainId,
    controllerRef: parsed.controllerRef,
    ...(parsed.controller.kind === "evm" ? { controllerAddress: parsed.controller.address } : {}),
    ...(parsed.controller.kind === "native" ? { controllerNativeId: parsed.controller.nativeId } : {}),
    discriminator: parsed.discriminator,
    settlementAssetId: parsed.settlementAssetId,
    status: parsed.status,
    implementation: parsed.implementation,
    migratedTo: parsed.migratedTo,
    note: parsed.note,
  };
});

const body = { domains, facilities };
const inputDigest = digestOf({ manifest: manifestRaw, domainInputs, facilityInputs });

facilityDescriptorsArtifactSchema.parse({
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

writeArtifact("deployments/facility-descriptors.json", body, {
  chainId: CHAIN_ID,
  inputDigest,
  tool: "scripts/gen-facility-descriptors.mjs",
});

console.log(`facility-descriptors.json: ${domains.length} domains, ${facilities.length} facilities`);

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { facilityDescriptorsArtifactSchema, type Hex32 } from "@usance/schemas";
import { InstrumentBindings } from "../src/instrument";
import { FacilityDescriptors, aggregatePortfolio, type FacilityPositionView } from "../src/facility";
import { receiptDomainView } from "../src/receipt-domain";

const repoRoot = resolve(__dirname, "../../..");
const facilityArtifact = JSON.parse(
  readFileSync(resolve(repoRoot, "deployments/facility-descriptors.json"), "utf8"),
);
const bindingsArtifact = JSON.parse(
  readFileSync(resolve(repoRoot, "deployments/instrument-bindings.json"), "utf8"),
);
const manifest = JSON.parse(readFileSync(resolve(repoRoot, "deployments/1952.json"), "utf8"));

const descriptors = FacilityDescriptors.fromArtifact(facilityArtifact);
const bindings = InstrumentBindings.fromArtifact(bindingsArtifact);
const collateralAssetId = manifest.testnetFixtures.collateralAssetId.toLowerCase() as Hex32;
const REVOLVING = descriptors.facilities()[0]!.facilityId;

describe("the committed facility-descriptors artifact", () => {
  it("validates against the schema", () => {
    const r = facilityDescriptorsArtifactSchema.safeParse(facilityArtifact);
    expect(r.success, r.success ? "" : JSON.stringify(r.error?.issues)).toBe(true);
  });

  it("names the X Layer testnet ClearingHouse as a REVOLVING_CREDIT facility on eip155:1952", () => {
    const f = descriptors.facility(REVOLVING);
    expect(f?.facilityType).toBe("REVOLVING_CREDIT");
    expect(f?.homeDomain).toBe("eip155:1952");
    expect(f?.controller?.toLowerCase()).toBe(manifest.contracts.clearingHouse.toLowerCase());
    expect(descriptors.domain("eip155:1952")?.environment).toBe("TESTNET");
  });
});

describe("positionView finality — I-79 (stale can only restrict)", () => {
  const acct = `0x${"a1".repeat(32)}` as Hex32;
  const held = [{ legacyAssetId: collateralAssetId, recognizedUsd18: 1_000n * 10n ** 18n }];

  it("marks a deep-confirmed position safe", () => {
    const v = descriptors.positionView(REVOLVING, acct, held, bindings, {
      observedAtBlock: 1_000,
      headBlock: 1_000 + 64,
    });
    expect(v?.finality).toBe("safe");
    expect(v?.usableRestricted).toBe(false);
    expect(v?.instruments[0]?.instrumentId).toBeTruthy();
    expect(v?.instruments[0]?.homeDomain).toBe("eip155:1952");
  });

  it("marks a shallow position stale and restricted", () => {
    const v = descriptors.positionView(REVOLVING, acct, held, bindings, {
      observedAtBlock: 1_000,
      headBlock: 1_010,
    });
    expect(v?.finality).toBe("stale");
    expect(v?.usableRestricted).toBe(true);
  });

  it("marks a position with no head reading unknown and restricted", () => {
    const v = descriptors.positionView(REVOLVING, acct, held, bindings, {
      observedAtBlock: 1_000,
      headBlock: null,
    });
    expect(v?.finality).toBe("unknown");
    expect(v?.usableRestricted).toBe(true);
  });

  it("derives the position id deterministically", () => {
    const a = descriptors.positionView(REVOLVING, acct, held, bindings, { observedAtBlock: 1, headBlock: 999 });
    const b = descriptors.positionView(REVOLVING, acct, held, bindings, { observedAtBlock: 2, headBlock: 999 });
    expect(a?.positionId).toBe(b?.positionId);
  });
});

describe("aggregatePortfolio — I-79", () => {
  const mk = (finality: FacilityPositionView["finality"], value: bigint): FacilityPositionView => ({
    facilityId: REVOLVING,
    positionId: `0x${"11".repeat(32)}` as Hex32,
    homeDomain: "eip155:1952",
    controller: null,
    instruments: [{ legacyAssetId: collateralAssetId, instrumentId: null, homeDomain: "eip155:1952", recognizedUsd18: value }],
    observedAtBlock: 1,
    finality,
    usableRestricted: finality !== "safe",
  });

  it("sums only safe positions into usable capital; stale ones are shown but excluded", () => {
    const agg = aggregatePortfolio([mk("safe", 100n), mk("stale", 500n), mk("unknown", 9_000n)]);
    expect(agg.usableRecognizedUsd18).toBe(100n);
    expect(agg.restricted).toHaveLength(2);
    expect(agg.note).toMatch(/excluded from usable capital/i);
  });

  it("a fully-confirmed portfolio counts everything", () => {
    const agg = aggregatePortfolio([mk("safe", 100n), mk("safe", 250n)]);
    expect(agg.usableRecognizedUsd18).toBe(350n);
    expect(agg.restricted).toHaveLength(0);
  });
});

describe("receiptDomainView — derived, never stored", () => {
  it("resolves a receipt's instrument and home domain from chainId + financialAssetId", () => {
    const view = receiptDomainView(
      { chainId: 1952, financialAssetId: collateralAssetId },
      bindings,
    );
    expect(view.homeDomain).toBe("eip155:1952");
    expect(view.instrumentId).toBeTruthy();
    expect(view.source).toBe("derived-from-chainId-and-financialAssetId");
  });

  it("falls back to the tx chain when the asset is not bound", () => {
    const view = receiptDomainView(
      { chainId: 1952, financialAssetId: `0x${"de".repeat(32)}` as Hex32 },
      bindings,
    );
    expect(view.homeDomain).toBe("eip155:1952");
    expect(view.instrumentId).toBeNull();
  });

  it("returns null domain for an unknown chain with no bound asset", () => {
    const view = receiptDomainView({ chainId: 999999, financialAssetId: null }, bindings);
    expect(view.homeDomain).toBeNull();
    expect(view.instrumentId).toBeNull();
  });
});

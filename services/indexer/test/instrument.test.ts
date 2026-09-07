import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { instrumentBindingsArtifactSchema, type Hex32 } from "@usance/schemas";
import { InstrumentBindings } from "../src/instrument";

const repoRoot = resolve(__dirname, "../../..");
const artifactRaw = readFileSync(resolve(repoRoot, "deployments/instrument-bindings.json"), "utf8");
const artifact = JSON.parse(artifactRaw);

describe("the committed instrument-bindings artifact", () => {
  it("validates against the schema", () => {
    const r = instrumentBindingsArtifactSchema.safeParse(artifact);
    expect(r.success, r.success ? "" : JSON.stringify(r.error?.issues)).toBe(true);
  });

  it("binds every historical assetId that appears in the deployment manifest and the proof set", () => {
    const bindings = InstrumentBindings.fromArtifact(artifact);

    const wanted = new Map<string, string>();
    const manifest = JSON.parse(
      readFileSync(resolve(repoRoot, "deployments/1952.json"), "utf8"),
    );
    if (manifest.settlementAsset?.assetId) {
      wanted.set(manifest.settlementAsset.assetId.toLowerCase(), "1952 settlementAsset");
    }
    if (manifest.testnetFixtures?.collateralAssetId) {
      wanted.set(manifest.testnetFixtures.collateralAssetId.toLowerCase(), "1952 testnetFixtures");
    }
    // Current records and archived ones. A binding must keep resolving the assetId of a proof
    // that has been superseded and moved to proof/historical/, since the point of the binding is
    // to keep that historical evidence readable without editing it.
    for (const dir of ["proof", "proof/historical"]) {
      for (const f of readdirSync(resolve(repoRoot, dir))) {
        if (!f.endsWith(".json")) continue;
        const doc = JSON.parse(readFileSync(resolve(repoRoot, dir, f), "utf8"));
        if (typeof doc.assetId === "string" && /^0x[0-9a-fA-F]{64}$/.test(doc.assetId)) {
          wanted.set(doc.assetId.toLowerCase(), `${dir}/${f}`);
        }
      }
    }

    expect(wanted.size).toBeGreaterThanOrEqual(3);
    for (const [assetId, source] of wanted) {
      expect(bindings.resolve(assetId as Hex32), `${assetId} (${source}) must resolve`).not.toBeNull();
    }
  });
});

describe("InstrumentBindings resolver", () => {
  const bindings = InstrumentBindings.fromArtifact(artifact);
  const manifest = JSON.parse(readFileSync(resolve(repoRoot, "deployments/1952.json"), "utf8"));
  const settlementAssetId = manifest.settlementAsset.assetId.toLowerCase() as Hex32;
  const collateralAssetId = manifest.testnetFixtures.collateralAssetId.toLowerCase() as Hex32;

  it("resolves the X Layer testnet settlement stand-in to an X Layer instrument", () => {
    const r = bindings.resolve(settlementAssetId);
    expect(r).not.toBeNull();
    expect(r!.caip2).toBe("eip155:1952");
    expect(r!.instrument.instrumentStandard).toBe("ERC20");
    expect(r!.instrument.accountingMode).toBe("FIXED_UNIT");
    expect(bindings.homeDomain(r!.instrumentId)).toBe("eip155:1952");
  });

  it("gives the settlement and collateral stand-ins distinct instrument ids and underlyings", () => {
    const s = bindings.resolve(settlementAssetId)!;
    const c = bindings.resolve(collateralAssetId)!;
    expect(s.instrumentId).not.toBe(c.instrumentId);
    expect(s.instrument.underlyingReferenceId).not.toBe(c.instrument.underlyingReferenceId);
  });

  it("resolves the Franklin FOBXX fixture-label assetId and marks it a fixture label", () => {
    const fobxx = "0x7573616e63652d666978747572652d61737365743a6672616e6b6c696e2d666f" as Hex32;
    const r = bindings.resolve(fobxx);
    expect(r).not.toBeNull();
    expect(r!.binding.legacyAssetIdKind).toBe("FIXTURE_LABEL");
    expect(r!.instrument.issuerLegalName).toBe("Franklin Templeton Trust");
  });

  it("returns null for an assetId that has never been bound", () => {
    expect(bindings.resolve(`0x${"de".repeat(32)}` as Hex32)).toBeNull();
  });

  it("every binding is a root binding today — no supersession has happened yet", () => {
    const zero = `0x${"00".repeat(32)}`;
    for (const b of artifact.bindings) {
      expect(b.supersedes).toBe(zero);
    }
  });
});

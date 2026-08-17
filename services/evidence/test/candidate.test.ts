import { describe, expect, it } from "vitest";
import {
  claimLeaf,
  corroborate,
  merkleRoot,
  normalizeForComparison,
  UNKNOWN,
  type ClaimSet,
  type ClaimValue,
  type CanonicalDocument,
  type Hex32,
} from "@usance/schemas";
import { buildCandidate, buildClaimLeaves, ConflictedClaimSetRejected } from "../src/candidate";
import { ingestFixture } from "./support";

const ASSET_ID = `0x${"c0".repeat(32)}` as const;

function claimSet(
  extractor: string,
  group: string,
  doc: CanonicalDocument,
  values: Readonly<Record<string, ClaimValue | typeof UNKNOWN>>,
): ClaimSet {
  return {
    extractor,
    independenceGroup: group,
    claims: Object.entries(values).map(([field, value]) => ({
      field,
      value,
      locator: value === UNKNOWN ? null : { section: null, startOffset: null, endOffset: null, quote: field },
      evidenceId: doc.evidenceId,
      sourceClass: doc.sourceClass,
      retrievedAt: doc.retrievedAt,
      effectiveAt: doc.effectiveAt,
      expiresAt: null,
      extractor,
      confidenceBps: value === UNKNOWN ? 0 : 10_000,
      corroboratingEvidenceIds: [],
      attestation: null,
    })),
  };
}

function build(doc: CanonicalDocument, sets: readonly ClaimSet[]) {
  return buildCandidate({
    assetId: ASSET_ID,
    version: 1,
    documents: [doc],
    claimSets: sets,
    corroboration: corroborate(sets),
    expiresAt: 0,
    builtAt: 1_786_987_500,
  });
}

describe("passport candidate", () => {
  it("claimsRoot is order-independent for the same claim set", async () => {
    const { result } = await ingestFixture("franklin-fobxx-2025");
    const doc = result.document;

    const a = claimSet("a@1", "deterministic-parser", doc, {
      "transfer.permissionModel": { kind: "enum", ordinal: 1, name: "PERMISSIONED" },
      "backing.model": { kind: "enum", ordinal: 1, name: "FULLY_BACKED" },
    });
    const b = claimSet("b@1", "chaingpt", doc, {
      "backing.model": { kind: "enum", ordinal: 1, name: "FULLY_BACKED" },
      "transfer.permissionModel": { kind: "enum", ordinal: 1, name: "PERMISSIONED" },
    });

    expect(build(doc, [a, b]).candidate.claimsRoot).toBe(build(doc, [b, a]).candidate.claimsRoot);
  });

  it("agreement between two paths collapses to one leaf, so the root is a function of the evidence", async () => {
    const { result } = await ingestFixture("franklin-fobxx-2025");
    const doc = result.document;
    const value: ClaimValue = { kind: "enum", ordinal: 1, name: "PERMISSIONED" };

    const one = claimSet("a@1", "deterministic-parser", doc, { "transfer.permissionModel": value });
    const two = claimSet("b@1", "chaingpt", doc, { "transfer.permissionModel": value });

    expect(buildClaimLeaves([one])).toHaveLength(1);
    expect(buildClaimLeaves([one, two])).toHaveLength(1);
    // Adding a third agreeing path does not move the root. A pipeline that gains an extractor commits
    // the same claimsRoot for the same document.
    expect(build(doc, [one]).candidate.claimsRoot).toBe(build(doc, [one, two]).candidate.claimsRoot);
  });

  it("UNKNOWN is excluded from claimsRoot", async () => {
    const { result } = await ingestFixture("franklin-fobxx-2025");
    const doc = result.document;
    const withUnknowns = claimSet("a@1", "deterministic-parser", doc, {
      "transfer.permissionModel": { kind: "enum", ordinal: 1, name: "PERMISSIONED" },
      "redemption.supported": UNKNOWN,
      "backing.model": UNKNOWN,
    });
    const without = claimSet("a@1", "deterministic-parser", doc, {
      "transfer.permissionModel": { kind: "enum", ordinal: 1, name: "PERMISSIONED" },
    });

    expect(build(doc, [withUnknowns]).candidate.claimsRoot).toBe(build(doc, [without]).candidate.claimsRoot);
  });

  it("claimsRoot matches an independently computed root over the same leaves", async () => {
    const { result } = await ingestFixture("franklin-fobxx-2025");
    const doc = result.document;
    const value: ClaimValue = { kind: "enum", ordinal: 1, name: "PERMISSIONED" };
    const set = claimSet("a@1", "deterministic-parser", doc, { "transfer.permissionModel": value });

    const expected = merkleRoot([
      claimLeaf("transfer.permissionModel", normalizeForComparison(value), doc.evidenceId),
    ]);
    expect(build(doc, [set]).candidate.claimsRoot).toBe(expected);
  });

  it("evidenceRoot is a set root: order and duplicates do not move it", async () => {
    const a = (await ingestFixture("franklin-fobxx-2024")).result.document;
    const b = (await ingestFixture("franklin-fobxx-2025")).result.document;

    const sets = [claimSet("p@1", "deterministic-parser", a, { "backing.model": UNKNOWN })];
    const common = { assetId: ASSET_ID, version: 1, claimSets: sets, corroboration: corroborate(sets), expiresAt: 0, builtAt: 1 };

    const forward = buildCandidate({ ...common, documents: [a, b] }).candidate.evidenceRoot;
    const reverse = buildCandidate({ ...common, documents: [b, a] }).candidate.evidenceRoot;
    const duplicated = buildCandidate({ ...common, documents: [a, b, a] }).candidate.evidenceRoot;

    expect(reverse).toBe(forward);
    expect(duplicated).toBe(forward);
    expect(forward).toBe(merkleRoot([a.evidenceId, b.evidenceId] as Hex32[]));
  });

  it("refuses to build anything from a conflicted corroboration", async () => {
    const { result } = await ingestFixture("franklin-fobxx-2025");
    const doc = result.document;

    const p = claimSet("p@1", "deterministic-parser", doc, {
      "transfer.permissionModel": { kind: "enum", ordinal: 1, name: "PERMISSIONED" },
    });
    const m = claimSet("m@1", "chaingpt", doc, {
      "transfer.permissionModel": { kind: "enum", ordinal: 0, name: "OPEN" },
    });

    const corroboration = corroborate([p, m]);
    expect(corroboration.outcome).toBe("CLAIM_CONFLICT");
    expect(() => build(doc, [p, m])).toThrow(ConflictedClaimSetRejected);
  });

  describe("redemption resolution", () => {
    it("carries a floor only when two independent paths agree on it", async () => {
      const { result } = await ingestFixture("franklin-fobxx-2025");
      const doc = result.document;
      const values = {
        "redemption.supported": { kind: "bool", value: true } as ClaimValue,
        "redemption.floorBps": { kind: "bps", value: 9_900 } as ClaimValue,
      };

      const both = build(doc, [
        claimSet("p@1", "deterministic-parser", doc, values),
        claimSet("m@1", "chaingpt", doc, values),
      ]);
      expect(both.candidate.redemptionSupported).toBe(true);
      expect(both.candidate.redemptionFloorBps).toBe(9_900);
      expect(both.redemptionWithheldReason).toBeNull();
    });

    it("withholds a single-source floor, because a floor is the one field that can raise capacity", async () => {
      const { result } = await ingestFixture("franklin-fobxx-2025");
      const doc = result.document;

      const one = build(doc, [
        claimSet("p@1", "deterministic-parser", doc, {
          "redemption.supported": { kind: "bool", value: true },
          "redemption.floorBps": { kind: "bps", value: 9_900 },
        }),
      ]);
      expect(one.candidate.redemptionSupported).toBe(false);
      expect(one.candidate.redemptionFloorBps).toBe(0);
      expect(one.redemptionWithheldReason).toMatch(/not AGREED/);
    });

    it("never commits redemptionSupported with a zero floor", async () => {
      // The failure this prevents: RiskMath includes the floor term iff redemptionSupported, so
      // supported=true with floorBps=0 drives recognised value to zero and the asset stops being
      // collateral. The two fields are one fact.
      const { result } = await ingestFixture("franklin-fobxx-2025");
      const doc = result.document;
      const values = { "redemption.supported": { kind: "bool", value: true } as ClaimValue };

      const built = build(doc, [
        claimSet("p@1", "deterministic-parser", doc, values),
        claimSet("m@1", "chaingpt", doc, values),
      ]);
      expect(built.candidate.redemptionSupported).toBe(false);
      expect(built.candidate.redemptionFloorBps).toBe(0);
      expect(built.redemptionWithheldReason).toMatch(/zero floor/);
    });

    it("a document stating redemption is not supported yields false, floor 0", async () => {
      const { result } = await ingestFixture("franklin-fobxx-2025");
      const doc = result.document;
      const values = {
        "redemption.supported": { kind: "bool", value: false } as ClaimValue,
        "redemption.floorBps": { kind: "bps", value: 9_900 } as ClaimValue,
      };

      const built = build(doc, [
        claimSet("p@1", "deterministic-parser", doc, values),
        claimSet("m@1", "chaingpt", doc, values),
      ]);
      expect(built.candidate.redemptionSupported).toBe(false);
      expect(built.candidate.redemptionFloorBps).toBe(0);
    });

    it("a floor of the wrong value kind is not coerced into a number", async () => {
      const { result } = await ingestFixture("franklin-fobxx-2025");
      const doc = result.document;
      const values = {
        "redemption.supported": { kind: "bool", value: true } as ClaimValue,
        "redemption.floorBps": { kind: "string", value: "99%" } as ClaimValue,
      };

      const built = build(doc, [
        claimSet("p@1", "deterministic-parser", doc, values),
        claimSet("m@1", "chaingpt", doc, values),
      ]);
      expect(built.candidate.redemptionSupported).toBe(false);
      expect(built.candidate.redemptionFloorBps).toBe(0);
    });
  });
});

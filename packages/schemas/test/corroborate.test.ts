import { describe, expect, it } from "vitest";
import { corroborate, isRiskBearing } from "../src/corroborate";
import { UNKNOWN } from "../src/primitives";
import { SourceClass } from "../src/source-class";
import type { ClaimSet, EvidenceClaim } from "../src/evidence";

const E = "0x" + "11".repeat(32);

function claim(field: string, value: EvidenceClaim["value"], extractor: string): EvidenceClaim {
  return {
    field,
    value,
    locator: value === UNKNOWN ? null : { section: null, startOffset: null, endOffset: null, quote: "q" },
    evidenceId: E as `0x${string}`,
    sourceClass: SourceClass.ISSUER_DOC,
    retrievedAt: 1_750_000_000,
    effectiveAt: 1_750_000_000,
    expiresAt: null,
    extractor,
    confidenceBps: 10_000,
    corroboratingEvidenceIds: [],
    attestation: null,
  };
}

function set(extractor: string, group: string, claims: EvidenceClaim[]): ClaimSet {
  return { extractor, independenceGroup: group, claims };
}

describe("corroboration", () => {
  it("two independent paths agreeing is CORROBORATED", () => {
    const r = corroborate([
      set("parser@1", "deterministic-parser", [claim("redemption.supported", { kind: "bool", value: true }, "parser@1")]),
      set("chaingpt", "chaingpt", [claim("redemption.supported", { kind: "bool", value: true }, "chaingpt")]),
    ]);
    expect(r.outcome).toBe("CORROBORATED");
    expect(r.independentPathCount).toBe(2);
    expect(r.fields[0]!.outcome).toBe("AGREED");
  });

  it("two independent paths disagreeing on a risk-bearing field is CLAIM_CONFLICT", () => {
    const r = corroborate([
      set("parser@1", "deterministic-parser", [claim("redemption.supported", { kind: "bool", value: true }, "parser@1")]),
      set("chaingpt", "chaingpt", [claim("redemption.supported", { kind: "bool", value: false }, "chaingpt")]),
    ]);
    expect(r.outcome).toBe("CLAIM_CONFLICT");
  });

  it("disagreement on a descriptive field does NOT conflict", () => {
    // Restricting an asset because two extractors phrased a custodian name differently would make
    // the conflict state useless through noise.
    expect(isRiskBearing("backing.custodianName")).toBe(false);
    const r = corroborate([
      set("parser@1", "deterministic-parser", [claim("backing.custodianName", { kind: "string", value: "A" }, "parser@1")]),
      set("chaingpt", "chaingpt", [claim("backing.custodianName", { kind: "string", value: "B" }, "chaingpt")]),
    ]);
    expect(r.outcome).not.toBe("CLAIM_CONFLICT");
    expect(r.fields[0]!.outcome).toBe("CONFLICT");
  });

  it("TWO PROMPTS AGAINST ONE MODEL CANNOT CORROBORATE EACH OTHER", () => {
    // The failure this whole mechanism exists to prevent: a single hallucination agreeing with
    // itself and being counted as two independent readings.
    const r = corroborate([
      set("chaingpt-a", "chaingpt", [claim("redemption.supported", { kind: "bool", value: true }, "chaingpt-a")]),
      set("chaingpt-b", "chaingpt", [claim("redemption.supported", { kind: "bool", value: true }, "chaingpt-b")]),
    ]);
    expect(r.independentPathCount).toBe(1);
    expect(r.outcome).toBe("SINGLE_SOURCE");
  });

  it("one path alone is SINGLE_SOURCE", () => {
    const r = corroborate([
      set("parser@1", "deterministic-parser", [claim("redemption.supported", { kind: "bool", value: true }, "parser@1")]),
    ]);
    expect(r.outcome).toBe("SINGLE_SOURCE");
    expect(r.fields[0]!.outcome).toBe("SINGLE");
  });

  it("both paths UNKNOWN is ABSENT and never an agreement", () => {
    const r = corroborate([
      set("parser@1", "deterministic-parser", [claim("redemption.floorBps", UNKNOWN, "parser@1")]),
      set("chaingpt", "chaingpt", [claim("redemption.floorBps", UNKNOWN, "chaingpt")]),
    ]);
    expect(r.fields[0]!.outcome).toBe("ABSENT");
    expect(r.outcome).toBe("SINGLE_SOURCE");
    expect(r.independentPathCount).toBe(0);
  });

  it("enum comparison is by ordinal, not by label", () => {
    const r = corroborate([
      set("parser@1", "deterministic-parser", [
        claim("transfer.permissionModel", { kind: "enum", ordinal: 1, name: "PERMISSIONED" }, "parser@1"),
      ]),
      set("chaingpt", "chaingpt", [
        claim("transfer.permissionModel", { kind: "enum", ordinal: 1, name: "RESTRICTED" }, "chaingpt"),
      ]),
    ]);
    // Same ordinal, different label. Two extractors rendering an enum differently is not a
    // disagreement about the world.
    expect(r.fields[0]!.outcome).toBe("AGREED");
    expect(r.outcome).toBe("CORROBORATED");
  });

  it("strings compare after case and whitespace normalisation", () => {
    const r = corroborate([
      set("a", "g1", [claim("legal.governingLaw", { kind: "string", value: "Laws of  Jersey" }, "a")]),
      set("b", "g2", [claim("legal.governingLaw", { kind: "string", value: "laws of jersey" }, "b")]),
    ]);
    expect(r.fields[0]!.outcome).toBe("AGREED");
  });
});

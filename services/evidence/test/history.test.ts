import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import type { Hex32 } from "@usance/schemas";
import { diffFilings, MATERIAL_FIELDS, RISK_DIRECTION, type FilingSnapshot } from "../src/history";

const snap = (id: string, claims: Record<string, unknown>, hash = "aa"): FilingSnapshot => ({
  id,
  contentHash: `0x${hash.repeat(32)}` as Hex32,
  claims: new Map(Object.entries(claims)),
});

describe("semantic diff between filings", () => {
  it("reports no material change when the terms are the same", () => {
    const a = snap("2024", { "redemption.supported": { kind: "bool", value: true } }, "aa");
    const b = snap("2025", { "redemption.supported": { kind: "bool", value: true } }, "bb");

    const d = diffFilings(a, b);
    expect(d.classification).toBe("NO_MATERIAL_CHANGE");
    // Byte-different documents saying the same thing is the normal case, and the point of diffing
    // claims rather than text.
    expect(d.contentHashesDiffer).toBe(true);
  });

  it("detects a redemption withdrawal as a deterioration", () => {
    const d = diffFilings(
      snap("2024", { "redemption.supported": { kind: "bool", value: true } }),
      snap("2025", { "redemption.supported": { kind: "bool", value: false } }, "bb"),
    );
    expect(d.classification).toBe("MATERIAL_RISK_DETERIORATION");
    expect(d.changes[0]?.riskDirection).toBe("DETERIORATION");
  });

  it("detects a longer redemption window as a deterioration", () => {
    const d = diffFilings(
      snap("2024", { "redemption.estimatedWindowSeconds": { kind: "duration", value: 172_800 } }),
      snap("2025", { "redemption.estimatedWindowSeconds": { kind: "duration", value: 604_800 } }, "bb"),
    );
    expect(d.classification).toBe("MATERIAL_RISK_DETERIORATION");
  });

  it("detects a shorter redemption window as an improvement", () => {
    const d = diffFilings(
      snap("2024", { "redemption.estimatedWindowSeconds": { kind: "duration", value: 604_800 } }),
      snap("2025", { "redemption.estimatedWindowSeconds": { kind: "duration", value: 172_800 } }, "bb"),
    );
    expect(d.classification).toBe("MATERIAL_RISK_IMPROVEMENT");
  });

  it("treats a tightened transfer model as a deterioration", () => {
    const d = diffFilings(
      snap("2024", { "transfer.permissionModel": { kind: "enum", ordinal: 0, name: "PERMISSIONLESS" } }),
      snap("2025", { "transfer.permissionModel": { kind: "enum", ordinal: 2, name: "RESTRICTED" } }, "bb"),
    );
    expect(d.classification).toBe("MATERIAL_RISK_DETERIORATION");
  });

  it("deterioration outweighs improvement when a filing does both", () => {
    // A shorter window plus a new gate has not made the asset safer on balance, and a
    // classification that averaged the two would report exactly that.
    const d = diffFilings(
      snap("2024", {
        "redemption.estimatedWindowSeconds": { kind: "duration", value: 604_800 },
        "redemption.gateable": { kind: "bool", value: false },
      }),
      snap("2025", {
        "redemption.estimatedWindowSeconds": { kind: "duration", value: 86_400 },
        "redemption.gateable": { kind: "bool", value: true },
      }, "bb"),
    );
    expect(d.classification).toBe("MATERIAL_RISK_DETERIORATION");
  });

  it("a change with no encoded direction is material but not a risk verdict", () => {
    const d = diffFilings(
      snap("2024", { "backing.custodian": { kind: "string", value: "Custodian A" } }),
      snap("2025", { "backing.custodian": { kind: "string", value: "Custodian B" } }, "bb"),
    );
    expect(d.classification).toBe("MATERIAL_CHANGE_NO_RISK_IMPACT");
    expect(d.changes[0]?.riskDirection).toBeNull();
  });

  it("a field one filing mentions and the other does not is coverage, not a change in terms", () => {
    const d = diffFilings(
      snap("2024", { "redemption.gateable": { kind: "bool", value: true } }),
      snap("2025", {}, "bb"),
    );
    expect(d.changes[0]?.kind).toBe("COVERAGE_DIFFERENCE");
    expect(d.classification).toBe("NO_MATERIAL_CHANGE");
    expect(d.coverageDifferences).toBe(1);
  });

  it("counts only fields comparable on both sides as compared", () => {
    // The honest denominator. "17 fields compared, no change" reads as strong evidence and is not,
    // if fifteen were absent from both filings — two silences agreeing is not a comparison.
    const d = diffFilings(
      snap("2024", { "redemption.supported": { kind: "bool", value: true } }),
      snap("2025", { "redemption.supported": { kind: "bool", value: true } }, "bb"),
    );
    expect(d.coverage.fieldsComparedOnBothSides).toBe(1);
    expect(d.coverage.fieldsInScope).toBe(MATERIAL_FIELDS.length);
    expect(d.coverage.fieldsAbsentFromBoth).toBe(MATERIAL_FIELDS.length - 1);
  });

  it("says so plainly when nothing was comparable", () => {
    const d = diffFilings(snap("2024", {}), snap("2025", {}, "bb"));
    expect(d.coverage.fieldsComparedOnBothSides).toBe(0);
    expect(d.coverage.note).toContain("asserts nothing");
  });

  it("every field with an encoded risk direction is in the material set", () => {
    for (const field of Object.keys(RISK_DIRECTION)) expect(MATERIAL_FIELDS).toContain(field);
  });
});

describe("the Franklin history artifact", () => {
  const path = resolve(__dirname, "../../../artifacts/evidence/franklin-history.json");

  it("records both transitions with honest coverage", () => {
    expect(existsSync(path), "run `node scripts/franklin-history.mjs` first").toBe(true);
    const doc = JSON.parse(readFileSync(path, "utf8"));

    expect(doc.filings.map((f: { fixtureId: string }) => f.fixtureId)).toEqual([
      "franklin-fobxx-2024",
      "franklin-fobxx-2025",
      "franklin-fobxx-2026",
    ]);
    expect(doc.transitions.length).toBe(2);

    for (const t of doc.transitions) {
      // The measured result: three real filings, a year apart, saying the same things about the
      // fund's terms. Not manufactured deterioration.
      expect(t.classification).toBe("NO_MATERIAL_CHANGE");
      expect(t.contentHashesDiffer).toBe(true);
      expect(t.coverage.fieldsComparedOnBothSides).toBeGreaterThan(0);
      expect(t.coverage.fieldsComparedOnBothSides).toBeLessThan(t.coverage.fieldsInScope);
    }
  });

  it("each filing is a distinct document", () => {
    const doc = JSON.parse(readFileSync(path, "utf8"));
    const hashes = doc.filings.map((f: { contentHash: string }) => f.contentHash);
    expect(new Set(hashes).size).toBe(3);
  });
});

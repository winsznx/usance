import { describe, expect, it } from "vitest";
import {
  actionsWithinVocabulary,
  MANDATE_ACTION_COUNT,
  maskForActions,
  maskRaisesRisk,
} from "../src/mandate-actions";
import { isSessionRestrictive, marketSessionSchema } from "../src/sentinel-market";
import {
  isRestrictingStatusChange,
  manifestHashFor,
  MAX_TEMPLATE_FLAT_FEE_USD18,
  sentinelTemplateManifestSchema,
  sentinelTemplateVersionSchema,
  templateIdFor,
  triggerClassMaskFor,
  triggerClassesWithinVocabulary,
} from "../src/sentinel-template";
import type { Hex32 } from "../src/primitives";

const ID = (n: number): Hex32 => `0x${n.toString(16).padStart(64, "0")}` as Hex32;
const ADDR = (n: number): `0x${string}` => `0x${n.toString(16).padStart(40, "0")}`;

const baseManifest = {
  templateId: ID(0x71),
  version: 1,
  publisher: ADDR(0x9b),
  name: "Safety Buffer",
  description: "Keeps an account's safety buffer above a target by repaying debt.",
  riskClass: "RISK_REDUCING_ONLY" as const,
  requiredActions: maskForActions(["REPAY", "ADD_COLLATERAL"]),
  requiredTriggerClasses: triggerClassMaskFor(["RISK_STATE", "ONCHAIN_STATE", "TIME"]),
  configSchemaHash: ID(0xc1),
  triggerSchemaHash: ID(0xc2),
  planSchemaHash: ID(0xc3),
  feePolicy: { perSuccessfulRunBps: 100, flatPerRunUsd18: "0" },
  compilerVersion: "t1@1.0.0",
  minimumProtocolVersion: "1.0.0",
  createdAt: 1_750_000_000,
};

describe("mandate action vocabulary", () => {
  it("has six verbs and maps names to bits order-insensitively", () => {
    expect(MANDATE_ACTION_COUNT).toBe(6);
    expect(maskForActions(["REPAY", "ADD_COLLATERAL"])).toBe((1 << 1) | (1 << 2));
    expect(maskForActions(["ADD_COLLATERAL", "REPAY"])).toBe(maskForActions(["REPAY", "ADD_COLLATERAL"]));
  });

  it("rejects a bit outside the vocabulary", () => {
    expect(actionsWithinVocabulary((1 << MANDATE_ACTION_COUNT) - 1)).toBe(true);
    expect(actionsWithinVocabulary(1 << MANDATE_ACTION_COUNT)).toBe(false);
    expect(actionsWithinVocabulary(-1)).toBe(false);
  });

  it("knows which verbs raise risk", () => {
    expect(maskRaisesRisk(maskForActions(["REPAY", "ADD_COLLATERAL"]))).toBe(false);
    expect(maskRaisesRisk(maskForActions(["BORROW"]))).toBe(true);
    expect(maskRaisesRisk(maskForActions(["TRADE"]))).toBe(true);
  });
});

describe("market session", () => {
  it("treats only a proven-OPEN session as unrestricted", () => {
    expect(isSessionRestrictive("OPEN")).toBe(false);
    expect(isSessionRestrictive("UNKNOWN")).toBe(true);
    expect(isSessionRestrictive("CLOSED")).toBe(true);
    expect(isSessionRestrictive("PRE_MARKET")).toBe(true);
  });

  it("rejects a session outside the vocabulary", () => {
    expect(() => marketSessionSchema.parse("HALTED")).toThrow();
  });
});

describe("template manifest", () => {
  it("accepts a well-formed manifest and rejects unknown fields", () => {
    expect(sentinelTemplateManifestSchema.parse(baseManifest).riskClass).toBe("RISK_REDUCING_ONLY");
    expect(() => sentinelTemplateManifestSchema.parse({ ...baseManifest, sneak: 1 })).toThrow();
  });

  it("refuses a risk-increasing action on a RISK_REDUCING_ONLY template (I-66, manifest half)", () => {
    expect(() =>
      sentinelTemplateManifestSchema.parse({
        ...baseManifest,
        requiredActions: maskForActions(["REPAY", "BORROW"]),
      }),
    ).toThrow();
  });

  it("bounds the fee policy at the ceilings", () => {
    expect(() =>
      sentinelTemplateManifestSchema.parse({
        ...baseManifest,
        feePolicy: { perSuccessfulRunBps: 1_001, flatPerRunUsd18: "0" },
      }),
    ).toThrow();
    expect(() =>
      sentinelTemplateManifestSchema.parse({
        ...baseManifest,
        feePolicy: { perSuccessfulRunBps: 0, flatPerRunUsd18: String(MAX_TEMPLATE_FLAT_FEE_USD18 + 1n) },
      }),
    ).toThrow();
  });

  it("rejects requiredActions and requiredTriggerClasses bits outside their vocabularies", () => {
    expect(() => sentinelTemplateManifestSchema.parse({ ...baseManifest, requiredActions: 1 << 6 })).toThrow();
    expect(triggerClassesWithinVocabulary(1 << 10)).toBe(true);
    expect(triggerClassesWithinVocabulary(1 << 11)).toBe(false);
  });
});

describe("manifest hashing", () => {
  it("is stable regardless of omitted array defaults", () => {
    const withDefaults = manifestHashFor(baseManifest);
    const withExplicitEmpties = manifestHashFor({ ...baseManifest, requiredCapabilities: [], requiredVenues: [] });
    expect(withDefaults).toBe(withExplicitEmpties);
  });

  it("changes when any manifest field changes", () => {
    expect(manifestHashFor(baseManifest)).not.toBe(manifestHashFor({ ...baseManifest, version: 2 }));
  });

  it("templateIdFor is deterministic and slug-sensitive", () => {
    expect(templateIdFor(ADDR(0x9b), "safety-buffer")).toBe(templateIdFor(ADDR(0x9b), "safety-buffer"));
    expect(templateIdFor(ADDR(0x9b), "safety-buffer")).not.toBe(templateIdFor(ADDR(0x9b), "event-guard"));
  });
});

describe("template status ladder", () => {
  it("only restricts", () => {
    expect(isRestrictingStatusChange("ACTIVE", "DEPRECATED")).toBe(true);
    expect(isRestrictingStatusChange("DEPRECATED", "SECURITY_DISABLED")).toBe(true);
    expect(isRestrictingStatusChange("SECURITY_DISABLED", "ACTIVE")).toBe(false);
  });
});

describe("template version record", () => {
  const version = {
    templateId: ID(0x71),
    version: 1,
    publisher: ADDR(0x9b),
    manifestHash: ID(0xaa),
    configSchemaHash: ID(0xc1),
    triggerSchemaHash: ID(0xc2),
    planSchemaHash: ID(0xc3),
    riskClass: "RISK_REDUCING_ONLY",
    requiredActions: maskForActions(["REPAY"]),
    requiredTriggerClasses: triggerClassMaskFor(["RISK_STATE"]),
    feePolicy: { perSuccessfulRunBps: 0, flatPerRunUsd18: "0" },
    status: "ACTIVE",
    auditStatus: "UNAUDITED",
    minimumProtocolVersion: "1.0.0",
    createdAt: 1,
  };

  it("accepts a stored version and rejects unknown fields", () => {
    expect(sentinelTemplateVersionSchema.parse(version).status).toBe("ACTIVE");
    expect(() => sentinelTemplateVersionSchema.parse({ ...version, extra: 1 })).toThrow();
  });
});

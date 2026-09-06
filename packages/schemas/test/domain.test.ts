import { describe, expect, it } from "vitest";
import {
  DOMAIN_DESCRIPTOR_GRANTS_NOTHING,
  domainDescriptorSchema,
} from "../src/domain";
import { domainId } from "../src/ids";

const wellFormed = {
  caip2: "eip155:8453",
  label: "Base",
  environment: "PRODUCTION" as const,
  finalityModel: { kind: "pos" as const, safeDepthBlocks: 20, notes: "single-slot-ish" },
  nativeAsset: { symbol: "ETH", decimals: 18 },
  explorerUrl: "https://basescan.org",
  status: "ACTIVE" as const,
};

describe("DomainDescriptor — I-76: registering a domain grants nothing", () => {
  it("parses and derives domainId from caip2", () => {
    const d = domainDescriptorSchema.parse(wellFormed);
    expect(d.domainId).toBe(domainId("eip155:8453"));
  });

  it("carries no capability / admission / trust field, and rejects one if added", () => {
    // A domain descriptor must never gain a field that would let registration alone confer a
    // financial capability. If someone adds `capabilities` to the object, `.strict()` rejects it.
    for (const forbidden of DOMAIN_DESCRIPTOR_GRANTS_NOTHING) {
      const r = domainDescriptorSchema.safeParse({ ...wellFormed, [forbidden]: true });
      expect(r.success, `descriptor must reject a '${forbidden}' field`).toBe(false);
    }
  });

  it("an ACTIVE domain is inert — the schema exposes nothing that admits an asset or enables borrowing", () => {
    const d = domainDescriptorSchema.parse(wellFormed);
    // The only status-like field is `status`, and its values are ACTIVE/PAUSED/RETIRED — none of
    // which is "assets admitted" or "collateral enabled". Those are separate decisions.
    expect(Object.keys(d)).not.toContain("admittedAssets");
    expect(Object.keys(d)).not.toContain("collateralEnabled");
    expect(d.status).toBe("ACTIVE");
  });

  it("rejects a non-CAIP-2 string and an unknown environment", () => {
    expect(domainDescriptorSchema.safeParse({ ...wellFormed, caip2: "Base" }).success).toBe(false);
    expect(domainDescriptorSchema.safeParse({ ...wellFormed, environment: "STAGING" }).success).toBe(
      false,
    );
  });

  it("adapterVersions absent means not wired, never trusted", () => {
    const d = domainDescriptorSchema.parse(wellFormed);
    expect(d.adapterVersions).toEqual({});
  });
});

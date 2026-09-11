import { describe, expect, it } from "vitest";
import { BASE_SEPOLIA_PROOF } from "@/lib/base-sepolia-proof";
import { classifyBaseRead } from "@/lib/base-sepolia-facility";

describe("Base Sepolia operational read model", () => {
  it("fails closed when the policy or admitted portfolio is incomplete", () => {
    expect(classifyBaseRead({ admittedCount: 1n, expectedInstrumentCount: 2, allLive: true, instrumentLive: true, policyExists: true })).toBe("PORTFOLIO_UNKNOWN");
    expect(classifyBaseRead({ admittedCount: 2n, expectedInstrumentCount: 2, allLive: true, instrumentLive: true, policyExists: false })).toBe("PORTFOLIO_UNKNOWN");
  });

  it("withholds capacity when market inputs are not live", () => {
    expect(classifyBaseRead({ admittedCount: 2n, expectedInstrumentCount: 2, allLive: false, instrumentLive: false, policyExists: true })).toBe("STALE");
  });

  it("keeps historical proof free of current financial values", () => {
    expect(JSON.stringify(BASE_SEPOLIA_PROOF)).not.toContain("810000");
    expect(JSON.stringify(BASE_SEPOLIA_PROOF)).not.toContain("100300");
  });
});

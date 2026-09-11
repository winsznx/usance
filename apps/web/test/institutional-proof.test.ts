import { describe, expect, it } from "vitest";
import { AUTHORITY_PROOFS, HEDERA_FACILITY, REFUSED_SUBSTITUTION, SUCCESSFUL_SUBSTITUTION } from "../lib/institutional-proof";

describe("institutional proof read model", () => {
  it("keeps the authoritative Hedera facility active and its exact current collateral", () => {
    expect(HEDERA_FACILITY.proofLevel).toBe("LIVE_TESTNET");
    expect(HEDERA_FACILITY.homeDomain).toBe("Hedera testnet (296)");
    expect(HEDERA_FACILITY.status).toBe("ACTIVE");
    expect(HEDERA_FACILITY.currentCollateral.series).toBe("B");
    expect(HEDERA_FACILITY.currentCollateral.committed).toBe("150000");
  });

  it("preserves replacement commitment before old collateral release", () => {
    expect(SUCCESSFUL_SUBSTITUTION.steps.indexOf("REPLACEMENT COMMITTED"))
      .toBeLessThan(SUCCESSFUL_SUBSTITUTION.steps.indexOf("OLD COLLATERAL RELEASED"));
    expect(SUCCESSFUL_SUBSTITUTION.committed).toEqual({ A: "150000", B: "150000" });
  });

  it("keeps authority facts distinct and the CRE proof honestly simulation-only", () => {
    expect(AUTHORITY_PROOFS.ens.provider).toBe("ENSv2");
    expect(AUTHORITY_PROOFS.privy.provider).toBe("Privy");
    expect(AUTHORITY_PROOFS.cre.proofLevel).toBe("LIVE_SIMULATION");
    expect(AUTHORITY_PROOFS.cre).not.toHaveProperty("privateThresholds");
  });

  it("explains the paused ATS negative case without changing secured collateral", () => {
    expect(REFUSED_SUBSTITUTION.reason).toContain("paused");
    expect(REFUSED_SUBSTITUTION.currentCollateral).toBe("150000");
    expect(REFUSED_SUBSTITUTION.candidateCollateral).toBe("0");
    expect(REFUSED_SUBSTITUTION.facilityStatus).toBe("ACTIVE");
  });
});

import { describe, expect, it } from "vitest";
import { creReportHash, decisionHash, FACILITY_OPERATION, orgApprovalHash, type FacilityDecision } from "@/lib/facility-decision";

const BASE: FacilityDecision = {
  facilityId: "0x6534fdf67d36afeeb7118c7d81c7f4e06ab548735483ca249afcf12e6f75b1ee",
  operation: FACILITY_OPERATION.SUBSTITUTE,
  subjectAssetId: "0x7ce7ded85520ee753b041e55c19a672ec3dc2ab28cb812d5d1f30107bfc1a422",
  subjectInstrumentRef: "0x0000000000000000000000002517f707c92c352fe15da6354038ee85a06c826d",
  requestId: `0x${"11".repeat(32)}` as `0x${string}`,
  pinnedEpoch: 1n,
  collateralPolicyVersion: 1n,
  decisionVersion: 1,
  expiry: 1_900_000_000n,
  nonce: 1n,
  proofRef: `0x${"22".repeat(32)}` as `0x${string}`,
  attestationHash: `0x${"33".repeat(32)}` as `0x${string}`,
};

describe("canonical FacilityDecision binding", () => {
  it("is deterministic for identical inputs", () => {
    expect(decisionHash(BASE)).toBe(decisionHash({ ...BASE }));
  });

  it("changes when any bound field changes — requestId is not decorative", () => {
    const changed: FacilityDecision = { ...BASE, requestId: `0x${"44".repeat(32)}` as `0x${string}` };
    expect(decisionHash(changed)).not.toBe(decisionHash(BASE));
  });

  it("changes when the replacement instrument identity changes", () => {
    const changed: FacilityDecision = { ...BASE, subjectAssetId: `0x${"55".repeat(32)}` as `0x${string}` };
    expect(decisionHash(changed)).not.toBe(decisionHash(BASE));
  });

  it("changes when the facility changes — a decision cannot be replayed across facilities", () => {
    const changed: FacilityDecision = { ...BASE, facilityId: `0x${"66".repeat(32)}` as `0x${string}` };
    expect(decisionHash(changed)).not.toBe(decisionHash(BASE));
  });

  it("binds the org approval to both the decision hash and the current ENS digest", () => {
    const dHash = decisionHash(BASE);
    const digestA = `0x${"aa".repeat(32)}` as `0x${string}`;
    const digestB = `0x${"bb".repeat(32)}` as `0x${string}`;
    expect(orgApprovalHash(dHash, digestA)).not.toBe(orgApprovalHash(dHash, digestB));
  });

  it("binds the CRE report to the decision hash, the allow flag, and the policy commitment", () => {
    const dHash = decisionHash(BASE);
    const common = { dHash, policyCommitment: `0x${"cc".repeat(32)}` as `0x${string}`, workflowVersion: 1, reasonCode: `0x${"00".repeat(32)}` as `0x${string}`, expiry: 1_900_000_000n };
    expect(creReportHash({ ...common, allow: true })).not.toBe(creReportHash({ ...common, allow: false }));
  });
});

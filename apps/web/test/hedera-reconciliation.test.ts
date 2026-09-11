import { describe, expect, it } from "vitest";
import { mapReconciliationOutcome } from "@/lib/hedera-reconciliation";

describe("Hedera reconciliation state mapping (§17)", () => {
  it("never resolves COMMITMENT_UNKNOWN to success or failure", () => {
    expect(mapReconciliationOutcome("COMMITMENT_UNKNOWN", true, false)).toBe("COMMITMENT_UNKNOWN");
    expect(mapReconciliationOutcome("COMMITMENT_UNKNOWN", false, true)).toBe("COMMITMENT_UNKNOWN");
  });

  it("flags a mismatched non-zero on-chain requestId as an external attempt", () => {
    expect(mapReconciliationOutcome("REQUESTED", false, false)).toBe("EXTERNAL_ATTEMPT_DETECTED");
    expect(mapReconciliationOutcome("REPLACEMENT_COMMITTED", false, false)).toBe("EXTERNAL_ATTEMPT_DETECTED");
  });

  it("distinguishes a facility that never had a substitution from one that completed this operation's", () => {
    expect(mapReconciliationOutcome("NONE", false, true)).toBe("NONE");
    expect(mapReconciliationOutcome("NONE", true, false)).toBe("OLD_RELEASED");
  });

  it("maps the remaining live sub-states directly", () => {
    expect(mapReconciliationOutcome("REQUESTED", true, false)).toBe("REQUESTED");
    expect(mapReconciliationOutcome("REPLACEMENT_COMMITTING", true, false)).toBe("REPLACEMENT_COMMITTING");
    expect(mapReconciliationOutcome("REPLACEMENT_COMMITTED", true, false)).toBe("REPLACEMENT_COMMITTED");
  });
});

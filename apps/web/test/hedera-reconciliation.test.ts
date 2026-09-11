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

  describe("post-release ambiguity (`_clearSubstitution` zeroes the on-chain requestId)", () => {
    it("without corroboration, a zeroed on-chain requestId after release reads back as NONE, not OLD_RELEASED — this is the ambiguity, not a bug in isolation", () => {
      expect(mapReconciliationOutcome("NONE", false, true, false)).toBe("NONE");
    });

    it("this operation's own durable COMPLETED record breaks the tie toward OLD_RELEASED", () => {
      expect(mapReconciliationOutcome("NONE", false, true, true)).toBe("OLD_RELEASED");
    });

    it("a genuinely-untouched facility (operationAlreadyCompleted=false) still reads NONE even when asked to consider completion", () => {
      expect(mapReconciliationOutcome("NONE", false, true, false)).toBe("NONE");
    });

    it("an external attempt for a different requestId is never reinterpreted as this operation's release, even if this operation is itself completed", () => {
      expect(mapReconciliationOutcome("REQUESTED", false, false, true)).toBe("EXTERNAL_ATTEMPT_DETECTED");
    });
  });
});

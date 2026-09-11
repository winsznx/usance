import { describe, expect, it } from "vitest";
import { canAdvanceOperation, isBlocked } from "@/lib/substitution-operation";

describe("substitution operation safety transitions", () => {
  it("does not advance a terminal operation", () => {
    expect(canAdvanceOperation("COMPLETED", "AWAITING_FINANCIAL_SAFETY")).toBe(false);
    expect(canAdvanceOperation("REFUSED", "COMMITMENT_UNKNOWN")).toBe(false);
  });

  it("requires reconciliation before an unknown execution resumes", () => {
    expect(canAdvanceOperation("COMMITMENT_UNKNOWN", "AWAITING_FINANCIAL_SAFETY")).toBe(true);
    expect(canAdvanceOperation("COMMITMENT_UNKNOWN", "RELEASE_UNKNOWN")).toBe(false);
  });

  it("treats a revoked, expired, or unconfigured authority as blocked, not a silent stall", () => {
    expect(isBlocked("AUTHORITY_REVOKED")).toBe(true);
    expect(isBlocked("AUTHORITY_REQUIRED")).toBe(true);
    expect(isBlocked("AUTHORITY_EXPIRED")).toBe(true);
    expect(isBlocked("ORG_APPROVAL_EXPIRED")).toBe(true);
    expect(isBlocked("POLICY_DENIED")).toBe(true);
  });

  it("does not treat a step still in progress as blocked", () => {
    expect(isBlocked("AUTHORITY_RESOLVING")).toBe(false);
    expect(isBlocked("ORG_APPROVAL_PENDING")).toBe(false);
    expect(isBlocked("CREATED")).toBe(false);
  });
});

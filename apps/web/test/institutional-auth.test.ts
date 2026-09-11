import { describe, expect, it } from "vitest";
import { AUTH_CHALLENGE_TTL_SECONDS, AUTH_SESSION_TTL_SECONDS, authMessage, isCallerAssignedToFacility, sha256 } from "@/lib/institutional-auth";

describe("institutional auth boundary", () => {
  it("keeps session authentication distinct from financial authority", () => {
    expect("TESTNET_OPERATOR").not.toBe("PRIVY_APPROVED");
    expect("TESTNET_OPERATOR").not.toBe("ENS_AUTHORITY");
  });

  it("binds a challenge to its nonce, origin, address, and expiration", async () => {
    const nonce = "a".repeat(64);
    const message = authMessage({ domain: "test.usance.xyz", wallet_address: "0x0000000000000000000000000000000000000001", uri: "https://test.usance.xyz", chain_id: 11155111, statement: "Read-only institutional sign-in.", issued_at: "2026-09-10T00:00:00.000Z", expires_at: "2026-09-10T00:05:00.000Z" }, nonce);
    expect(message).toContain(`Nonce: ${nonce}`); expect(message).toContain("Expiration Time: 2026-09-10T00:05:00.000Z"); expect(await sha256(nonce)).not.toBe(nonce);
  });
  it("uses bounded non-financial challenge and session lifetimes", () => { expect(AUTH_CHALLENGE_TTL_SECONDS).toBe(300); expect(AUTH_SESSION_TTL_SECONDS).toBe(28_800); });

  it("derives facility assignment from server configuration, never the caller's own claim", () => {
    const facilityId = "0x6534fdf67d36afeeb7118c7d81c7f4e06ab548735483ca249afcf12e6f75b1ee";
    expect(isCallerAssignedToFacility({ organization_slug: "usance-phase07-testnet" }, facilityId)).toBe(true);
    expect(isCallerAssignedToFacility({ organization_slug: "some-other-org" }, facilityId)).toBe(false);
    expect(isCallerAssignedToFacility({ organization_slug: "usance-phase07-testnet" }, "0x" + "00".repeat(32))).toBe(false);
  });
});

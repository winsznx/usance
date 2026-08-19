import { describe, it, expect } from "vitest";
import { alertsFor, type AlertInputs } from "../lib/alerts";

/**
 * Alerts are derived, so the tests are about what a user is told rather than about storage.
 *
 * The property that matters most: an alert must never appear for a condition that is not true right
 * now. A stored feed can tell somebody they are in a margin call they cured an hour ago, and the
 * natural reaction to that is to repay money they do not owe.
 */

const base: AlertInputs = {
  status: "NORMAL",
  debt: 0n,
  maintenanceLimit: 1_000n * 10n ** 18n,
  borrowLimit: 800n * 10n ** 18n,
  reserved: 0n,
  riskEpoch: 5,
  lastSeenEpoch: 5,
  gates: 0,
  withdrawableNow: 0n,
  queuedForWithdrawal: 0n,
  mandates: [],
  now: 1_700_000_000,
};

describe("alerts", () => {
  it("a healthy account is told nothing", () => {
    // #then
    expect(alertsFor(base)).toEqual([]);
  });

  it("a margin call names the exact repair amount", () => {
    // #given a debt above the maintenance limit
    const a = alertsFor({ ...base, status: "MARGIN_CALL", debt: 1_200n * 10n ** 18n });

    // #then the shortfall is stated, not just that something is wrong
    expect(a[0]?.severity).toBe("URGENT");
    expect(a[0]?.what).toContain("200.00");
    expect(a[0]?.action?.href).toBe("/app/repay");
  });

  it("a cured account is told nothing about a margin call", () => {
    // #given the same account after repaying
    const a = alertsFor({ ...base, status: "NORMAL", debt: 500n * 10n ** 18n });

    // #then no stale urgency survives, because alerts are derived rather than stored
    expect(a.filter((x) => x.severity === "URGENT")).toEqual([]);
  });

  it("distinguishes a restriction from a liquidation", () => {
    const noNewRisk = alertsFor({ ...base, status: "NO_NEW_RISK" });
    expect(noNewRisk[0]?.why).toContain("not a liquidation");

    const reduceOnly = alertsFor({ ...base, status: "REDUCE_ONLY" });
    expect(reduceOnly[0]?.why).toContain("Nothing is being sold");
  });

  it("an epoch change is only reported when this browser saw an older one", () => {
    // #given a browser that has never quoted
    expect(alertsFor({ ...base, lastSeenEpoch: null, riskEpoch: 9 })).toEqual([]);

    // #when it previously saw epoch 5
    const a = alertsFor({ ...base, lastSeenEpoch: 5, riskEpoch: 9 });

    // #then it is told, because a quote it may still be holding is now refused
    expect(a[0]?.id).toBe("epoch-changed");
  });

  it("a reservation explains why a timeout does not release it", () => {
    const a = alertsFor({ ...base, reserved: 100n * 10n ** 18n });
    expect(a[0]?.why).toContain("does not prove the execution failed");
  });

  it("an expiring mandate warns before it lapses, not after", () => {
    const soon = { mandateId: "0xabc", status: "ACTIVE", expiresAt: base.now + 3600, agent: `0x${"bb".repeat(20)}` };
    const a = alertsFor({ ...base, mandates: [soon] });
    expect(a[0]?.id).toContain("mandate-expiring");
    // Once it has lapsed nothing warns again, which is exactly why the warning has to come early.
    expect(a[0]?.why).toContain("nothing will warn you again");
  });

  it("a mandate far from expiry is not nagged about", () => {
    const later = { mandateId: "0xabc", status: "ACTIVE", expiresAt: base.now + 30 * 86_400, agent: `0x${"bb".repeat(20)}` };
    expect(alertsFor({ ...base, mandates: [later] })).toEqual([]);
  });

  it("a revoked mandate says the authority is permanently over", () => {
    const revoked = { mandateId: "0xabc", status: "REVOKED", expiresAt: base.now + 3600, agent: `0x${"bb".repeat(20)}` };
    const a = alertsFor({ ...base, mandates: [revoked] });
    expect(a[0]?.why).toContain("permanent");
  });

  it("urgent alerts sort above warnings and information", () => {
    const a = alertsFor({
      ...base,
      status: "MARGIN_CALL",
      debt: 1_200n * 10n ** 18n,
      reserved: 10n * 10n ** 18n,
      gates: 1,
    });
    const severities = a.map((x) => x.severity);
    expect(severities[0]).toBe("URGENT");
    expect(severities).toEqual([...severities].sort((x, y) => ({ URGENT: 0, WARN: 1, INFO: 2 })[x] - ({ URGENT: 0, WARN: 1, INFO: 2 })[y]));
  });

  it("every alert says what changed, why it matters and what to do", () => {
    const a = alertsFor({
      ...base,
      status: "MARGIN_CALL",
      debt: 1_200n * 10n ** 18n,
      gates: 2,
      reserved: 5n * 10n ** 18n,
      lastSeenEpoch: 1,
      riskEpoch: 4,
    });
    expect(a.length).toBeGreaterThan(2);
    for (const x of a) {
      // "Something changed" is not an alert. Each of these must be actionable on its own.
      expect(x.what.length, `${x.id} has no "what"`).toBeGreaterThan(20);
      expect(x.why.length, `${x.id} has no "why"`).toBeGreaterThan(20);
      expect(x.title).not.toMatch(/^(Alert|Notice|Warning)$/);
    }
  });
});

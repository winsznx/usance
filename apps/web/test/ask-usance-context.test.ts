import { describe, expect, it } from "vitest";
import { buildFacilityContext, buildReplacementContext } from "../lib/ask-usance-context";
import type { TimelineItem } from "../lib/substitution-evidence-timeline";

describe("buildFacilityContext", () => {
  it("fails closed to 'could not be read' rather than guessing, when the facility read failed", () => {
    const packet = buildFacilityContext({ outcome: "UNAVAILABLE", reason: "RPC timeout" }, "0xfacility");
    expect(packet.text).toContain("could not be read");
    expect(packet.text).toContain("RPC timeout");
    expect(packet.sources).toEqual(["Current state"]);
  });

  it("resolves a known adapter address to its series label", () => {
    const packet = buildFacilityContext(
      {
        outcome: "READY",
        observedAtBlock: "1",
        facility: {
          status: "ACTIVE",
          outstanding: "100",
          riskEpochAtActivation: "2",
          collateral: { assetId: "0x1", instrumentRef: "0x2", adapter: "0xC5E77C98165633c1B093b8bf76d1b923856dFf42", committedUnits: "150000", passportVersion: "0" },
          substitution: { state: "NONE", requestId: "0x0", requiredUnits: "0", authorityExpiry: "0" },
        },
      },
      "0xfacility",
    );
    expect(packet.text).toContain("series B");
    expect(packet.text).toContain("Hedera testnet evidence");
  });

  it("never claims production funds", () => {
    const packet = buildFacilityContext(
      {
        outcome: "READY",
        observedAtBlock: "1",
        facility: {
          status: "ACTIVE",
          outstanding: "0",
          riskEpochAtActivation: "1",
          collateral: { assetId: "0x1", instrumentRef: "0x2", adapter: "0xunknown", committedUnits: "0", passportVersion: "0" },
          substitution: { state: "NONE", requestId: "0x0", requiredUnits: "0", authorityExpiry: "0" },
        },
      },
      "0xfacility",
    );
    expect(packet.text).toContain("not production funds");
    expect(packet.text).toContain("series unknown");
  });
});

describe("buildReplacementContext", () => {
  const OPERATION = { state: "COMPLETED", request_id: "0xabc", replacement_instrument_id: "B", requested_units: "150000" };

  it("surfaces safety events and states collateral remained secured through them", () => {
    const timeline: TimelineItem[] = [
      { provenance: "DURABLE_EVENT", title: "Release paused: settlement valuation was stale", timestamp: "t1" },
      { provenance: "DURABLE_EVENT", title: "Collateral replacement completed", timestamp: "t2" },
    ];
    const packet = buildReplacementContext(OPERATION, "OLD_RELEASED", timeline);
    expect(packet.text).toContain("Release paused: settlement valuation was stale");
    expect(packet.text).toContain("remained secured");
  });

  it("states plainly when no safety events occurred", () => {
    const packet = buildReplacementContext(OPERATION, "OLD_RELEASED", []);
    expect(packet.text).toContain("No safety events were recorded");
  });

  it("includes Receipt and Current state as baseline sources, and adds Onchain transaction when the timeline shows real transactions", () => {
    const timeline: TimelineItem[] = [{ provenance: "ONCHAIN_EVIDENCE", title: "Existing collateral released", timestamp: null, txHash: "0xdead" }];
    const packet = buildReplacementContext(OPERATION, "OLD_RELEASED", timeline);
    expect(packet.sources).toContain("Current state");
    expect(packet.sources).toContain("Receipt");
    expect(packet.sources).toContain("Onchain transaction");
  });

  it("never suggests a financial safe-next-action", () => {
    const packet = buildReplacementContext(OPERATION, "OLD_RELEASED", []);
    for (const action of packet.safeNextActions) {
      expect(action.label).not.toMatch(/borrow|withdraw|trade|approve|sign/i);
    }
  });
});

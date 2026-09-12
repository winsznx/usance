import { describe, expect, it } from "vitest";
import { buildEvidenceTimeline } from "../lib/substitution-evidence-timeline";

const CANONICAL_REQUEST_ID = "0xb1d927f704bd47533a34d800609827fec3ad95c94620b2843e35ac4a67809526";
const OTHER_REQUEST_ID = "0x00000000000000000000000000000000000000000000000000000000000001";

describe("buildEvidenceTimeline", () => {
  it("never fabricates a DURABLE_EVENT for a step only known from the proof manifest", () => {
    const timeline = buildEvidenceTimeline(
      { request_id: CANONICAL_REQUEST_ID, state: "COMPLETED" },
      [{ event_type: "RELEASE_BLOCKED", created_at: "2026-09-11T21:46:04.602151+00:00" }],
    );
    const manifestItems = timeline.filter((item) => item.provenance !== "DURABLE_EVENT");
    expect(manifestItems.length).toBeGreaterThan(0);
    for (const item of manifestItems) expect(item.provenance).not.toBe("DURABLE_EVENT");
  });

  it("returns only durable events for an operation with no written proof manifest", () => {
    const timeline = buildEvidenceTimeline(
      { request_id: OTHER_REQUEST_ID, state: "CREATED" },
      [{ event_type: "OPERATION_CREATED", created_at: "2026-09-11T11:21:42.605798+00:00" }],
    );
    expect(timeline).toHaveLength(1);
    expect(timeline[0]?.provenance).toBe("DURABLE_EVENT");
  });

  it("inserts proof-manifest steps at the documented gap, not appended out of order at the end", () => {
    const timeline = buildEvidenceTimeline(
      { request_id: CANONICAL_REQUEST_ID, state: "COMPLETED" },
      [
        { event_type: "SUBSTITUTION_REQUESTED", created_at: "t1" },
        { event_type: "REPLACEMENT_COMMITTED", created_at: "t2" },
        { event_type: "RELEASE_BLOCKED", created_at: "t3" },
        { event_type: "RELEASE_BLOCKED_REPLACEMENT_PRICE_STALE", created_at: "t4" },
        { event_type: "COMPLETED", created_at: "t5" },
      ],
    );
    const titles = timeline.map((item) => item.title);
    const blockedIndex = titles.indexOf("Release paused: settlement valuation was stale");
    const secondBlockIndex = titles.indexOf("Release paused: replacement valuation was stale");
    const completedIndex = titles.indexOf("Collateral replacement completed");
    // manifest items sit strictly between the two durable blockers, and everything durable after
    // the gap (the second block, then completion) still comes after all manifest items
    expect(blockedIndex).toBeLessThan(secondBlockIndex);
    expect(secondBlockIndex).toBeLessThan(completedIndex);
    const manifestIndices = timeline
      .map((item, i) => (item.provenance !== "DURABLE_EVENT" ? i : -1))
      .filter((i) => i !== -1);
    for (const i of manifestIndices) {
      expect(i as number).toBeGreaterThan(blockedIndex);
      expect(i as number).toBeLessThan(secondBlockIndex);
    }
  });

  it("preserves durable event chronological order regardless of manifest insertion", () => {
    const timeline = buildEvidenceTimeline(
      { request_id: OTHER_REQUEST_ID, state: "CREATED" },
      [
        { event_type: "OPERATION_CREATED", created_at: "2026-01-01T00:00:00Z" },
        { event_type: "AUTHORITY_VALID", created_at: "2026-01-01T00:01:00Z" },
        { event_type: "ORG_APPROVED", created_at: "2026-01-01T00:02:00Z" },
      ],
    );
    const timestamps = timeline.map((item) => item.timestamp);
    expect(timestamps).toEqual(["2026-01-01T00:00:00Z", "2026-01-01T00:01:00Z", "2026-01-01T00:02:00Z"]);
  });

  it("gives every on-chain evidence item from the proof manifest a transaction hash and network", () => {
    const timeline = buildEvidenceTimeline({ request_id: CANONICAL_REQUEST_ID, state: "COMPLETED" }, [
      { event_type: "RELEASE_BLOCKED", created_at: "t" },
    ]);
    const onchain = timeline.filter((item) => item.provenance === "ONCHAIN_EVIDENCE");
    expect(onchain.length).toBeGreaterThan(0);
    for (const item of onchain) {
      expect(item.txHash).toMatch(/^0x[0-9a-f]{64}$/);
      expect(item.network).toBe("hedera-testnet");
    }
  });
});

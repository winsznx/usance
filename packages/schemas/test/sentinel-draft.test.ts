import { describe, expect, it } from "vitest";
import { sentinelDraftSchema } from "../src/sentinel-draft";
import { sentinelObservationSchema } from "../src/sentinel-observation";
import type { Hex32 } from "../src/primitives";

const ID = (n: number): Hex32 => `0x${n.toString(16).padStart(64, "0")}` as Hex32;
const ADDR = (n: number): `0x${string}` => `0x${n.toString(16).padStart(40, "0")}`;

const draft = {
  goal: "Keep my safety buffer above 20% and repay up to 500 tUSD if it drops below that.",
  triggerConditions: [{ class: "RISK_STATE", kind: "HEALTH_CHANGED", bufferAtOrBelowBps: 2000 }],
  allowedActions: ["REPAY"],
  maxPerRunNotionalUsd18: "500000000000000000000",
  dailyNotionalCapUsd18: "1500000000000000000000",
  cooldownSeconds: 900,
  expiresAt: 1_800_000_000,
  allowedTriggerAuthorityClasses: ["DETERMINISTIC_ONCHAIN"],
  confirmationPolicy: { mode: "CONFIRM_RISK_INCREASING" },
};

describe("sentinel draft", () => {
  it("accepts a well-formed draft and fills array defaults", () => {
    const parsed = sentinelDraftSchema.parse(draft);
    expect(parsed.assets).toEqual([]);
    expect(parsed.allowedVenues).toEqual([]);
  });

  it("rejects a smuggled recipient field (strict is the security property)", () => {
    expect(() => sentinelDraftSchema.parse({ ...draft, recipient: ADDR(0xbad) })).toThrow();
  });

  it("rejects a risk parameter the schema does not name", () => {
    // #then a model cannot introduce an LTV or leverage knob the user never sees
    expect(() => sentinelDraftSchema.parse({ ...draft, initialLtvBps: 9000 })).toThrow();
  });

  it("requires at least one action and one trigger condition", () => {
    expect(() => sentinelDraftSchema.parse({ ...draft, allowedActions: [] })).toThrow();
    expect(() => sentinelDraftSchema.parse({ ...draft, triggerConditions: [] })).toThrow();
  });

  it("refuses an active window that closes before it opens", () => {
    expect(() =>
      sentinelDraftSchema.parse({ ...draft, activeWindow: { start: 100, end: 100 } }),
    ).toThrow();
  });
});

const observation = {
  source: "example.com/markets/nvda",
  sourceClass: "NEWS_ARTICLE",
  authority: "AI_INTERPRETED",
  retrievedAt: 1_750_000_000,
  contentHash: ID(0xdeed),
  observationType: "EARNINGS_RUMOR",
};

describe("sentinel observation", () => {
  it("accepts a low-authority observation", () => {
    expect(sentinelObservationSchema.parse(observation).authority).toBe("AI_INTERPRETED");
    expect(sentinelObservationSchema.parse({ ...observation, authority: "EVIDENCE_BOUND" }).authority).toBe(
      "EVIDENCE_BOUND",
    );
    expect(sentinelObservationSchema.parse({ ...observation, authority: "LOW_TRUST_OBSERVATION" })).toBeTruthy();
  });

  it("refuses an observation claiming stronger-than-evidence authority", () => {
    expect(() => sentinelObservationSchema.parse({ ...observation, authority: "DETERMINISTIC_ONCHAIN" })).toThrow();
    expect(() => sentinelObservationSchema.parse({ ...observation, authority: "VERIFIED_EXTERNAL" })).toThrow();
  });

  it("rejects unknown fields and unknown source classes", () => {
    expect(() => sentinelObservationSchema.parse({ ...observation, extra: 1 })).toThrow();
    expect(() => sentinelObservationSchema.parse({ ...observation, sourceClass: "ORACLE" })).toThrow();
  });
});

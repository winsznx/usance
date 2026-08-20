import { describe, expect, it } from "vitest";
import {
  authorityAtLeast,
  authorityRank,
  CLASS_AUTHORITY_CEILING,
  canonicalJson,
  clampAuthority,
  runIdFor,
  scheduleBucket,
  triggerEventSchema,
  triggerIdFor,
  triggerSpecSchema,
  TRIGGER_AUTHORITY_CLASSES,
} from "../src/sentinel-triggers";
import {
  advanceRun,
  canTransitionRun,
  createRun,
  formatUsd18,
  IllegalRunTransition,
  isRunTerminal,
  parseUsd18,
  planHashFor,
  RUN_STATES,
  RUN_TERMINAL_STATES,
  RUN_TRANSITIONS,
  sentinelPlanSchema,
  sentinelRunSchema,
  sentinelSnapshotSchema,
} from "../src/sentinel-run";
import type { Hex32 } from "../src/primitives";

const ID = (n: number): Hex32 => `0x${n.toString(16).padStart(64, "0")}` as Hex32;
const ADDR = (n: number): `0x${string}` => `0x${n.toString(16).padStart(40, "0")}`;

/**
 * A trigger's class decides how far its authority can reach. The order is the policy, so it is
 * pinned here rather than left implicit — reordering this array silently changes what an
 * AI-interpreted trigger is allowed to do (`docs/SENTINELS_SECURITY.md`, I-66).
 */
describe("trigger authority ordering", () => {
  it("runs strongest to weakest, deterministic-onchain first", () => {
    expect(TRIGGER_AUTHORITY_CLASSES[0]).toBe("DETERMINISTIC_ONCHAIN");
    expect(TRIGGER_AUTHORITY_CLASSES[TRIGGER_AUTHORITY_CLASSES.length - 1]).toBe("LOW_TRUST_OBSERVATION");
  });

  it("ranks a stronger class below a weaker one", () => {
    expect(authorityRank("DETERMINISTIC_ONCHAIN")).toBeLessThan(authorityRank("AI_INTERPRETED"));
    expect(authorityRank("VERIFIED_EXTERNAL")).toBeLessThan(authorityRank("LOW_TRUST_OBSERVATION"));
  });

  it("authorityAtLeast is true only at or above the floor", () => {
    // #given VERIFIED_EXTERNAL as the risk-increasing floor
    expect(authorityAtLeast("DETERMINISTIC_ONCHAIN", "VERIFIED_EXTERNAL")).toBe(true);
    expect(authorityAtLeast("VERIFIED_EXTERNAL", "VERIFIED_EXTERNAL")).toBe(true);
    expect(authorityAtLeast("AI_INTERPRETED", "VERIFIED_EXTERNAL")).toBe(false);
  });
});

/**
 * A source may report weaker authority than its class allows, never stronger. This is the guard
 * against a news scraper claiming to be an onchain read.
 */
describe("authority clamping", () => {
  it("caps every class at its ceiling", () => {
    expect(clampAuthority("AI_OBSERVATION", "DETERMINISTIC_ONCHAIN")).toBe("AI_INTERPRETED");
    expect(clampAuthority("ONCHAIN_STATE", "DETERMINISTIC_ONCHAIN")).toBe("DETERMINISTIC_ONCHAIN");
  });

  it("leaves a weaker-than-ceiling claim untouched", () => {
    expect(clampAuthority("MARKET_STATE", "LOW_TRUST_OBSERVATION")).toBe("LOW_TRUST_OBSERVATION");
  });

  it("every trigger class has a ceiling", () => {
    for (const cls of Object.keys(CLASS_AUTHORITY_CEILING)) {
      expect(CLASS_AUTHORITY_CEILING[cls as keyof typeof CLASS_AUTHORITY_CEILING]).toBeTruthy();
    }
  });

  it("no class ceiling is stronger than deterministic-onchain", () => {
    for (const ceiling of Object.values(CLASS_AUTHORITY_CEILING)) {
      expect(authorityRank(ceiling)).toBeGreaterThanOrEqual(authorityRank("DETERMINISTIC_ONCHAIN"));
    }
  });
});

describe("trigger spec validation", () => {
  it("accepts a well-formed RISK_STATE spec", () => {
    const parsed = triggerSpecSchema.parse({ class: "RISK_STATE", kind: "HEALTH_CHANGED", bufferAtOrBelowBps: 2000 });
    expect(parsed).toMatchObject({ class: "RISK_STATE", kind: "HEALTH_CHANGED" });
  });

  it("rejects unknown fields on a spec", () => {
    expect(() =>
      triggerSpecSchema.parse({ class: "MANUAL", sneak: "extra" }),
    ).toThrow();
  });

  it("rejects an unknown trigger class", () => {
    expect(() => triggerSpecSchema.parse({ class: "TELEPATHY" })).toThrow();
  });

  it("requires intervalSeconds for an INTERVAL time trigger", () => {
    // #then the cross-field rule survives the move off the union member
    expect(() => triggerSpecSchema.parse({ class: "TIME", kind: "INTERVAL" })).toThrow();
    expect(triggerSpecSchema.parse({ class: "TIME", kind: "INTERVAL", intervalSeconds: 900 })).toMatchObject({
      class: "TIME",
    });
  });

  it("requires both window bounds for a WINDOW time trigger", () => {
    expect(() => triggerSpecSchema.parse({ class: "TIME", kind: "WINDOW", windowStart: 1 })).toThrow();
    expect(
      triggerSpecSchema.parse({ class: "TIME", kind: "WINDOW", windowStart: 1, windowEnd: 2 }),
    ).toMatchObject({ class: "TIME" });
  });

  it("enforces the same time rule inside a COMPOSITE", () => {
    expect(() =>
      triggerSpecSchema.parse({
        class: "COMPOSITE",
        all: [
          { class: "TIME", kind: "INTERVAL" },
          { class: "MANUAL" },
        ],
      }),
    ).toThrow();
  });

  it("a COMPOSITE needs at least two members", () => {
    expect(() => triggerSpecSchema.parse({ class: "COMPOSITE", all: [{ class: "MANUAL" }] })).toThrow();
  });
});

describe("trigger event validation", () => {
  const base = {
    class: "RISK_STATE" as const,
    authority: "DETERMINISTIC_ONCHAIN" as const,
    identity: { account: ADDR(0xa11ce), epoch: "18" },
    observedAt: 1_750_000_000,
  };

  it("accepts a well-formed event", () => {
    expect(triggerEventSchema.parse(base)).toMatchObject({ class: "RISK_STATE" });
  });

  it("rejects unknown fields", () => {
    expect(() => triggerEventSchema.parse({ ...base, extra: 1 })).toThrow();
  });

  it("caps presentation detail so it cannot smuggle a payload", () => {
    expect(() => triggerEventSchema.parse({ ...base, detail: "x".repeat(2_001) })).toThrow();
  });
});

/**
 * Identity is derived from the source occurrence, never assigned. The whole idempotency story
 * rests on this: the same event on two machines, in any key order, must hash to one id.
 */
describe("trigger and run identity", () => {
  it("triggerIdFor is stable across key order in identity", () => {
    const a = triggerIdFor({ class: "RISK_STATE", identity: { account: ADDR(1), epoch: "18" } });
    const b = triggerIdFor({ class: "RISK_STATE", identity: { epoch: "18", account: ADDR(1) } });
    expect(a).toBe(b);
  });

  it("triggerIdFor changes when the class changes, even with identical identity", () => {
    const id = { asset: ID(0x0a) as string };
    expect(triggerIdFor({ class: "PASSPORT_STATE", identity: id })).not.toBe(
      triggerIdFor({ class: "ORACLE_STATE", identity: id }),
    );
  });

  it("triggerIdFor changes with any identity field", () => {
    const base = triggerIdFor({ class: "RISK_STATE", identity: { account: ADDR(1), epoch: "18" } });
    expect(base).not.toBe(triggerIdFor({ class: "RISK_STATE", identity: { account: ADDR(1), epoch: "19" } }));
    expect(base).not.toBe(triggerIdFor({ class: "RISK_STATE", identity: { account: ADDR(2), epoch: "18" } }));
  });

  it("runIdFor binds instance, trigger and trigger version", () => {
    const t = triggerIdFor({ class: "RISK_STATE", identity: { account: ADDR(1), epoch: "18" } });
    const base = runIdFor(ID(1), t, 1);
    expect(base).toBe(runIdFor(ID(1), t, 1));
    expect(base).not.toBe(runIdFor(ID(2), t, 1));
    expect(base).not.toBe(runIdFor(ID(1), t, 2));
  });

  it("canonicalJson lowercases hex and drops undefined", () => {
    expect(canonicalJson({ a: "0xABCD", b: undefined })).toBe('{"a":"0xabcd"}');
  });

  it("scheduleBucket collapses a window to one identity", () => {
    expect(scheduleBucket(1_000_123, 900)).toBe(scheduleBucket(1_000_456, 900));
    expect(scheduleBucket(1_000_123, 900)).not.toBe(scheduleBucket(1_001_123, 900));
  });
});

describe("usd18 string discipline", () => {
  it("round-trips a canonical integer", () => {
    expect(parseUsd18("1000000000000000000")).toBe(1_000_000_000_000_000_000n);
    expect(formatUsd18(1_000_000_000_000_000_000n)).toBe("1000000000000000000");
  });

  it("refuses a negative amount at format time", () => {
    expect(() => formatUsd18(-1n)).toThrow(RangeError);
  });
});

/**
 * A plan has no recipient, spender or destination field on any arm. That is what makes "arbitrary
 * recipient injection" a parse failure rather than a policy question (I-71).
 */
describe("plan schema has no free-form destination", () => {
  it("accepts a REPAY plan", () => {
    const plan = sentinelPlanSchema.parse({
      action: "REPAY",
      amountUsd18: "500000000000000000000",
      repayAll: false,
      riskDirection: "REDUCING",
    });
    expect(plan.action).toBe("REPAY");
  });

  it("rejects a recipient field smuggled onto a REPAY plan", () => {
    expect(() =>
      sentinelPlanSchema.parse({
        action: "REPAY",
        amountUsd18: "1",
        repayAll: false,
        riskDirection: "REDUCING",
        recipient: ADDR(0xbad),
      }),
    ).toThrow();
  });

  it("pins REPAY and ADD_COLLATERAL to a reducing risk direction", () => {
    expect(() =>
      sentinelPlanSchema.parse({ action: "REPAY", amountUsd18: "1", repayAll: false, riskDirection: "INCREASING" }),
    ).toThrow();
  });

  it("planHashFor is stable and sensitive to amount", () => {
    const p = { action: "REPAY" as const, amountUsd18: "100", repayAll: false, riskDirection: "REDUCING" as const };
    expect(planHashFor(p)).toBe(planHashFor({ ...p }));
    expect(planHashFor(p)).not.toBe(planHashFor({ ...p, amountUsd18: "101" }));
  });
});

describe("snapshot schema", () => {
  const snap = {
    chainId: 1952,
    blockNumber: 38_000_000,
    blockHash: ID(0xbeef),
    account: ADDR(0xa11ce),
    accountStatus: "HEALTHY",
    recognisedUsd18: "1000",
    debtUsd18: "500",
    borrowLimitUsd18: "800",
    maintenanceLimitUsd18: "900",
    availableBorrowUsd18: "300",
    reservedUsd18: "0",
    bufferBps: 2340,
    riskEpoch: 18,
    mandate: {
      mandateId: ID(0x11),
      live: true,
      expiresAt: 1_800_000_000,
      remainingDebtUsd18: "500",
      remainingNotionalUsd18: "0",
    },
    passports: [{ assetId: ID(0x0a), version: 3, status: "ACTIVE" }],
    instanceConfigHash: ID(0xc0ff),
    takenAt: 1_750_000_000,
  };

  it("accepts a full snapshot", () => {
    expect(sentinelSnapshotSchema.parse(snap).riskEpoch).toBe(18);
  });

  it("rejects an unknown field", () => {
    expect(() => sentinelSnapshotSchema.parse({ ...snap, oraclePrice: "1" })).toThrow();
  });

  it("requires riskEpoch to be at least 1", () => {
    expect(() => sentinelSnapshotSchema.parse({ ...snap, riskEpoch: 0 })).toThrow();
  });
});

/**
 * The transition table is the run's law. These tests pin its shape: no generic FAILED, terminal
 * states are sinks, and every blocked/rejected reason is its own terminal.
 */
describe("run state machine", () => {
  it("has no generic FAILED state", () => {
    expect(RUN_STATES).not.toContain("FAILED");
  });

  it("every state key has a transition entry", () => {
    for (const s of RUN_STATES) {
      expect(RUN_TRANSITIONS[s]).toBeDefined();
    }
  });

  it("terminal states are exactly the sinks", () => {
    for (const s of RUN_STATES) {
      expect(isRunTerminal(s)).toBe(RUN_TRANSITIONS[s].length === 0);
    }
    expect(RUN_TERMINAL_STATES).toContain("COMPLETE");
    expect(RUN_TERMINAL_STATES).toContain("BLOCKED_BY_MANDATE");
    expect(RUN_TERMINAL_STATES).not.toContain("SUBMITTED");
  });

  it("every transition target is itself a known state", () => {
    for (const s of RUN_STATES) {
      for (const to of RUN_TRANSITIONS[s]) {
        expect(RUN_STATES).toContain(to);
      }
    }
  });

  it("EXECUTION_UNKNOWN can only move to reconciliation, never to a released terminal", () => {
    // #then unknown execution reconciles; it never silently completes or releases
    expect(RUN_TRANSITIONS.EXECUTION_UNKNOWN).toEqual(["RECONCILING"]);
  });

  it("no terminal state has an outgoing edge (a new trigger is a new run)", () => {
    for (const s of RUN_TERMINAL_STATES) {
      expect(RUN_TRANSITIONS[s]).toHaveLength(0);
    }
  });
});

describe("advanceRun", () => {
  const seed = () =>
    createRun(
      ID(0xa),
      ID(0xb),
      {
        class: "RISK_STATE",
        authority: "DETERMINISTIC_ONCHAIN",
        identity: { account: ADDR(1), epoch: "18" },
        observedAt: 1_750_000_000,
      },
      ID(0xc),
      1,
      1_750_000_000,
    );

  it("starts in TRIGGER_OBSERVED with one history row", () => {
    const run = seed();
    expect(run.state).toBe("TRIGGER_OBSERVED");
    expect(run.history).toHaveLength(1);
    expect(sentinelRunSchema.parse(run)).toBeTruthy();
  });

  it("follows a legal edge and appends history without mutating the input", () => {
    const run = seed();
    const next = advanceRun(run, "TRIGGER_VALIDATED", 1_750_000_001);
    expect(next.state).toBe("TRIGGER_VALIDATED");
    expect(next.history).toHaveLength(2);
    // #then the original is untouched
    expect(run.state).toBe("TRIGGER_OBSERVED");
    expect(run.history).toHaveLength(1);
  });

  it("throws IllegalRunTransition on an edge not in the table", () => {
    const run = seed();
    expect(() => advanceRun(run, "FILLED", 1_750_000_002)).toThrow(IllegalRunTransition);
  });

  it("increments attempts only when entering SUBMITTING", () => {
    let run = seed();
    run = advanceRun(run, "TRIGGER_VALIDATED", 2);
    run = advanceRun(run, "SNAPSHOT_PINNING", 3);
    run = advanceRun(run, "SNAPSHOT_PINNED", 4);
    run = advanceRun(run, "PLANNING", 5);
    run = advanceRun(run, "PLAN_READY", 6);
    run = advanceRun(run, "AUTHORIZATION_CHECKING", 7);
    run = advanceRun(run, "AUTHORIZED", 8);
    expect(run.attempts).toBe(0);
    run = advanceRun(run, "SUBMITTING", 9);
    expect(run.attempts).toBe(1);
  });

  it("carries a plan in and recomputes its hash", () => {
    let run = seed();
    run = advanceRun(run, "TRIGGER_VALIDATED", 2);
    run = advanceRun(run, "SNAPSHOT_PINNING", 3);
    run = advanceRun(run, "SNAPSHOT_PINNED", 4);
    run = advanceRun(run, "PLANNING", 5);
    const plan = { action: "REPAY" as const, amountUsd18: "100", repayAll: false, riskDirection: "REDUCING" as const };
    run = advanceRun(run, "PLAN_READY", 6, { plan });
    expect(run.plan).toEqual(plan);
    expect(run.planHash).toBe(planHashFor(plan));
  });

  it("records the reason on a blocked edge", () => {
    let run = seed();
    run = advanceRun(run, "BLOCKED_BY_POLICY", 2, { reason: "unknown template" });
    expect(run.state).toBe("BLOCKED_BY_POLICY");
    expect(run.history.at(-1)?.reason).toBe("unknown template");
  });
});

describe("run record validation", () => {
  it("canTransitionRun agrees with the table", () => {
    expect(canTransitionRun("AUTHORIZED", "SUBMITTING")).toBe(true);
    expect(canTransitionRun("AUTHORIZED", "FILLED")).toBe(false);
  });

  it("rejects an unknown field on a run record", () => {
    const run = createRun(
      ID(0xa),
      ID(0xb),
      { class: "MANUAL", authority: "DETERMINISTIC_SCHEDULE", identity: { nonce: "1" }, observedAt: 1 },
      ID(0xc),
      1,
      1,
    );
    expect(() => sentinelRunSchema.parse({ ...run, secret: 1 })).toThrow();
  });
});

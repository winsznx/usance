import { describe, expect, it } from "vitest";
import {
  canTransitionInstance,
  confirmationPolicySchema,
  INSTANCE_STATES,
  INSTANCE_TRANSITIONS,
  instanceIdFor,
  isInstanceTerminal,
  priorityRank,
  sentinelInstanceSchema,
  triggerPolicySchema,
} from "../src/sentinel-instance";
import type { Hex32 } from "../src/primitives";

const ID = (n: number): Hex32 => `0x${n.toString(16).padStart(64, "0")}` as Hex32;
const ADDR = (n: number): `0x${string}` => `0x${n.toString(16).padStart(40, "0")}`;

const instance = {
  instanceId: ID(0x1),
  owner: ADDR(0xa11ce),
  account: ADDR(0xa11ce),
  templateId: ID(0x71),
  templateVersion: 1,
  manifestHash: ID(0xaa),
  agentExecutor: ADDR(0xa6e7),
  mandateId: ID(0x11),
  configHash: ID(0xc0),
  triggerPolicy: {
    triggers: [{ class: "RISK_STATE", kind: "HEALTH_CHANGED", bufferAtOrBelowBps: 2000 }],
    allowedAuthorityClasses: ["DETERMINISTIC_ONCHAIN"],
  },
  budgetPolicy: { maxPerRunUsd18: "500000000000000000000", cooldownSeconds: 900 },
  priorityClass: "P1_SAFETY_MAINTENANCE",
  confirmationPolicy: { mode: "AUTO_WITHIN_MANDATE" },
  status: "ARMED",
  createdAt: 1_750_000_000,
  validAfter: 1_750_000_000,
  expiresAt: 1_800_000_000,
  lastRunId: null,
  lastSuccessfulRunAt: null,
};

describe("priority", () => {
  it("orders emergency risk reduction above yield", () => {
    expect(priorityRank("P0_EMERGENCY_RISK_REDUCTION")).toBeLessThan(priorityRank("P4_YIELD_OPPORTUNISTIC"));
  });
});

describe("confirmation policy", () => {
  it("requires a threshold for CONFIRM_ABOVE_AMOUNT", () => {
    expect(() => confirmationPolicySchema.parse({ mode: "CONFIRM_ABOVE_AMOUNT" })).toThrow();
    expect(
      confirmationPolicySchema.parse({ mode: "CONFIRM_ABOVE_AMOUNT", thresholdUsd18: "1" }).mode,
    ).toBe("CONFIRM_ABOVE_AMOUNT");
  });

  it("accepts the bare modes and rejects unknown or extra", () => {
    expect(confirmationPolicySchema.parse({ mode: "AUTO_WITHIN_MANDATE" }).mode).toBe("AUTO_WITHIN_MANDATE");
    expect(() => confirmationPolicySchema.parse({ mode: "CONFIRM_NEVER" })).toThrow();
    expect(() => confirmationPolicySchema.parse({ mode: "CONFIRM_EVERY_ACTION", extra: 1 })).toThrow();
  });
});

describe("trigger policy", () => {
  it("needs at least one trigger and one allowed authority class", () => {
    expect(() =>
      triggerPolicySchema.parse({ triggers: [], allowedAuthorityClasses: ["DETERMINISTIC_ONCHAIN"] }),
    ).toThrow();
    expect(() =>
      triggerPolicySchema.parse({ triggers: [{ class: "MANUAL" }], allowedAuthorityClasses: [] }),
    ).toThrow();
  });
});

describe("instance lifecycle", () => {
  it("allows arming edges and refuses illegal ones", () => {
    expect(canTransitionInstance("ARMED", "PAUSED")).toBe(true);
    expect(canTransitionInstance("PAUSED", "ARMED")).toBe(true);
    expect(canTransitionInstance("ARMED", "DRAFT")).toBe(false);
  });

  it("makes REVOKED terminal and EXPIRED cleanable only by revoking", () => {
    expect(isInstanceTerminal("REVOKED")).toBe(true);
    expect(INSTANCE_TRANSITIONS.REVOKED).toHaveLength(0);
    expect(INSTANCE_TRANSITIONS.EXPIRED).toEqual(["REVOKED"]);
  });

  it("every transition target is a known state", () => {
    for (const s of INSTANCE_STATES) {
      for (const to of INSTANCE_TRANSITIONS[s]) {
        expect(INSTANCE_STATES).toContain(to);
      }
    }
  });
});

describe("instance record", () => {
  it("accepts a full instance and rejects unknown fields", () => {
    expect(sentinelInstanceSchema.parse(instance).status).toBe("ARMED");
    expect(() => sentinelInstanceSchema.parse({ ...instance, secret: 1 })).toThrow();
  });

  it("refuses a validity window that does not open before it closes", () => {
    expect(() => sentinelInstanceSchema.parse({ ...instance, expiresAt: instance.validAfter })).toThrow();
  });

  it("instanceIdFor is deterministic and binds owner and nonce", () => {
    expect(instanceIdFor(ADDR(0xa11ce), 1n)).toBe(instanceIdFor(ADDR(0xa11ce), 1n));
    expect(instanceIdFor(ADDR(0xa11ce), 1n)).not.toBe(instanceIdFor(ADDR(0xa11ce), 2n));
    expect(instanceIdFor(ADDR(0xa11ce), 1n)).not.toBe(instanceIdFor(ADDR(0xb0b), 1n));
  });
});

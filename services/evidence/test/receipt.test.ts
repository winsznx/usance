import { describe, it, expect } from "vitest";
import { usanceReceiptSchema, receiptIdFor } from "../src/receipt";

/**
 * Receipt V1 must survive the additive cross-domain fields — `spec/facility-model.md §11`.
 *
 * `homeDomain` and `instrumentId` were added to `usanceReceiptSchema` as optional, null-defaulted
 * fields. Every existing receipt has neither, and this proves they still parse and that their
 * `receiptId` does not move.
 */

const v1Receipt = {
  receiptId: "liquidated-1952-7bfc13796e0d316b",
  kind: "LIQUIDATED" as const,
  status: "CONFIRMED" as const,
  chainId: 1952,
  accountId: null,
  evidenceAssetId: null,
  financialAssetId: "0x61745a589d0f9875ca3eaeae7588162918edea2e1e85670ff4703c9d75a140d8",
  workflowId: null,
  intentId: null,
  passportVersion: null,
  evidenceRoot: null,
  claimsRoot: null,
  singleSource: null,
  riskPolicyVersion: null,
  riskEpoch: null,
  transactions: [
    {
      chainId: 1952,
      contract: "LiquidationManager",
      txHash: "0x7bfc13796e0d316bded113184252003114ef79d05c0683736c8b05a8846e822e",
      blockNumber: 38700000,
      action: "liquidate",
      status: "success" as const,
      revertReason: null,
      builderAttribution: null,
    },
  ],
  stateTransitions: [],
  createdAt: 1_756_900_000,
  completedAt: 1_756_900_100,
};

describe("receipt schema — V1 compatibility with the cross-domain fields", () => {
  it("a V1 receipt with no homeDomain / instrumentId still parses", () => {
    const r = usanceReceiptSchema.safeParse(v1Receipt);
    expect(r.success, r.success ? "" : JSON.stringify(r.error.issues)).toBe(true);
  });

  it("the parsed V1 record has no domain fields set", () => {
    const r = usanceReceiptSchema.parse(v1Receipt);
    expect(r.homeDomain ?? null).toBeNull();
    expect(r.instrumentId ?? null).toBeNull();
  });

  it("receiptId is unchanged and does not depend on the new fields", () => {
    expect(receiptIdFor("LIQUIDATED", 1952, v1Receipt.transactions[0]!.txHash)).toBe(
      "liquidated-1952-7bfc13796e0d316b",
    );
    const withDomain = usanceReceiptSchema.parse({
      ...v1Receipt,
      homeDomain: "eip155:1952",
      instrumentId: "0x615af7b30196c52d27492e7ea1b63ed5bb29cd8af79c84f32cd8ee32a07f77a9",
    });
    expect(withDomain.receiptId).toBe(v1Receipt.receiptId);
  });

  it("rejects a bad caip2 in homeDomain", () => {
    expect(usanceReceiptSchema.safeParse({ ...v1Receipt, homeDomain: "X Layer" }).success).toBe(false);
  });

  it("still refuses a CONFIRMED receipt with no successful transaction", () => {
    // The additive fields must not weaken the existing superRefine.
    expect(
      usanceReceiptSchema.safeParse({ ...v1Receipt, transactions: [], homeDomain: "eip155:1952" })
        .success,
    ).toBe(false);
  });
});

import { z } from "zod";
import { hex32Schema, unixSecondsSchema, type Hex32 } from "@usance/schemas";

/**
 * The canonical receipt.
 *
 * One model, used by `/proof/[receiptId]`, `/app/activity` and `/app/activity/[receiptId]`. Three
 * independent shapes would drift, and the moment the public proof page and the private activity
 * feed disagree about the same transaction, both become worthless.
 *
 * A receipt AGGREGATES evidence. It does not replace it. Every financial assertion in here points
 * at a transaction hash a reader can check independently, and a receipt that cannot point at one
 * says so rather than implying the event happened.
 */

export const receiptKindSchema = z.enum([
  "EVIDENCE_COMMITTED",
  "PASSPORT_COMMITTED",
  "RISK_EPOCH_ACTIVATED",
  "COLLATERAL_DEPOSITED",
  "BORROWED",
  "BORROW_REJECTED",
  "REPAID",
  "COLLATERAL_WITHDRAWN",
  "ACCOUNT_RESTRICTED",
  "LIQUIDATED",
]);
export type ReceiptKind = z.infer<typeof receiptKindSchema>;

export const receiptStatusSchema = z.enum([
  "PENDING",
  "SUBMITTED",
  "CONFIRMED",
  "CONFIRMATION_UNKNOWN",
  "FAILED",
  /** The protocol refused the action. A first-class outcome, not an error. */
  "REJECTED_BY_POLICY",
]);
export type ReceiptStatus = z.infer<typeof receiptStatusSchema>;

export const builderAttributionSchema = z.object({
  schema: z.number().int(),
  code: z.string(),
  /** True only when decoded back out of the submitted calldata, never assumed from the helper. */
  verified: z.boolean(),
});

export const receiptTransactionSchema = z.object({
  chainId: z.number().int(),
  contract: z.string(),
  txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  blockNumber: z.number().int().nullable(),
  action: z.string(),
  status: z.enum(["submitted", "success", "reverted", "unknown"]),
  /** Decoded protocol error for a revert. A rejection is evidence and is recorded as such. */
  revertReason: z.string().nullable(),
  builderAttribution: builderAttributionSchema.nullable(),
});
export type ReceiptTransaction = z.infer<typeof receiptTransactionSchema>;

export const stateTransitionSchema = z.object({
  at: unixSecondsSchema,
  from: z.string(),
  to: z.string(),
  note: z.string().nullable(),
});

export const usanceReceiptSchema = z
  .object({
    receiptId: z.string().min(1),
    kind: receiptKindSchema,
    status: receiptStatusSchema,
    chainId: z.number().int(),

    accountId: z.string().nullable(),

    /**
     * Two asset identities, never merged.
     *
     * `evidenceAssetId` is Usance's normalised reading of a real product's filing.
     * `financialAssetId` is a token actually held in a vault. On testnet the second is a labelled
     * stand-in with no relationship to any issuer. Collapsing them into one field is how a proof
     * page would end up implying a test token IS the real product.
     */
    evidenceAssetId: hex32Schema.nullable(),
    financialAssetId: hex32Schema.nullable(),

    workflowId: z.string().nullable(),
    intentId: hex32Schema.nullable(),

    passportVersion: z.number().int().nullable(),
    evidenceRoot: hex32Schema.nullable(),
    claimsRoot: hex32Schema.nullable(),
    singleSource: z.boolean().nullable(),

    riskPolicyVersion: z.number().int().nullable(),
    riskEpoch: z.number().int().nullable(),

    transactions: z.array(receiptTransactionSchema),
    stateTransitions: z.array(stateTransitionSchema),

    createdAt: unixSecondsSchema,
    completedAt: unixSecondsSchema.nullable(),
  })
  .strict()
  .superRefine((r, ctx) => {
    // A CONFIRMED receipt with no transaction would be a backend assertion dressed as onchain
    // truth. REJECTED_BY_POLICY is exempt: a refusal that never reached the chain is still real.
    if (r.status === "CONFIRMED" && r.transactions.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["transactions"],
        message: "a confirmed receipt must cite at least one transaction",
      });
    }
    if (r.status === "CONFIRMED" && !r.transactions.some((t) => t.status === "success")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["status"],
        message: "confirmed requires a successful transaction, not merely a submitted one",
      });
    }
  });

export type UsanceReceipt = z.infer<typeof usanceReceiptSchema>;

/**
 * Deterministic receipt id.
 *
 * Derived from what the receipt is about, so re-deriving it after a restart finds the same receipt
 * instead of minting a second one for the same event.
 */
export function receiptIdFor(kind: ReceiptKind, chainId: number, primaryTxOrKey: string): string {
  const slug = kind.toLowerCase().replace(/_/g, "-");
  return `${slug}-${chainId}-${primaryTxOrKey.replace(/^0x/, "").slice(0, 16)}`;
}

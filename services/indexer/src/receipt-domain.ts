import type { Hex32 } from "@usance/schemas";
import { InstrumentBindings } from "./instrument";

/** The receipt fields this derivation needs. `UsanceReceipt` (in `@usance/evidence`) is a superset. */
export interface ReceiptDomainInput {
  readonly chainId: number;
  readonly financialAssetId: string | null;
}

/**
 * Derive a receipt's cross-domain context at read time — `spec/facility-model.md §11`.
 *
 * `homeDomain` and `instrumentId` are resolved from the receipt's `chainId` and `financialAssetId`
 * through the instrument bindings. They are NOT written back into the stored record: a V1 receipt
 * stays V1 on disk and re-derives its `receiptId` byte-for-byte. This returns a view, computed from
 * evidence that already exists, never authoritative.
 */

const CAIP2_BY_CHAIN_ID: Record<number, string> = {
  1952: "eip155:1952",
  196: "eip155:196",
  8453: "eip155:8453",
  84532: "eip155:84532",
};

export interface ReceiptDomainView {
  readonly homeDomain: string | null;
  readonly instrumentId: Hex32 | null;
  /** How each field was obtained, so a reader knows it is derived and not stored. */
  readonly source: "derived-from-chainId-and-financialAssetId";
}

export function receiptDomainView(
  receipt: ReceiptDomainInput,
  bindings: InstrumentBindings,
): ReceiptDomainView {
  const homeDomain = CAIP2_BY_CHAIN_ID[receipt.chainId] ?? null;
  const resolved = receipt.financialAssetId
    ? bindings.resolve(receipt.financialAssetId as Hex32)
    : null;
  return {
    // Prefer the instrument's own home domain when the asset is bound; fall back to the tx chain.
    homeDomain: resolved?.caip2 ?? homeDomain,
    instrumentId: resolved?.instrumentId ?? null,
    source: "derived-from-chainId-and-financialAssetId",
  };
}

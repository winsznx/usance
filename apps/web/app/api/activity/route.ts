import { NextResponse } from "next/server";
import { loadReceipts } from "@/lib/receipts";

/**
 * Receipts for an account.
 *
 * Filtered by `accountId` where a receipt has one. Receipts describing protocol-level events — a
 * Passport commit, an epoch advance — carry no account and are included, because they change what
 * every holder's capacity means and leaving them out would make a capacity change look unexplained.
 */
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  const account = new URL(request.url).searchParams.get("account");
  if (!account || !/^0x[0-9a-fA-F]{40}$/.test(account)) {
    return NextResponse.json({ rows: [], reason: "account must be a 20-byte address" }, { status: 400 });
  }

  const want = account.toLowerCase();
  const rows = loadReceipts()
    .filter((r) => r.accountId === null || r.accountId.toLowerCase() === want)
    .flatMap((r) =>
      r.transactions.map((t) => ({
        receiptId: r.receiptId,
        kind: r.kind,
        action: t.action,
        txHash: t.txHash,
        blockNumber: t.blockNumber,
        status: t.status,
        at: r.completedAt ?? r.createdAt ?? null,
      })),
    )
    .sort((a, b) => (b.blockNumber ?? 0) - (a.blockNumber ?? 0))
    .slice(0, 12);

  return NextResponse.json({ rows });
}

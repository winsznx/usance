import Link from "next/link";
import { chainById } from "@usance/xlayer";
import {Notice} from "@/components/primitives";
import { AppShell } from "@/components/app-shell";
import { loadReceipts } from "@/lib/receipts";

/**
 * `/app/activity` — everything Usance has on record.
 *
 * A server component reading the same receipt files the public proof explorer reads. It is
 * deliberately not a wallet history: Usance runs no indexer, so it can only show actions it
 * submitted and recorded itself. Presenting that as a complete account history would be a lie of
 * omission the first time somebody interacted with the contracts directly, so the page says what it
 * is at the top rather than in a footnote.
 *
 * Every row links to its public receipt, which needs no wallet and can be sent to anyone.
 */

export const metadata = { title: "Activity · Usance" };

const KIND_LABEL: Record<string, string> = {
  PASSPORT_COMMITTED: "Passport committed",
  RISK_EPOCH_ACTIVATED: "Risk epoch advanced",
  BORROW_REJECTED: "Borrow rejected by the protocol",
  EVIDENCE_COMMITTED: "Evidence committed",
};

export default function ActivityPage() {
  const receipts = [...loadReceipts()].sort((a, b) => {
    const ab = Math.max(0, ...a.transactions.map((t) => t.blockNumber ?? 0));
    const bb = Math.max(0, ...b.transactions.map((t) => t.blockNumber ?? 0));
    return bb - ab;
  });

  return (
    <AppShell>

      <div style={{ maxWidth: 900, margin: "0 auto" }}>
        <h1 className="heading" style={{ margin: "0 0 8px" }}>
          Activity
        </h1>
        <p className="muted" style={{ marginTop: 0, marginBottom: 28 }}>
          Every action Usance has recorded, each with a receipt anyone can check.
        </p>

        <div style={{ marginBottom: 24 }}>
          <Notice title="This is Usance's own record, not a wallet history">
            Usance does not run an indexer yet, so this lists the transactions it submitted and
            wrote receipts for. Anything done directly against the contracts is real, is on chain,
            and will not appear here. Every row links to a public receipt with the hashes needed to
            verify it independently.
          </Notice>
        </div>

        {receipts.length === 0 ? (
          <div className="card">
            <p className="muted" style={{ margin: 0 }}>
              Nothing recorded yet.
            </p>
          </div>
        ) : (
          <div className="stack" style={{ gap: 12 }}>
            {receipts.map((r) => {
              const chain = chainById(r.chainId);
              const reverted = r.transactions.filter((t) => t.status === "reverted");
              const block = Math.max(0, ...r.transactions.map((t) => t.blockNumber ?? 0));
              return (
                <Link
                  key={r.receiptId}
                  href={`/app/activity/${r.receiptId}`}
                  className="card"
                  style={{ display: "block" }}
                >
                  <div className="row-between" style={{ alignItems: "flex-start", gap: 16 }}>
                    <div>
                      <div style={{ fontWeight: 500 }}>
                        {KIND_LABEL[r.kind] ?? r.kind.replace(/_/g, " ")}
                      </div>
                      <div className="caption" style={{ marginTop: 6 }}>
                        {r.transactions.length} transaction{r.transactions.length === 1 ? "" : "s"}
                        {block > 0 ? ` · block ${block.toLocaleString()}` : ""}
                        {chain ? ` · ${chain.name}` : ""}
                      </div>
                      {/*
                        A reverted transaction is shown, never hidden. In this protocol a refusal
                        that reached the chain is the strongest evidence there is: it is the
                        difference between a disabled button and a contract saying no.
                      */}
                      {reverted.length > 0 ? (
                        <div className="caption" style={{ marginTop: 6, color: "var(--graphite)" }}>
                          Includes {reverted.length} transaction
                          {reverted.length === 1 ? "" : "s"} the protocol refused on chain
                          {reverted[0]?.revertReason ? ` — ${reverted[0].revertReason}` : ""}
                        </div>
                      ) : null}
                    </div>
                    <span className="tag">{r.status}</span>
                  </div>
                </Link>
              );
            })}
          </div>
        )}

        <p className="caption" style={{ marginTop: 28 }}>
          Looking for a specific asset?{" "}
          <Link href="/assets" target="_blank" rel="noreferrer" style={{ textDecoration: "underline" }}>
            Browse admitted assets
          </Link>
          .
        </p>
      </div>
    </AppShell>
  );
}

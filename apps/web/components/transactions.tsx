"use client";

import Link from "next/link";
import { KitIcon, Illustration, type KitIconName } from "@/components/kit-icon";
import { Copyable } from "@/components/copyable";

/**
 * The account's transaction history.
 *
 * Sits on the overview rather than linking away, because "what has happened to my money" is one of
 * the four questions the page exists to answer and sending somebody to another route to find out
 * is an answer deferred.
 *
 * Rows are real receipts. There is no synthetic history: an account that has done nothing shows an
 * empty state saying so, which is a true statement, where invented rows would be a false one.
 *
 * The table becomes a stack of cards below 720px rather than scrolling sideways. A financial record
 * a user has to drag horizontally to read is a record they will misread.
 */

export interface TxRow {
  receiptId: string;
  kind: string;
  action: string;
  txHash: string;
  blockNumber: number | null;
  status: "success" | "reverted" | "submitted" | "unknown";
  at: number | null;
}

const ICON: Record<string, KitIconName> = {
  COLLATERAL_DEPOSITED: "collateral",
  COLLATERAL_WITHDRAWN: "withdraw",
  BORROWED: "borrow",
  BORROW_REJECTED: "borrow",
  REPAID: "repay",
  LIQUIDATED: "liquidation",
  PASSPORT_COMMITTED: "passport",
  EVIDENCE_COMMITTED: "evidence",
  RISK_EPOCH_ACTIVATED: "risk-epoch",
  ACCOUNT_RESTRICTED: "alerts",
};

/** Plain language. The enum is the machine's name for the event, not the user's. */
const TITLE: Record<string, string> = {
  COLLATERAL_DEPOSITED: "Collateral added",
  COLLATERAL_WITHDRAWN: "Collateral withdrawn",
  BORROWED: "Borrowed",
  BORROW_REJECTED: "Borrowing refused",
  REPAID: "Repaid",
  LIQUIDATED: "Position partially liquidated",
  PASSPORT_COMMITTED: "Asset Passport committed",
  EVIDENCE_COMMITTED: "Evidence committed",
  RISK_EPOCH_ACTIVATED: "Risk policy advanced",
  ACCOUNT_RESTRICTED: "Account restricted",
};

function when(at: number | null): string {
  if (at === null) return "—";
  const secs = Math.floor(Date.now() / 1000) - at;
  if (secs < 60) return "just now";
  if (secs < 3600) return `${Math.floor(secs / 60)} min ago`;
  if (secs < 86_400) return `${Math.floor(secs / 3600)} h ago`;
  return new Date(at * 1000).toISOString().slice(0, 10);
}

export function TransactionHistory({ rows, explorer }: { rows: TxRow[]; explorer?: string }) {
  return (
    <section className="card" aria-labelledby="tx-heading">
      <div className="row-between" style={{ alignItems: "baseline", marginBottom: 14 }}>
        <h2 id="tx-heading" className="heading" style={{ fontSize: 17, margin: 0 }}>
          Transaction history
        </h2>
        {rows.length > 0 ? (
          <Link href="/app/activity" className="caption" style={{ textDecoration: "underline" }}>
            All activity
          </Link>
        ) : null}
      </div>

      {rows.length === 0 ? (
        <div className="tx-empty">
          <Illustration name="empty-no-activity" width={200} height={130} />
          <p className="caption" style={{ margin: "14px 0 0", maxWidth: 44 + "ch" }}>
            Nothing has happened on this account yet. Rows appear here as you add collateral, borrow
            and repay, and each one links to a receipt anybody can verify without a wallet.
          </p>
        </div>
      ) : (
        <>
          {/* Semantic table on wide screens. */}
          <table className="tx-table">
            <thead>
              <tr>
                <th scope="col">Action</th>
                <th scope="col">Status</th>
                <th scope="col">Transaction</th>
                <th scope="col">Block</th>
                <th scope="col">When</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.receiptId}-${r.txHash}`}>
                  <th scope="row">
                    <Link href={`/app/activity/${r.receiptId}`} className="tx-action">
                      <KitIcon name={ICON[r.kind] ?? "activity"} size={18} />
                      {TITLE[r.kind] ?? r.action}
                    </Link>
                  </th>
                  <td><StatusPill status={r.status} /></td>
                  <td>
                    <Copyable value={r.txHash} label="transaction hash" />
                  </td>
                  <td className="tnum">{r.blockNumber ?? "not yet in a block"}</td>
                  <td className="caption">{when(r.at)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Cards below 720px. A financial record somebody has to drag sideways to read is a
              record they will misread. */}
          <ul className="tx-cards">
            {rows.map((r) => (
              <li key={`${r.receiptId}-${r.txHash}-card`}>
                <Link href={`/app/activity/${r.receiptId}`} className="tx-card">
                  <div className="row-between">
                    <span className="tx-action">
                      <KitIcon name={ICON[r.kind] ?? "activity"} size={18} />
                      {TITLE[r.kind] ?? r.action}
                    </span>
                    <StatusPill status={r.status} />
                  </div>
                  <div className="row-between" style={{ marginTop: 8 }}>
                    <span className="caption mono">{r.txHash.slice(0, 10)}…{r.txHash.slice(-6)}</span>
                    <span className="caption" style={{ color: "var(--graphite)" }}>{when(r.at)}</span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

/**
 * Status by word, with the shape reinforcing it.
 *
 * A refusal is a first-class outcome here, not a failure to hide. The protocol blocking something
 * is the product working, and a history that quietly omitted refusals would be a history that
 * flatters itself.
 */
function StatusPill({ status }: { status: TxRow["status"] }) {
  const copy =
    status === "success" ? "Completed"
    : status === "reverted" ? "Refused"
    : status === "submitted" ? "Submitted"
    : "Unconfirmed";
  return <span className={`tx-pill tx-pill-${status}`}>{copy}</span>;
}

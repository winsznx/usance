import Link from "next/link";
import { notFound } from "next/navigation";
import { Notice } from "@/components/primitives";
import { AppShell } from "@/components/app-shell";
import { loadReceipt, loadReceipts } from "@/lib/receipts";
import { chainById } from "@usance/xlayer";

/**
 * `/app/activity/[receiptId]` — the same receipt, for the person it happened to.
 *
 * Deliberately the same read model as `/proof/[receiptId]`, not a second one. A receipt rendered
 * from two schemas is two schemas that eventually disagree about what happened, and the one a user
 * sees would be the one nobody verifies.
 *
 * What differs is audience and therefore framing. The public page answers "did this happen and can
 * I check it". This one answers "what does this mean for my account, and is there anything left for
 * me to do". Same facts, different question.
 */

export async function generateStaticParams() {
  return loadReceipts().map((r) => ({ receiptId: r.receiptId }));
}

export default async function ActivityDetailPage({ params }: { params: Promise<{ receiptId: string }> }) {
  const { receiptId } = await params;
  const r = loadReceipt(receiptId);
  if (!r) notFound();

  const chain = chainById(r.chainId);
  const explorer = chain?.explorerUrl ?? "";
  const confirmed = r.transactions.filter((t) => t.status === "success");
  const reverted = r.transactions.filter((t) => t.status === "reverted");

  return (
    <AppShell>
      <div style={{ maxWidth: 820, margin: "0 auto" }}>
        <Link href="/app/activity" className="caption" style={{ textDecoration: "underline" }}>
          ← All activity
        </Link>

        <div style={{ marginTop: 24 }}>
          <div className="micro">{r.kind.replace(/_/g, " ").toLowerCase()}</div>
          <h1 className="heading-lg" style={{ margin: "12px 0 0" }}>What happened on your account</h1>
        </div>

        <div className="stack" style={{ gap: 18, marginTop: 24 }}>
          <div className="card">
            <div className="micro" style={{ marginBottom: 12 }}>Outcome</div>
            <Row label="Status" value={r.status} />
            {r.riskEpoch !== null ? <Row label="Risk epoch" value={String(r.riskEpoch)} /> : null}
            {r.passportVersion !== null ? <Row label="Passport version" value={String(r.passportVersion)} /> : null}
            {r.accountId ? <Row label="Account" value={r.accountId} mono /> : null}

            {r.status === "CONFIRMATION_UNKNOWN" ? (
              <div style={{ marginTop: 14 }}>
                {/*
                  The state most likely to prompt a harmful reaction. Somebody seeing "unknown"
                  re-submits, and the second transaction is the one that costs them.
                */}
                <Notice tone="warn" title="This is still being reconciled">
                  Usance submitted this and has not confirmed the outcome. That does not mean it
                  failed. Do not retry it. A duplicate would be a second real action. Reconciliation
                  asks the chain and resolves this without your involvement.
                </Notice>
              </div>
            ) : null}
          </div>

          {r.stateTransitions.length > 0 ? (
            <div className="card">
              <div className="micro" style={{ marginBottom: 12 }}>How your account moved</div>
              {r.stateTransitions.map((t, i) => (
                <div key={i} className="row-between" style={{ padding: "10px 0", borderTop: "1px solid var(--hairline)" }}>
                  <span className="caption">{t.from} → {t.to}</span>
                  <span className="caption" style={{ color: "var(--graphite)" }}>{t.note}</span>
                </div>
              ))}
            </div>
          ) : null}

          <div className="card">
            <div className="micro" style={{ marginBottom: 12 }}>
              {confirmed.length} transaction{confirmed.length === 1 ? "" : "s"} on chain
            </div>
            {confirmed.map((t) => (
              <TxRow key={t.txHash} tx={t} explorer={explorer} />
            ))}

            {reverted.length > 0 ? (
              <div style={{ marginTop: 16 }}>
                {/*
                  Refusals are shown, not hidden. A protocol that blocked something and then said
                  nothing about it looks broken; one that shows the refusal looks like it works.
                */}
                <div className="micro" style={{ marginBottom: 8 }}>Refused by the protocol</div>
                {reverted.map((t) => (
                  <TxRow key={t.txHash} tx={t} explorer={explorer} />
                ))}
                <p className="caption" style={{ margin: "10px 0 0" }}>
                  These reached a block and were rejected. That is the protocol working, and the
                  refusal is as verifiable as anything it allowed.
                </p>
              </div>
            ) : null}
          </div>

          <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
            <Link className="btn btn-ghost" href={`/proof/${r.receiptId}`} target="_blank" rel="noreferrer">
              Public proof for this receipt
            </Link>
            <Link className="btn btn-ghost" href="/app/positions">Your position now</Link>
          </div>

          <p className="caption" style={{ margin: 0 }}>
            The public page shows the same facts without your account context. Anyone can verify it
            without a wallet.
          </p>
        </div>
      </div>
    </AppShell>
  );
}

function TxRow({
  tx, explorer,
}: {
  // blockNumber is nullable because a submitted transaction genuinely has no block yet. Widening
  // this to `number` would mean rendering a zero, and a receipt claiming block 0 is worse than one
  // admitting it does not know.
  tx: { txHash: string; action: string; blockNumber: number | null; status: string };
  explorer: string;
}) {
  return (
    <div className="row-between" style={{ padding: "10px 0", borderTop: "1px solid var(--hairline)", gap: 12 }}>
      <span className="caption">{tx.action}</span>
      <span className="caption mono" style={{ textAlign: "right" }}>
        {explorer ? (
          <a href={`${explorer}/tx/${tx.txHash}`} target="_blank" rel="noreferrer" style={{ textDecoration: "underline" }}>
            {tx.txHash.slice(0, 10)}…{tx.txHash.slice(-6)}
          </a>
        ) : (
          `${tx.txHash.slice(0, 10)}…${tx.txHash.slice(-6)}`
        )}
        <span style={{ color: "var(--graphite)" }}>
          {tx.blockNumber === null ? " · not yet in a block" : ` · block ${tx.blockNumber}`}
        </span>
      </span>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="row-between" style={{ padding: "10px 0", borderTop: "1px solid var(--hairline)", gap: 16 }}>
      <span className="caption">{label}</span>
      <span className={`caption${mono ? " mono" : ""}`} style={{ textAlign: "right", wordBreak: "break-all" }}>{value}</span>
    </div>
  );
}

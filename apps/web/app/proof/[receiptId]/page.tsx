import Link from "next/link";
import { notFound } from "next/navigation";
import { Footer, Nav, Notice } from "@/components/primitives";
import { loadReceipt, loadReceipts, evidenceFor } from "@/lib/receipts";
import { chainById } from "@usance/xlayer";

/**
 * `/proof/[receiptId]` — the public receipt.
 *
 * No wallet, no login, no README. A reader arrives here from a link and leaves knowing what
 * happened, on what authority, and how to check it themselves.
 *
 * Every financial assertion cites a transaction hash. A receipt that cannot cite one says so
 * rather than implying the event occurred — which is why `status: CONFIRMED` is schema-refused
 * unless a successful transaction is attached.
 */

export async function generateStaticParams() {
  return loadReceipts().map((r) => ({ receiptId: r.receiptId }));
}

export async function generateMetadata({ params }: { params: Promise<{ receiptId: string }> }) {
  const { receiptId } = await params;
  const r = loadReceipt(receiptId);
  if (!r) return { title: "Receipt not found — Usance" };
  return { title: `${r.kind.replace(/_/g, " ").toLowerCase()} — Usance proof` };
}

const KIND_COPY: Record<string, { verdict: string; blurb: string }> = {
  PASSPORT_COMMITTED: {
    verdict: "Passport committed on X Layer",
    blurb:
      "Usance read a real issuer filing, extracted structured claims from it, and committed its normalised understanding to the chain.",
  },
  RISK_EPOCH_ACTIVATED: {
    verdict: "Risk epoch advanced on X Layer",
    blurb:
      "A new Passport changed the inputs deterministic policy depends on, so the epoch that stamps every risk decision moved forward.",
  },
};

export default async function ProofPage({ params }: { params: Promise<{ receiptId: string }> }) {
  const { receiptId } = await params;
  const r = loadReceipt(receiptId);
  if (!r) notFound();

  const chain = chainById(r.chainId);
  const explorer = chain?.explorerUrl ?? "";
  const copy = KIND_COPY[r.kind] ?? { verdict: r.kind.replace(/_/g, " "), blurb: "" };
  const ev = evidenceFor(receiptId);

  return (
    <>
      <Nav />
      <main>
        <section style={{ background: "var(--paper)", borderBottom: "1px solid var(--hairline)", padding: "48px 0" }}>
          <div className="shell" style={{ maxWidth: 860 }}>
            <div className="micro">Public proof · no wallet required</div>
            <h1 className="heading-lg" style={{ margin: "18px 0 14px" }}>{copy.verdict}</h1>
            <p className="body-lg muted" style={{ margin: 0 }}>{copy.blurb}</p>
            <div className="row" style={{ gap: 10, marginTop: 22, flexWrap: "wrap" }}>
              <span className="risk risk-NORMAL">{r.status.replace(/_/g, " ").toLowerCase()}</span>
              <span className="tag">{chain?.name ?? `chain ${r.chainId}`}</span>
              {r.singleSource ? <span className="tag">single-source Passport</span> : null}
            </div>
          </div>
        </section>

        {ev?.identityWarning ? (
          <div className="shell" style={{ padding: "32px 24px 0", maxWidth: 900 }}>
            <Notice tone="warn" title="What this does and does not assert">{ev.identityWarning}</Notice>
          </div>
        ) : null}

        <section className="section">
          <div className="shell" style={{ maxWidth: 900 }}>
            {/* ------------------------------------------------ chain of custody */}
            <div className="micro">Chain of custody</div>
            <h2 className="heading" style={{ margin: "14px 0 24px" }}>Source to consequence</h2>

            <div className="card card-flush">
              {ev ? (
                <Step n="01" title="Issuer filing" detail={`${ev["issuer"]} — ${ev["product"]}`}
                  value={ev["sourceClass"]?.replace(/_/g, " ") ?? ""} href={ev["sourceUri"]} />
              ) : null}
              <Step n="02" title="Evidence root" detail="Merkle root over the committed evidence" value={short(r.evidenceRoot)} />
              <Step n="03" title="Claims root" detail="Merkle root over the extracted structured claims" value={short(r.claimsRoot)} />
              <Step n="04" title="Corroboration"
                detail={r.singleSource
                  ? "One extraction path produced a reading, so the Passport is capped by policy"
                  : "Two independent paths agreed"}
                value={r.singleSource ? "single source" : "corroborated"} />
              <Step n="05" title="Passport" detail="Committed version" value={`v${r.passportVersion ?? "—"}`} />
              <Step n="06" title="Risk epoch" detail="The epoch stamping every risk decision" value={String(r.riskEpoch ?? "—")} />
              <Step n="07" title="Onchain" detail="Verified by reading the committed header back"
                value={`${r.transactions.length} tx`} last />
            </div>

            {ev?.corroborationNote ? (
              <p className="caption" style={{ marginTop: 16, maxWidth: 700 }}>{ev.corroborationNote}</p>
            ) : null}

            {/* ------------------------------------------------ transactions */}
            <div className="micro" style={{ marginTop: 48 }}>Transactions</div>
            <h2 className="heading" style={{ margin: "14px 0 8px" }}>Every claim above cites one of these</h2>
            <p className="muted" style={{ marginTop: 0, maxWidth: 660 }}>
              Attribution is decoded back out of each submitted transaction&rsquo;s calldata rather than
              assumed because a helper supports it.
            </p>

            <div className="card card-flush scroll-x" style={{ marginTop: 22 }}>
              <table className="table">
                <thead>
                  <tr><th>Action</th><th>Contract</th><th className="num">Block</th><th>Builder</th><th>Transaction</th></tr>
                </thead>
                <tbody>
                  {r.transactions.map((t) => (
                    <tr key={t.txHash}>
                      <td style={{ fontWeight: 500 }}>{t.action}</td>
                      <td className="muted">{t.contract}</td>
                      <td className="num tnum">{t.blockNumber ?? "—"}</td>
                      <td>{t.builderAttribution
                        ? <span className="tag">{t.builderAttribution.code}{t.builderAttribution.verified ? " ✓" : ""}</span>
                        : <span className="caption">none</span>}</td>
                      <td>
                        {explorer
                          ? <a className="mono" href={`${explorer}/tx/${t.txHash}`} target="_blank" rel="noreferrer" style={{ textDecoration: "underline" }}>{short(t.txHash)}</a>
                          : <span className="mono">{short(t.txHash)}</span>}
                        {t.revertReason ? <div className="caption">reverted: {t.revertReason}</div> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{ marginTop: 40 }}>
              <Link href="/assets" className="btn btn-ghost">See the evidence behind this</Link>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}

function short(h: string | null): string {
  return h ? `${h.slice(0, 12)}…${h.slice(-6)}` : "—";
}

function Step({ n, title, detail, value, href, last }: {
  n: string; title: string; detail: string; value: string; href?: string | undefined; last?: boolean | undefined;
}) {
  return (
    <div style={{
      display: "grid", gridTemplateColumns: "44px 1fr auto", gap: 16, padding: "17px 22px",
      borderBottom: last ? "none" : "1px solid var(--hairline)", alignItems: "baseline",
    }}>
      <span className="micro" style={{ margin: 0 }}>{n}</span>
      <div>
        <div style={{ fontWeight: 500 }}>{title}</div>
        <div className="caption" style={{ color: "var(--graphite)" }}>
          {href ? <a href={href} target="_blank" rel="noreferrer" style={{ textDecoration: "underline" }}>{detail}</a> : detail}
        </div>
      </div>
      <span className="mono tnum" style={{ fontSize: 13, whiteSpace: "nowrap" }}>{value}</span>
    </div>
  );
}

import Link from "next/link";
import { notFound } from "next/navigation";
import { Footer, Nav, Notice } from "@/components/primitives";
import { fmtUsd18, sentinelCatalogue, templateById, templateStats } from "@/lib/sentinels";

export function generateStaticParams() {
  return sentinelCatalogue().map((t) => ({ templateId: t.templateId }));
}

export async function generateMetadata({ params }: { params: Promise<{ templateId: string }> }) {
  const { templateId } = await params;
  const t = templateById(templateId);
  return { title: t ? `${t.name} — Sentinel template` : "Template not found — Usance" };
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="row-between" style={{ padding: "12px 0", borderBottom: "1px solid var(--hairline)", gap: 16 }}>
      <span className="caption">{label}</span>
      <span style={{ textAlign: "right" }}>{value}</span>
    </div>
  );
}

/**
 * `/sentinels/[templateId]` — the template detail.
 *
 * Publisher, version, risk class, the exact permissions and trigger classes it requires, the fee
 * model and audit status — all from the committed manifest. Statistics are receipt-derived and are
 * shown as zero (with a plain note) rather than invented, because no live Sentinel indexer exists.
 */
export default async function TemplateDetail({ params }: { params: Promise<{ templateId: string }> }) {
  const { templateId } = await params;
  const t = templateById(templateId);
  if (!t) notFound();
  const stats = templateStats(templateId);

  return (
    <>
      <Nav />
      <main>
        <section style={{ background: "var(--paper)", borderBottom: "1px solid var(--hairline)", padding: "56px 0" }}>
          <div className="shell" style={{ maxWidth: 860 }}>
            <div className="micro">
              <Link href="/sentinels" className="muted">Sentinel Library</Link> · v{t.version}
            </div>
            <h1 className="heading-lg" style={{ margin: "18px 0 14px" }}>{t.name}</h1>
            <p className="body-lg muted" style={{ margin: 0 }}>{t.description}</p>
            <div className="row" style={{ gap: 10, marginTop: 22, flexWrap: "wrap" }}>
              <span className="tag">{t.riskClass.replace(/_/g, " ").toLowerCase()}</span>
              <span className="tag">{t.status.toLowerCase()}</span>
              <span className="tag">{t.auditStatus.replace(/_/g, " ").toLowerCase()}</span>
            </div>
          </div>
        </section>

        <section className="section">
          <div className="shell" style={{ maxWidth: 900 }}>
            <div className="micro">Required permissions</div>
            <h2 className="heading" style={{ margin: "14px 0 8px" }}>What it can and cannot do</h2>
            <p className="muted" style={{ marginTop: 0, maxWidth: 660 }}>
              These are the maximum actions the template can ever compile. Your signed mandate is the
              hard bound; a verb absent here is a verb the strategy cannot take.
            </p>

            <div className="card card-flush" style={{ marginTop: 20 }}>
              <Row label="Actions" value={<span className="row" style={{ gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>{t.actions.map((a) => <span key={a} className="tag">{a}</span>)}</span>} />
              <Row label="Trigger classes" value={<span className="row" style={{ gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>{t.triggerClasses.map((c) => <span key={c} className="tag">{c.replace(/_/g, " ").toLowerCase()}</span>)}</span>} />
              <Row label="Venues" value={t.requiredVenues.length ? t.requiredVenues.join(", ") : <span className="caption">none, settlement-token repay only</span>} />
              <Row label="Fee per successful run" value={<span className="tnum">{t.feePerSuccessfulRunBps} bps{BigInt(t.flatPerRunUsd18) > 0n ? ` + $${fmtUsd18(t.flatPerRunUsd18)}` : ""}</span>} />
            </div>

            <div className="micro" style={{ marginTop: 40 }}>Provenance</div>
            <h2 className="heading" style={{ margin: "14px 0 8px" }}>Pinned and versioned</h2>
            <div className="card card-flush" style={{ marginTop: 20 }}>
              <Row label="Publisher" value={<span className="mono">{t.publisher}</span>} />
              <Row label="Version" value={<span className="tnum">v{t.version}</span>} />
              <Row label="Manifest hash" value={<span className="mono">{t.manifestHash.slice(0, 18)}…</span>} />
              <Row label="Compiler version" value={<span className="mono">{t.compilerVersion}</span>} />
              <Row label="Minimum protocol version" value={<span className="mono">{t.minimumProtocolVersion}</span>} />
            </div>

            <div className="micro" style={{ marginTop: 40 }}>Track record</div>
            <h2 className="heading" style={{ margin: "14px 0 8px" }}>Evidence, not stars</h2>
            <div className="card" style={{ marginTop: 20 }}>
              {stats.executedRuns === 0 ? (
                <p className="caption" style={{ margin: 0 }}>
                  No runs recorded yet. Statistics here are derived from receipts and indexed state,
                  like active instances, reconciled runs, execution-success and execution-unknown
                  rates, realized-vs-quoted slippage, and mandate violations refused. None are shown
                  until they are real.
                </p>
              ) : (
                <div className="stack-sm">
                  <div className="row-between"><span className="caption">Active instances</span><span className="tnum">{stats.activeInstances}</span></div>
                  <div className="row-between"><span className="caption">Reconciled runs</span><span className="tnum">{stats.reconciledRuns}</span></div>
                  <div className="row-between"><span className="caption">Mandate violations refused</span><span className="tnum">{stats.mandateViolationsRefused}</span></div>
                </div>
              )}
            </div>

            <div style={{ marginTop: 32 }} className="row" >
              <Link href="/app/onboarding" className="btn btn-primary">Open Usance to install</Link>
            </div>
            <div style={{ marginTop: 20 }}>
              <Notice title="Installing is a signature, not a click">
                Installing pins this template version and hash to a new instance and asks you to sign
                a bounded EIP-712 mandate. A later template update can never widen an instance you
                already armed. Upgrading is a fresh review over a fresh mandate.
              </Notice>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}

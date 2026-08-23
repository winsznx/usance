import Link from "next/link";
import { notFound } from "next/navigation";
import { Footer, Nav, Notice } from "@/components/primitives";
import { fmtUsd18, sentinelCatalogue, templateById } from "@/lib/sentinels";

export function generateStaticParams() {
  return sentinelCatalogue().map((t) => ({ templateId: t.templateId }));
}

export async function generateMetadata({ params }: { params: Promise<{ templateId: string }> }) {
  const { templateId } = await params;
  const t = templateById(templateId);
  return { title: t ? `${t.name} · publisher view` : "Template not found · Usance" };
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
 * `/developers/sentinels/[templateId]` — the publisher/reviewer view: the exact hashes and bounded
 * policy a version commits, so a reviewer can check what an instance will pin.
 */
export default async function DeveloperTemplateDetail({ params }: { params: Promise<{ templateId: string }> }) {
  const { templateId } = await params;
  const t = templateById(templateId);
  if (!t) notFound();

  return (
    <>
      <Nav />
      <main>
        <section style={{ background: "var(--paper)", borderBottom: "1px solid var(--hairline)", padding: "56px 0" }}>
          <div className="shell" style={{ maxWidth: 860 }}>
            <div className="micro">
              <Link href="/developers/sentinels" className="muted">Publish a Sentinel</Link> · v{t.version}
            </div>
            <h1 className="heading-lg" style={{ margin: "18px 0 14px" }}>{t.name}</h1>
            <p className="body-lg muted" style={{ margin: 0 }}>{t.description}</p>
          </div>
        </section>

        <section className="section">
          <div className="shell" style={{ maxWidth: 900 }}>
            <div className="micro">Committed manifest</div>
            <h2 className="heading" style={{ margin: "14px 0 8px" }}>What an instance pins</h2>
            <div className="card card-flush" style={{ marginTop: 18 }}>
              <Row label="Publisher" value={<span className="mono">{t.publisher}</span>} />
              <Row label="Risk class" value={<span className="tag">{t.riskClass.replace(/_/g, " ").toLowerCase()}</span>} />
              <Row label="Status / audit" value={`${t.status.toLowerCase()} · ${t.auditStatus.replace(/_/g, " ").toLowerCase()}`} />
              <Row label="Manifest hash" value={<span className="mono">{t.manifestHash.slice(0, 22)}…</span>} />
              <Row label="Compiler version" value={<span className="mono">{t.compilerVersion}</span>} />
              <Row label="Minimum protocol" value={<span className="mono">{t.minimumProtocolVersion}</span>} />
            </div>

            <div className="micro" style={{ marginTop: 40 }}>Bounded surface</div>
            <h2 className="heading" style={{ margin: "14px 0 8px" }}>Actions, triggers, fee</h2>
            <div className="card card-flush" style={{ marginTop: 18 }}>
              <Row label="Actions" value={<span className="row" style={{ gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>{t.actions.map((a) => <span key={a} className="tag">{a}</span>)}</span>} />
              <Row label="Trigger classes" value={<span className="row" style={{ gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>{t.triggerClasses.map((c) => <span key={c} className="tag">{c.replace(/_/g, " ").toLowerCase()}</span>)}</span>} />
              <Row label="Fee per successful run" value={<span className="tnum">{t.feePerSuccessfulRunBps} bps{BigInt(t.flatPerRunUsd18) > 0n ? ` + $${fmtUsd18(t.flatPerRunUsd18)}` : ""}</span>} />
            </div>

            <div style={{ marginTop: 30 }}>
              <Notice title="Immutable, and unable to widen an installation">
                This version is fixed at its <span className="mono">(templateId, version)</span>. A
                later version is a new commitment; it cannot alter the permissions of an instance a
                user already armed against this one. Shipping v2 never touches v1&rsquo;s installs.
              </Notice>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}

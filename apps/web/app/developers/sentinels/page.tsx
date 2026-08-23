import Link from "next/link";
import { Footer, Nav, Notice } from "@/components/primitives";
import { sentinelCatalogue } from "@/lib/sentinels";

export const metadata = { title: "Publish a Sentinel — Usance Developers" };

/**
 * `/developers/sentinels` — the publisher's view of the library.
 *
 * A template is a versioned, declarative specification plus schema hashes — never executable code
 * Usance runs with a user's authority. This page states the publishing contract and lists the
 * committed templates with the metadata a reviewer cares about.
 */
export default function DevelopersSentinelsPage() {
  const templates = sentinelCatalogue();

  return (
    <>
      <Nav />
      <main>
        <section style={{ background: "var(--paper)", borderBottom: "1px solid var(--hairline)", padding: "56px 0" }}>
          <div className="shell" style={{ maxWidth: 860 }}>
            <div className="micro">Usance Developers</div>
            <h1 className="heading-lg" style={{ margin: "18px 0 14px" }}>Publish a Sentinel template</h1>
            <p className="body-lg muted" style={{ margin: 0 }}>
              A template is a strategy specification: declarative configuration, a trigger schema, a
              plan schema, and the versioned compiler that turns them into plans. It holds no user
              authority and contains no code Usance executes on a user&rsquo;s behalf.
            </p>
          </div>
        </section>

        <section className="section">
          <div className="shell" style={{ maxWidth: 900 }}>
            <div className="micro">The publishing contract</div>
            <h2 className="heading" style={{ margin: "14px 0 8px" }}>What you commit, and what you cannot</h2>
            <div className="card card-flush" style={{ marginTop: 18 }}>
              <Step n={1} title="Define a manifest">Identity, risk class, the exact actions and trigger classes the strategy needs, a bounded fee policy, and the config/trigger/plan schema hashes.</Step>
              <Step n={2} title="Run the conformance + security suite">The deterministic compiler, the strict schemas, and the invariant guards must pass before a version is publishable.</Step>
              <Step n={3} title="Commit an immutable version">`commitTemplate` writes a sequential, immutable version. You can deprecate or security-disable later. You can never rewrite a version, and an update cannot widen an installed instance (I-62).</Step>
              <Step n={4} title="Never hold authority" last>The registry stores hashes and bounded policy. It cannot authorize anyone&rsquo;s money. A user&rsquo;s signed mandate is the only thing that can, and it bounds every run.</Step>
            </div>

            <div style={{ marginTop: 28 }}>
              <Notice title="Publishing is a signed, immutable commitment">
                A published version is fixed forever at its <span className="mono">(templateId, version)</span>.
                The fee policy is version-pinned and bounded by contract constants. A publisher cannot
                raise a fee at execution time or past the ceiling.
              </Notice>
            </div>

            <div className="micro" style={{ marginTop: 44 }}>Committed templates</div>
            <h2 className="heading" style={{ margin: "14px 0 20px" }}>Library</h2>
            <div className="stack" style={{ gap: 14 }}>
              {templates.map((t) => (
                <Link key={t.templateId} href={`/developers/sentinels/${t.templateId}`} className="card" style={{ display: "block", textDecoration: "none" }}>
                  <div className="row-between" style={{ alignItems: "baseline" }}>
                    <strong style={{ fontWeight: 500 }}>{t.name}</strong>
                    <span className="tag">{t.status.toLowerCase()} · {t.auditStatus.replace(/_/g, " ").toLowerCase()}</span>
                  </div>
                  <div className="caption" style={{ marginTop: 10 }}>
                    v{t.version} · {t.riskClass.replace(/_/g, " ").toLowerCase()} · compiler{" "}
                    <span className="mono">{t.compilerVersion}</span>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}

function Step({ n, title, children, last }: { n: number; title: string; children: React.ReactNode; last?: boolean }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "32px 1fr", gap: 14, padding: "16px 22px", borderBottom: last ? "none" : "1px solid var(--hairline)", alignItems: "start" }}>
      <span className="tnum mono" style={{ opacity: 0.5 }}>{n}</span>
      <div>
        <div style={{ fontWeight: 500 }}>{title}</div>
        <div className="caption" style={{ color: "var(--graphite)", marginTop: 4 }}>{children}</div>
      </div>
    </div>
  );
}

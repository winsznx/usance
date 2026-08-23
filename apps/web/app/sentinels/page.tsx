import Link from "next/link";
import { Footer, Nav, Notice } from "@/components/primitives";
import { sentinelCatalogue } from "@/lib/sentinels";

export const metadata = { title: "Sentinel Marketplace — Usance" };

/**
 * `/sentinels` — the Sentinel Library.
 *
 * A catalogue of versioned strategy templates. Every figure here comes from the committed manifest;
 * there is no ROI, no star rating, no invented performance — a template is a declarative
 * specification a user must explicitly install and sign a mandate for.
 */
export default function SentinelsPage() {
  const templates = sentinelCatalogue();

  return (
    <>
      <Nav />
      <main>
        <section style={{ background: "var(--paper)", borderBottom: "1px solid var(--hairline)", padding: "56px 0" }}>
          <div className="shell" style={{ maxWidth: 860 }}>
            <div className="micro">Usance Sentinels</div>
            <h1 className="heading-lg" style={{ margin: "18px 0 14px" }}>Bounded autonomous agents, from a versioned library</h1>
            <p className="body-lg muted" style={{ margin: 0 }}>
              A Sentinel watches your account and the world, and acts strictly through a mandate you
              sign. Templates hold no authority and never contain executable code. They are
              declarative strategy specifications, pinned by version and hash.
            </p>
          </div>
        </section>

        <section className="section">
          <div className="shell" style={{ maxWidth: 900 }}>
            <div className="micro">Sentinel Library</div>
            <h2 className="heading" style={{ margin: "14px 0 22px" }}>Strategy templates</h2>

            <div className="stack" style={{ gap: 16 }}>
              {templates.map((t) => (
                <Link key={t.templateId} href={`/sentinels/${t.templateId}`} className="card" style={{ display: "block", textDecoration: "none" }}>
                  <div className="row-between" style={{ alignItems: "baseline" }}>
                    <strong style={{ fontWeight: 500 }}>{t.name}</strong>
                    <span className="tag">{t.riskClass.replace(/_/g, " ").toLowerCase()}</span>
                  </div>
                  <p className="caption" style={{ color: "var(--graphite)", margin: "10px 0 0", maxWidth: 620 }}>{t.description}</p>
                  <div className="row" style={{ gap: 8, marginTop: 14, flexWrap: "wrap" }}>
                    {t.actions.map((a) => (
                      <span key={a} className="tag">{a}</span>
                    ))}
                  </div>
                  <div className="caption" style={{ marginTop: 12 }}>
                    v{t.version} · {t.auditStatus.replace(/_/g, " ").toLowerCase()} · publisher{" "}
                    <span className="mono">{t.publisher.slice(0, 10)}…</span>
                  </div>
                </Link>
              ))}
            </div>

            <div style={{ marginTop: 28 }}>
              <Notice title="Templates cannot move your money">
                A template is a strategy specification and a set of schema hashes. It is not code
                Usance runs with your authority. Every financial action a Sentinel takes still passes the
                same check as an owner&rsquo;s own: what the protocol allows, and what your signed
                mandate allows.
              </Notice>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}

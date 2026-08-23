import Link from "next/link";
import { Footer, Nav } from "@/components/primitives";
import { integrations, STATUS_LABEL, type Status } from "@/lib/integration-status";

export const metadata = {
  title: "Status · Usance",
  description: "What is live in Usance, what needs access, and what is not available at all.",
};

const ORDER: Status[] = ["CONFIRMED", "ACCESS_REQUIRED", "DEFERRED", "NOT_AVAILABLE"];

const SECTION_COPY: Record<Status, { heading: string; blurb: string }> = {
  CONFIRMED: {
    heading: "Live",
    blurb: "Verified against the live network or primary documentation. Each row names its evidence.",
  },
  ACCESS_REQUIRED: {
    heading: "Needs access",
    blurb:
      "The integration exists. Usance holds no credential or approval for it, so the affected path is disabled rather than simulated.",
  },
  DEFERRED: {
    heading: "Deferred",
    blurb: "Intentionally outside the current build window.",
  },
  NOT_AVAILABLE: {
    heading: "Not available",
    blurb:
      "Verified to not exist for X Layer. The adapter stays in the tree; the live path stays off.",
  },
};

export default function StatusPage() {
  return (
    <>
      <Nav />

      <main>
        <section
          style={{
            background: "var(--paper)",
            borderBottom: "1px solid var(--hairline)",
            padding: "56px 0",
          }}
        >
          <div className="shell" style={{ maxWidth: 780 }}>
            <div className="micro">Integration status</div>
            <h1 className="heading-lg" style={{ margin: "18px 0 16px" }}>
              What is actually live
            </h1>
            <p className="body-lg muted" style={{ margin: 0 }}>
              Anything Usance cannot do yet is disabled in the product with the reason shown. It is
              never replaced with a simulation presented as the real thing. Every claim on this
              page is reproducible with <span className="mono">make verify-integrations</span>.
            </p>
          </div>
        </section>

        <section className="section">
          <div className="shell stack" style={{ gap: 56 }}>
            {ORDER.map((status) => {
              const rows = integrations.filter((i) => i.status === status);
              if (rows.length === 0) return null;
              return (
                <div key={status}>
                  <div className="row" style={{ gap: 12, marginBottom: 8 }}>
                    <h2 className="heading" style={{ margin: 0 }}>
                      {SECTION_COPY[status].heading}
                    </h2>
                    <span className="tag">{rows.length}</span>
                  </div>
                  <p className="muted" style={{ maxWidth: 640, marginTop: 0, marginBottom: 22 }}>
                    {SECTION_COPY[status].blurb}
                  </p>

                  <div className="card card-flush scroll-x">
                    <table className="table">
                      <thead>
                        <tr>
                          <th style={{ minWidth: 180 }}>Integration</th>
                          <th style={{ minWidth: 160 }}>Role</th>
                          <th style={{ minWidth: 300 }}>What it means today</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((i) => (
                          <tr key={i.name}>
                            <td>
                              <div style={{ fontWeight: 500 }}>{i.name}</div>
                              <span className="tag" style={{ marginTop: 6 }}>
                                {STATUS_LABEL[i.status]}
                              </span>
                            </td>
                            <td className="muted">{i.role}</td>
                            <td>
                              <div style={{ color: "var(--graphite)" }}>{i.consequence}</div>
                              {i.evidence ? (
                                <div className="caption" style={{ marginTop: 8 }}>
                                  Evidence: <span className="mono">{i.evidence}</span>
                                </div>
                              ) : null}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section className="section" style={{ paddingTop: 0 }}>
          <div className="shell">
            <div className="panel" style={{ maxWidth: 720 }}>
              <div className="micro">Deployment</div>
              <p style={{ marginTop: 14, marginBottom: 12 }}>
                No contracts are deployed yet. The deploy script is written and refuses to run
                anywhere that is not X Layer, but the deployer holds no test gas.
              </p>
              <p className="caption" style={{ margin: 0 }}>
                Until a deployment is broadcast, <Link href="/app" style={{ textDecoration: "underline" }}>the
                app</Link> says so plainly rather than rendering an empty portfolio, and{" "}
                <Link href="/simulate" style={{ textDecoration: "underline" }}>the walkthrough</Link>{" "}
                computes the full mechanism from the frozen canonical scenarios.
              </p>
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </>
  );
}

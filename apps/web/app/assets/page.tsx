import Link from "next/link";
import { Footer, Nav } from "@/components/primitives";
import { TokenBadge } from "@/components/token-badge";
import { loadAssets } from "@/lib/passport-data";

export const metadata = {
  title: "Supported assets — Usance",
  description:
    "Every asset Usance has read, the evidence behind it, and whether it can be used as collateral.",
};

const VERDICT_STYLE = {
  ADMISSIBLE: { cls: "risk risk-NORMAL", label: "Admissible" },
  CAPPED: { cls: "risk risk-NO_NEW_RISK", label: "Capped" },
  BLOCKED: { cls: "risk risk-REDUCE_ONLY", label: "Blocked" },
} as const;

/**
 * `/assets` — the catalogue.
 *
 * Ordered by what a reader actually wants to know: can I use this, and on what basis. The status
 * column is the verdict, not a spinner, and every row leads to the evidence rather than to a
 * marketing page.
 */
export default async function AssetsPage() {
  const assets = await loadAssets();

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
          <div className="shell" style={{ maxWidth: 800 }}>
            <div className="micro">Supported assets</div>
            <h1 className="heading-lg" style={{ margin: "18px 0 16px" }}>
              What Usance has read, and what it concluded
            </h1>
            <p className="body-lg muted" style={{ margin: 0 }}>
              Every asset below was assessed from its issuer&rsquo;s own filing. Open one to see the
              document, the exact sentences the claims were read from, and why the recognised
              collateral value is what it is.
            </p>
          </div>
        </section>

        <section className="section">
          <div className="shell">
            <div className="card card-flush scroll-x">
              <table className="table">
                <thead>
                  <tr>
                    <th style={{ minWidth: 240 }}>Asset</th>
                    <th style={{ minWidth: 180 }}>Issuer</th>
                    <th>Evidence</th>
                    <th className="num">Versions</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {assets.map((a) => {
                    const v = VERDICT_STYLE[a.verdict.state];
                    return (
                      <tr key={a.slug}>
                        <td>
                          <div className="row" style={{ gap: 10, alignItems: "center" }}>
                            <TokenBadge symbol={a.symbol} size={30} />
                            <span className="stack" style={{ gap: 2 }}>
                              <Link href={`/assets/${a.slug}`} style={{ fontWeight: 500 }}>
                                {a.symbol}
                              </Link>
                              <span className="caption">{a.name}</span>
                            </span>
                          </div>
                        </td>
                        <td className="muted">{a.issuer}</td>
                        <td>
                          <div style={{ fontSize: 14 }}>{a.current.sourceClassName.replace(/_/g, " ")}</div>
                          <div className="caption">
                            effective {new Date(a.current.effectiveAt * 1000).toISOString().slice(0, 10)}
                          </div>
                        </td>
                        <td className="num tnum">{a.versions.length}</td>
                        <td>
                          <span className={v.cls}>{v.label}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="panel" style={{ marginTop: 28, maxWidth: 760 }}>
              <div className="micro">Why none of these are live collateral yet</div>
              <p className="caption" style={{ marginTop: 12, marginBottom: 0, color: "var(--graphite)" }}>
                Each of these is a real, public issuer filing that Usance fetched, hashed and read.
                None of them has a verified token contract address on X Layer, and no contracts are
                deployed, so nothing here can be deposited today. What the pages demonstrate is the
                part that is hard and the part that is real: turning an issuer&rsquo;s own words into
                a structured, versioned, hash-anchored claim set that deterministic policy can act
                on.
              </p>
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </>
  );
}

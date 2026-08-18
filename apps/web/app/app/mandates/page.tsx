import Link from "next/link";
import { Footer, Nav, Notice } from "@/components/primitives";
import { activeChain, loadDeployment } from "@/lib/deployments";
import { WITHDRAWAL_IS_NOT_DELEGABLE } from "@/lib/mandate";

/**
 * `/app/mandates` — what you have delegated, and to whom.
 *
 * The page leads with what a mandate cannot do. A reader arriving here is deciding whether to hand
 * an automated process authority over their own collateral, and the single most important fact is
 * the boundary, not the feature list.
 */

export const dynamic = "force-dynamic";

export default async function MandatesPage() {
  const chain = activeChain();
  const deployment = await loadDeployment(chain.id);
  const registry = deployment?.contracts?.mandateRegistry as string | undefined;

  return (
    <>
      <Nav />
      <main>
        <section style={{ background: "var(--paper)", borderBottom: "1px solid var(--hairline)", padding: "48px 0" }}>
          <div className="shell" style={{ maxWidth: 860 }}>
            <div className="micro">Delegated authority · {chain.name}</div>
            <h1 className="heading-lg" style={{ margin: "18px 0 14px" }}>Mandates</h1>
            <p className="body-lg muted" style={{ margin: 0, maxWidth: 620 }}>
              A mandate lets an agent act on your account inside limits you sign. It can only ever
              narrow what the protocol already allows, never widen it.
            </p>
          </div>
        </section>

        <section className="section">
          <div className="shell stack" style={{ maxWidth: 860, gap: 18 }}>
            {/* Leading with the boundary, not the features. */}
            <Notice title="What a mandate can never do">{WITHDRAWAL_IS_NOT_DELEGABLE}</Notice>

            {registry === undefined ? (
              <Notice
                tone="stop"
                title="Delegated authority is not deployed on this network"
                action={<Link className="btn btn-ghost" href="/status">Integration status</Link>}
              >
                No MandateRegistry is published for chain {chain.id}, so there is nothing to sign
                against and nothing to list. An empty mandate list here would read as &ldquo;you
                have delegated nothing&rdquo;, which is a different claim.
              </Notice>
            ) : (
              <>
                <div className="card">
                  <div className="micro">Registry</div>
                  <p className="caption mono" style={{ marginTop: 8, marginBottom: 0 }}>{registry}</p>
                  <p className="caption" style={{ marginTop: 12, marginBottom: 0 }}>
                    Usance runs no indexer, so this page cannot list mandates it did not just
                    create. Open a mandate by its id, or create one.
                  </p>
                </div>

                <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
                  <Link className="btn btn-primary btn-lg" href="/app/mandates/new">
                    Create a mandate
                  </Link>
                  <Link className="btn btn-ghost btn-lg" href="/app">Back to your portfolio</Link>
                </div>
              </>
            )}
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}

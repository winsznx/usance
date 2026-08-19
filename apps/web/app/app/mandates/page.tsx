import Link from "next/link";
import {Notice} from "@/components/primitives";
import { AppShell } from "@/components/app-shell";
import { activeChain, loadDeployment } from "@/lib/deployments";
import { WITHDRAWAL_IS_NOT_DELEGABLE, MANDATE_TEMPLATES, MANDATE_ACTIONS } from "@/lib/mandate";
import { OnChain } from "@/components/onchain";

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
    <AppShell>
      <div>
        <h1 className="heading-lg" style={{ margin: "0 0 8px", fontSize: 26 }}>Mandates</h1>
        <p className="muted" style={{ margin: "0 0 28px", maxWidth: "62ch" }}>
              A mandate lets an agent act on your account inside limits you sign. It can only ever
              narrow what the protocol already allows, never widen it.
            </p>

        {registry === undefined ? (
              <Notice
                tone="stop"
                title="Delegated authority is not deployed on this network"
                action={<Link className="btn btn-ghost" href="/status">Integration status</Link>}
              >
                No MandateRegistry is published for chain {chain.id}, so there is nothing to sign
                against. An empty mandate list here would read as &ldquo;you have delegated
                nothing&rdquo;, which is a different claim.
              </Notice>
            ) : (
              <div className="stack" style={{ gap: 18 }}>
                <div className="dash-grid">
                  <div className="stack" style={{ gap: 18 }}>
                    <section className="card">
                      <h2 className="heading" style={{ fontSize: 17, margin: "0 0 4px" }}>
                        Start from a template
                      </h2>
                      <p className="caption" style={{ margin: "0 0 16px", color: "var(--graphite)" }}>
                        Each one grants the narrowest set of actions that achieves its purpose. You
                        can adjust the limits before signing.
                      </p>
                      {MANDATE_TEMPLATES.map((t) => (
                        <Link
                          key={t.id}
                          href={`/app/mandates/new?template=${t.id}`}
                          className="row-between"
                          style={{
                            padding: "14px 0",
                            borderTop: "1px solid var(--hairline)",
                            textDecoration: "none",
                            gap: 16,
                          }}
                        >
                          <span className="stack" style={{ gap: 4 }}>
                            <span style={{ fontWeight: 500 }}>{t.title}</span>
                            <span className="caption" style={{ color: "var(--graphite)" }}>{t.blurb}</span>
                          </span>
                          <span className="caption" aria-hidden="true">›</span>
                        </Link>
                      ))}
                    </section>

                    <section className="card">
                      <h2 className="heading" style={{ fontSize: 17, margin: "0 0 12px" }}>
                        What an agent can never do
                      </h2>
                      <p className="caption" style={{ margin: 0, color: "var(--graphite)", maxWidth: "62ch" }}>
                        {WITHDRAWAL_IS_NOT_DELEGABLE}
                      </p>
                      <Link className="btn btn-ghost" href="/security" style={{ marginTop: 16 }}>
                        How authority is bounded
                      </Link>
                    </section>
                  </div>

                  <div className="stack" style={{ gap: 18 }}>
                    <section className="card">
                      <div className="micro" style={{ marginBottom: 12 }}>Registry</div>
                      <OnChain kind="address" value={registry} label="MandateRegistry" />
                      <p className="caption" style={{ margin: "14px 0 0", color: "var(--graphite)" }}>
                        Usance runs no indexer, so this page cannot list mandates it did not just
                        create. Open one by its id, or create one.
                      </p>
                    </section>

                    <section className="card">
                      <h2 className="heading" style={{ fontSize: 17, margin: "0 0 10px" }}>
                        Which actions are delegable
                      </h2>
                      {MANDATE_ACTIONS.map((a) => (
                        <div
                          key={a.name}
                          className="row-between"
                          style={{ padding: "9px 0", borderTop: "1px solid var(--hairline)", gap: 12 }}
                        >
                          <span className="caption">{a.label}</span>
                          <span className="caption" style={{ color: a.delegable ? "var(--risk-healthy)" : "var(--stone)" }}>
                            {a.delegable ? "Delegable" : "Refused"}
                          </span>
                        </div>
                      ))}
                      {/* The four refusals are not an oversight. Nothing reaches a venue yet, so
                          granting them would authorise an act with nowhere to go. */}
                      <p className="caption" style={{ margin: "14px 0 0", color: "var(--graphite)" }}>
                        Trade, hedge and close are refused because no venue path is wired. Borrowing
                        is refused until every bound is enforced end to end.
                      </p>
                    </section>
                  </div>
                </div>

                <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
                  <Link className="btn btn-primary btn-lg" href="/app/mandates/new">Create a mandate</Link>
                  <Link className="btn btn-ghost btn-lg" href="/app">Back to your portfolio</Link>
                </div>
              </div>
        )}
      </div>
    </AppShell>
  );
}

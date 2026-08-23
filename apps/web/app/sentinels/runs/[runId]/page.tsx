import Link from "next/link";
import { notFound } from "next/navigation";
import { chainById } from "@usance/xlayer";
import { Footer, Nav, Notice } from "@/components/primitives";
import { fmtUsd18, loadSampleRun, loadSampleRuns, short } from "@/lib/sentinels";

const LABEL: Record<string, string> = {
  TRIGGER_OBSERVED: "Observed",
  TRIGGER_VALIDATED: "Trigger validated",
  SNAPSHOT_PINNING: "Pinning snapshot",
  SNAPSHOT_PINNED: "Snapshot pinned",
  PLANNING: "Planning",
  PLAN_READY: "Plan compiled",
  NO_ACTION_REQUIRED: "No action required",
  WAITING_USER_CONFIRMATION: "Awaiting user confirmation",
  AUTHORIZATION_CHECKING: "Checking authority",
  AUTHORIZED: "Authorized",
  RESERVING: "Reserving capacity",
  CAPITAL_RESERVED: "Capital reserved",
  SUBMITTING: "Submitting",
  SUBMITTED: "Submitted",
  PARTIALLY_FILLED: "Partially filled",
  FILLED: "Filled",
  CONFIRMATION_UNKNOWN: "Confirmation unknown",
  EXECUTION_UNKNOWN: "Execution unknown",
  RECONCILING: "Reconciling",
  RECONCILED: "Reconciled",
  COMPLETE: "Complete",
  PLAN_REJECTED: "Plan rejected",
  AUTHORIZATION_REJECTED: "Authorization rejected",
  RESERVATION_REJECTED: "Reservation rejected",
  BLOCKED_BY_POLICY: "Blocked by policy",
  BLOCKED_BY_MANDATE: "Blocked by mandate",
  BLOCKED_BY_BUDGET: "Blocked by budget",
  BLOCKED_BY_RISK_EPOCH: "Blocked by risk epoch",
  BLOCKED_BY_VENUE: "Blocked by venue",
  BLOCKED_BY_LIQUIDITY: "Blocked by liquidity",
  BLOCKED_BY_MARKET_SESSION: "Blocked by market session",
};

export async function generateStaticParams() {
  return (await loadSampleRuns()).map((r) => ({ runId: r.run.runId }));
}

export async function generateMetadata({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const s = await loadSampleRun(runId);
  return { title: s ? `Sentinel run ${runId.slice(0, 10)} · Usance proof` : "Run not found · Usance" };
}

/**
 * `/sentinels/runs/[runId]` — the auditable run timeline, public and no-wallet.
 *
 * This is the visible AI-agency demo: what the Sentinel observed, why it acted, what snapshot it
 * pinned, what deterministic policy allowed, what the mandate authorized, what executed on chain,
 * and what changed — in that order. It renders a real engine-produced run, labelled a testnet
 * fixture, not a fabricated stream.
 */
export default async function RunPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const sample = await loadSampleRun(runId);
  if (!sample) notFound();
  const { run, receipt } = sample;
  const snap = run.snapshot;
  const chain = chainById(snap?.chainId ?? 1952);
  const explorer = chain?.explorerUrl ?? "";
  const repayAmount = run.plan && run.plan.action === "REPAY" ? run.plan.amountUsd18 : null;
  const executed = run.history.some((h) => h.to === "FILLED");
  const statusWord = (receipt?.status ?? run.state).replace(/_/g, " ").toLowerCase();

  return (
    <>
      <Nav />
      <main>
        <section style={{ background: "var(--paper)", borderBottom: "1px solid var(--hairline)", padding: "56px 0" }}>
          <div className="shell" style={{ maxWidth: 860 }}>
            <div className="micro">Public proof · no wallet required · testnet fixture</div>
            <h1 className="heading-lg" style={{ margin: "18px 0 14px" }}>
              {executed ? "A Sentinel repaid debt without a user pressing execute" : "A Sentinel run, refused before it could act"}
            </h1>
            <p className="body-lg muted" style={{ margin: 0 }}>
              {executed
                ? "The runtime observed the account cross its safety threshold, compiled a plan, checked both protocol and mandate authority against live state, and executed a delegated repay."
                : "The runtime compiled a plan, but the authority check refused it before any capital moved — the reservation was released and nothing reached the account."}
            </p>
            <div className="row" style={{ gap: 10, marginTop: 22, flexWrap: "wrap" }}>
              <span className="risk risk-NORMAL">{statusWord}</span>
              <span className="tag">{chain?.name ?? `chain ${snap?.chainId ?? "—"}`}</span>
              <span className="tag">{run.trigger.class.replace(/_/g, " ").toLowerCase()} · {run.trigger.authority.replace(/_/g, " ").toLowerCase()}</span>
            </div>
          </div>
        </section>

        <section className="section">
          <div className="shell" style={{ maxWidth: 900 }}>
            {/* -------------------------------------------------- summary */}
            <div className="micro">What happened</div>
            <h2 className="heading" style={{ margin: "14px 0 22px" }}>Observation to consequence</h2>

            <div className="card card-flush">
              <SummaryRow label="Observed" detail={`${run.trigger.class.replace(/_/g, " ")} at authority ${run.trigger.authority.replace(/_/g, " ")}`} value={`epoch ${snap?.riskEpoch ?? "—"}`} />
              <SummaryRow label="Snapshot" detail="Pinned account state the plan was compiled against" value={snap ? `block ${snap.blockNumber}` : "—"} />
              <SummaryRow label="Plan" detail={run.plan ? `${run.plan.action}${repayAmount ? ` $${fmtUsd18(repayAmount)}` : ""} · ${run.plan.riskDirection.toLowerCase()} risk` : "no plan compiled"} value={run.plan?.action ?? "—"} />
              <SummaryRow label="Protocol + mandate" detail="AllowedAction = ProtocolAllows ∧ MandateAllows, re-read live before submit" value={executed ? "authorized" : "refused"} />
              <SummaryRow label="Executed" detail="Delegated action through the gateway" value={`${run.transactions.length} tx`} last />
            </div>

            {snap ? (
              <div className="card" style={{ marginTop: 22 }}>
                <div className="micro" style={{ margin: "0 0 12px" }}>Account at snapshot</div>
                <div className="row-between" style={{ padding: "6px 0" }}><span className="caption">Debt</span><span className="tnum">${fmtUsd18(snap.debtUsd18)}</span></div>
                <div className="row-between" style={{ padding: "6px 0" }}><span className="caption">Maintenance limit</span><span className="tnum">${fmtUsd18(snap.maintenanceLimitUsd18)}</span></div>
                <div className="row-between" style={{ padding: "6px 0" }}><span className="caption">Safety buffer</span><span className="tnum">{(snap.bufferBps / 100).toFixed(1)}%</span></div>
                <div className="row-between" style={{ padding: "6px 0" }}><span className="caption">Status</span><span className="tag">{snap.accountStatus.replace(/_/g, " ")}</span></div>
              </div>
            ) : null}

            {/* -------------------------------------------------- timeline */}
            <div className="micro" style={{ marginTop: 48 }}>Timeline</div>
            <h2 className="heading" style={{ margin: "14px 0 22px" }}>Every state this run passed through</h2>
            <div className="card card-flush">
              {run.history.map((h, i) => (
                <div
                  key={`${h.to}-${h.at}-${i}`}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr auto",
                    gap: 16,
                    padding: "13px 22px",
                    borderBottom: i === run.history.length - 1 ? "none" : "1px solid var(--hairline)",
                    alignItems: "baseline",
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 500 }}>{LABEL[h.to] ?? h.to}</div>
                    {h.reason ? <div className="caption" style={{ color: "var(--graphite)" }}>{h.reason}</div> : null}
                  </div>
                  <span className="mono tnum" style={{ fontSize: 13 }}>{h.to}</span>
                </div>
              ))}
            </div>

            {/* -------------------------------------------------- transactions */}
            {receipt && receipt.transactions.length ? (
              <>
                <div className="micro" style={{ marginTop: 48 }}>Transactions</div>
                <h2 className="heading" style={{ margin: "14px 0 8px" }}>What the chain confirmed</h2>
                <div className="card card-flush scroll-x" style={{ marginTop: 20 }}>
                  <table className="table">
                    <thead>
                      <tr><th>Action</th><th>Contract</th><th className="num">Block</th><th>Status</th><th>Transaction</th></tr>
                    </thead>
                    <tbody>
                      {receipt.transactions.map((tx) => (
                        <tr key={tx.txHash}>
                          <td style={{ fontWeight: 500 }}>{tx.action}</td>
                          <td className="muted">{tx.contract}</td>
                          <td className="num tnum">{tx.blockNumber ?? "—"}</td>
                          <td><span className="tag">{tx.status}</span></td>
                          <td>
                            {explorer ? (
                              <a className="mono" href={`${explorer}/tx/${tx.txHash}`} target="_blank" rel="noreferrer" style={{ textDecoration: "underline" }}>{short(tx.txHash)}</a>
                            ) : (
                              <span className="mono">{short(tx.txHash)}</span>
                            )}
                            {tx.revertReason ? <div className="caption">reverted: {tx.revertReason}</div> : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <div style={{ marginTop: 32 }}>
                <Notice title="Nothing reached the chain">
                  This run was refused before submission, so there is no transaction to cite — and
                  the receipt says so rather than implying one. A refusal that never mined is still a
                  real, recorded outcome.
                </Notice>
              </div>
            )}

            <div style={{ marginTop: 40 }}>
              <Link href="/sentinels" className="btn btn-ghost">Back to the Sentinel Library</Link>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}

function SummaryRow({ label, detail, value, last }: { label: string; detail: string; value: string; last?: boolean }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "120px 1fr auto", gap: 16, padding: "16px 22px", borderBottom: last ? "none" : "1px solid var(--hairline)", alignItems: "baseline" }}>
      <span className="micro" style={{ margin: 0 }}>{label}</span>
      <div className="caption" style={{ color: "var(--graphite)" }}>{detail}</div>
      <span className="mono tnum" style={{ fontSize: 13, whiteSpace: "nowrap" }}>{value}</span>
    </div>
  );
}

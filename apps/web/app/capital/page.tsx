import Link from "next/link";
import { Footer, Nav, Notice } from "@/components/primitives";
import { BaseFacilityLiveState } from "@/components/base-facility-live-state";
import { BASE_SEPOLIA_PROOF } from "@/lib/base-sepolia-proof";

export const metadata = {
  title: "Capital · Usance",
  description: "Inspect the current Usance capital facility proofs by authoritative market domain.",
};

/**
 * The Base operational reader is separate from X Layer and historical lifecycle evidence.
 */
export default function CapitalPage() {
  const proof = BASE_SEPOLIA_PROOF;
  return (
    <>
      <Nav />
      <main>
        <section style={{ background: "var(--paper)", borderBottom: "1px solid var(--hairline)", padding: "56px 0" }}>
          <div className="shell" style={{ maxWidth: 820 }}>
            <div className="micro">Capital facilities</div>
            <h1 className="heading-lg" style={{ margin: "18px 0 16px" }}>Capital is local to each facility</h1>
            <p className="body-lg muted" style={{ margin: 0 }}>
              Usance can show an organization&rsquo;s positions across domains, but only collateral
              committed to a facility&rsquo;s authoritative domain can support that facility. Holdings
              are never merged into one cross-chain borrowing-power number.
            </p>
          </div>
        </section>

        <section className="section">
          <div className="shell stack" style={{ gap: 24 }}>
            <Notice tone="warn" title="Base Sepolia · test capital">
              LIVE_TESTNET facility reads remain canary provisional: synthetic B20 instruments,
              a test-only oracle, and native test USDC. This is not production capital.
            </Notice>

            <BaseFacilityLiveState />

            <section className="card">
              <div className="row-between" style={{ alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
                <div>
                  <div className="micro">Base facility</div>
                  <h2 className="heading" style={{ margin: "10px 0 6px" }}>{proof.facility.id}</h2>
                  <p className="muted" style={{ margin: 0 }}>Home domain: Base Sepolia. Settlement: {proof.facility.settlement}.</p>
                </div>
                <span className="tag">{proof.proofLevel.replace(/_/g, " ")}</span>
              </div>
              <div className="grid-2" style={{ gap: 16, marginTop: 24 }}>
                <Metric label="Policy" value={proof.facility.policy.replace(/_/g, " ")} />
                <Metric label="Calibration" value={proof.facility.calibration} />
                <Metric label="Accounting" value="B20 externally scaled; factor in price" />
                <Metric label="Facility contract" value={`${proof.facility.contract.slice(0, 10)}…${proof.facility.contract.slice(-8)}`} />
              </div>
              <p className="caption" style={{ margin: "20px 0 0" }}>
                The canonical facility result consumes its pinned risk output. This page does not
                recreate multiplier or corporate-action math in React.
              </p>
            </section>

            <section className="card">
              <div className="micro">Historical lifecycle evidence</div>
              <p className="caption" style={{ margin: "10px 0 0" }}>This record proves completed testnet steps. It is not used for the current debt, collateral, recognised value, or available capacity above.</p>
              <ol className="steps" style={{ marginTop: 18 }}>
                {proof.lifecycle.map((entry) => (
                  <li key={entry.state} data-state="done"><span className="step-dot">✓</span><span><strong>{entry.state}</strong><br /><span className="caption">{entry.detail}</span></span></li>
                ))}
              </ol>
            </section>

            <section className="card">
              <div className="micro">Instrument identity</div>
              <p className="muted" style={{ margin: "10px 0 16px" }}>These are exact synthetic test instruments, not real Coinbase tokenized stocks.</p>
              {proof.instruments.map((instrument) => <div className="row-between" style={{ borderTop: "1px solid var(--hairline)", padding: "12px 0" }} key={instrument.id}><strong>{instrument.symbol}</strong><span className="caption mono">{instrument.id.slice(0, 18)}…</span></div>)}
            </section>

            <section className="panel">
              <strong>What you can do next</strong>
              <p className="caption" style={{ margin: "8px 0 14px" }}>Inspect the generated lifecycle record or use the separate X Layer testnet workspace. Neither action treats one domain&rsquo;s collateral as another facility&rsquo;s collateral.</p>
              <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
                <a className="btn btn-ghost" href={proof.evidence.explorer} target="_blank" rel="noreferrer">Open BaseScan proof</a>
                <Link className="btn btn-primary" href="/app/onboarding">Open X Layer test workspace</Link>
              </div>
            </section>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div><div className="micro">{label}</div><div style={{ marginTop: 7, fontWeight: 500 }}>{value}</div></div>;
}

import { Nav, Footer, Notice } from "@/components/primitives";

/**
 * `/terms` — plain-language terms for the testnet deployment.
 *
 * Written to be true rather than to look like boilerplate. Usance is non-custodial and currently
 * on testnet, so the terms say exactly that instead of implying a live financial service.
 */

export const metadata = {
  title: "Terms of Service — Usance",
  description: "Plain-language terms for the Usance testnet deployment: non-custodial, test assets with no value, no financial advice.",
};

export default function TermsPage() {
  return (
    <>
      <Nav />
      <main>
        <section style={{ background: "var(--paper)", borderBottom: "1px solid var(--hairline)", padding: "56px 0" }}>
          <div className="shell" style={{ maxWidth: 820 }}>
            <div className="micro">Legal</div>
            <h1 className="heading-lg" style={{ margin: "18px 0 14px" }}>Terms of Service</h1>
            <p className="body-lg muted" style={{ margin: 0 }}>
              Plain-language terms for the Usance testnet deployment. Last updated 20 August 2026.
            </p>
          </div>
        </section>

        <section className="section">
          <div className="shell stack" style={{ maxWidth: 820, gap: 26 }}>
            <Notice tone="warn" title="This is a testnet deployment">
              Usance currently runs on X Layer testnet. The tokens it works with are labelled test
              stand-ins with no monetary value, and nothing you do here is a real financial
              transaction. Testnet state can be reset without notice.
            </Notice>

            <Clause n="1" title="What Usance is">
              Usance is a clearing and risk layer deployed as smart contracts on X Layer, with a web
              interface for reading and interacting with them. It is <strong>non-custodial</strong>:
              it never holds your keys or your assets. Every action is a transaction you sign from
              your own wallet, and you can read the contracts and verify every result independently.
            </Clause>

            <Clause n="2" title="No financial advice">
              The figures Usance shows — recognised value, borrowing capacity, stressed exit, risk
              status — are the deterministic output of software reading public data. They are not
              advice, a recommendation, or a promise of any outcome. You are responsible for your own
              decisions.
            </Clause>

            <Clause n="3" title="Risk">
              Interacting with smart contracts carries risk, including bugs, and — on any future
              mainnet deployment — the risk of liquidation when collateral value falls. Recognised
              collateral value is deliberately lower than market value and can fall when the evidence
              behind an asset changes. Do not commit value you cannot afford to lose.
            </Clause>

            <Clause n="4" title="Eligibility and compliance">
              You are responsible for complying with the laws of your jurisdiction. Usance is not
              offered to any person where doing so would be unlawful, and using it does not create
              any relationship beyond your direct, self-custodied interaction with public contracts.
            </Clause>

            <Clause n="5" title="Availability">
              The interface and the testnet contracts are provided on an &ldquo;as is&rdquo; and
              &ldquo;as available&rdquo; basis, without warranties of any kind. Testnet deployments
              may change, pause, or reset at any time.
            </Clause>

            <Clause n="6" title="Limitation of liability">
              To the fullest extent permitted by law, Usance and its contributors are not liable for
              any loss arising from your use of the interface or the contracts, including losses from
              your own transactions, third-party infrastructure, or testnet resets.
            </Clause>

            <Clause n="7" title="Changes and contact">
              These terms may change as the product moves toward a mainnet deployment. Material
              changes will be reflected here with an updated date. Questions can be directed to{" "}
              <a href="https://x.com/usance_fi" target="_blank" rel="noreferrer" style={{ textDecoration: "underline" }}>@usance_fi</a>.
            </Clause>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}

function Clause({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="heading" style={{ fontSize: 19, margin: "0 0 10px" }}>{n}. {title}</h2>
      <p className="muted" style={{ margin: 0, lineHeight: 1.65, maxWidth: "70ch" }}>{children}</p>
    </section>
  );
}

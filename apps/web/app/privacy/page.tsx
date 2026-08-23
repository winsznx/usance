import { Nav, Footer, Notice } from "@/components/primitives";

/**
 * `/privacy` — what Usance stores, which is almost nothing, and where.
 *
 * The honest version: there is no server-side account. A wallet session and display preferences
 * live in the visitor's own browser. The policy says that plainly rather than reserving rights to
 * collect data the product does not collect.
 */

export const metadata = {
  title: "Privacy Policy · Usance",
  description: "What Usance stores (a wallet session and preferences, in your own browser), and what it does not (no accounts, no tracking cookies).",
};

export default function PrivacyPage() {
  return (
    <>
      <Nav />
      <main>
        <section style={{ background: "var(--paper)", borderBottom: "1px solid var(--hairline)", padding: "56px 0" }}>
          <div className="shell" style={{ maxWidth: 820 }}>
            <div className="micro">Legal</div>
            <h1 className="heading-lg" style={{ margin: "18px 0 14px" }}>Privacy Policy</h1>
            <p className="body-lg muted" style={{ margin: 0 }}>
              What Usance stores, and where. Last updated 20 August 2026.
            </p>
          </div>
        </section>

        <section className="section">
          <div className="shell stack" style={{ maxWidth: 820, gap: 26 }}>
            <Notice title="There is no account, and no server-side profile">
              Usance does not ask for your name, email, or any identifying detail, and keeps no
              server-side record of you. What little state exists lives in your own browser.
            </Notice>

            <Clause n="1" title="What is stored in your browser">
              A <strong>wallet session</strong> (a signature proving you control your address) and
              your <strong>display preferences</strong> (detail level, notification and motion
              settings) are stored in this browser&rsquo;s local storage. They are never transmitted
              to a Usance server, and clearing your browser data or using &ldquo;Clear
              preferences&rdquo; and &ldquo;Sign out&rdquo; in Settings removes them.
            </Clause>

            <Clause n="2" title="On-chain data is public">
              Your wallet address and every transaction you sign are recorded on X Layer, a public
              blockchain, by its nature. Usance reads that public data to show your position. It does
              not make it public — the chain already is.
            </Clause>

            <Clause n="3" title="No tracking or advertising cookies">
              Usance uses no analytics, no advertising trackers, and no third-party cookies. The only
              browser storage it uses is the session and preferences described above.
            </Clause>

            <Clause n="4" title="Infrastructure you touch">
              To read the chain, the interface talks to a public X Layer RPC endpoint. As with any
              website or dapp, the network provider serving those requests may observe your IP
              address. Usance does not control that provider&rsquo;s logging.
            </Clause>

            <Clause n="5" title="Desktop notifications">
              If you enable desktop notifications in Settings, that permission is granted by your
              browser to this site and used only to raise a local notification about your own account
              state. Nothing is sent anywhere to power it.
            </Clause>

            <Clause n="6" title="Changes and contact">
              This policy will be updated as the product evolves, with the date above reflecting the
              latest version. Questions can be directed to{" "}
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

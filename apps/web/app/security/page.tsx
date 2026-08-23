import Link from "next/link";
import { Nav, Notice, Footer } from "@/components/primitives";
import { Illustration } from "@/components/kit-icon";
import { WITHDRAWAL_IS_NOT_DELEGABLE } from "@/lib/mandate";

/**
 * `/security` — what each grant actually gives away, before anybody grants one.
 *
 * This lived behind the wallet gate, which was backwards. It is reference material for somebody
 * deciding whether to connect at all, and the one person guaranteed never to see it was the person
 * who most needed it.
 *
 * The page leads with what disconnecting does *not* do, because that misconception has the worst
 * outcome: somebody walks away from a debt believing closing a tab settled it.
 */

export const metadata = {
  title: "Security · Usance",
  description:
    "What a wallet connection, an app session, a token allowance, a mandate and a transaction each grant, when each one ends, and which of them survive closing the browser.",
};

export default function SecurityPage() {
  return (
    <>
      <Nav />
      <main>
        <section style={{ background: "var(--paper)", borderBottom: "1px solid var(--hairline)", padding: "56px 0" }}>
          <div className="shell" style={{ maxWidth: 860 }}>
            <div className="micro">Security</div>
            <h1 className="heading-lg" style={{ margin: "18px 0 14px", maxWidth: "20ch" }}>
              Five things get called &ldquo;connected&rdquo;. They are not the same.
            </h1>
            <p className="body-lg muted" style={{ margin: 0, maxWidth: "62ch" }}>
              They grant different powers, they end at different times, and two of them outlive your
              browser. Almost every wallet interface blurs them together, and the consequence is
              somebody who believes disconnecting a site closed their position.
            </p>
          </div>
        </section>

        <section className="section">
          <div className="shell stack" style={{ maxWidth: 860, gap: 20 }}>
            <Notice tone="warn" title="Disconnecting does not close anything">
              Disconnecting your wallet from a site ends a browser session. It does not repay debt,
              release collateral, cancel a mandate or stop a liquidation. Your position exists on X
              Layer whether or not any website is open.
            </Notice>

            <div className="card stack" style={{ gap: 0 }}>
              <Layer
                name="Wallet connection"
                grants="A site can see your address and read your balances."
                ends="The moment you disconnect, or close the tab."
                risk="None. Nothing can move."
              />
              <Layer
                name="App session"
                grants="A signature proving you control the address, so Usance will show you your own portfolio."
                ends="When you disconnect or change account. It costs no gas and grants no allowance."
                risk="None. It authorises reading, not spending."
              />
              <Layer
                name="Token allowance"
                grants="A contract may move up to a stated amount of one token from your wallet."
                ends="Only when you revoke it. It survives disconnecting and closing the browser."
                risk="Bounded by the amount you approved. Usance requests exact amounts, never unlimited."
              />
              <Layer
                name="Mandate"
                grants="A named agent may take specific actions on your account, inside limits you signed."
                ends="At its expiry, or immediately when you revoke it. Revocation is permanent and there is no un-revoke function anywhere in the registry."
                risk="Bounded by the mandate. It can never withdraw collateral."
              />
              <Layer
                name="Transaction"
                grants="One specific action, once."
                ends="Immediately. It is already done."
                risk="Exactly what the transaction said and nothing more."
                last
              />
            </div>

            <div className="card">
              <Illustration name="mandate-agent-authority" width={300} height={188} />
              <h2 className="heading" style={{ fontSize: 19, margin: "16px 0 10px" }}>
                What a mandate can never do
              </h2>
              <p className="caption" style={{ margin: 0, maxWidth: "62ch" }}>{WITHDRAWAL_IS_NOT_DELEGABLE}</p>
            </div>

            <div className="card">
              <h2 className="heading" style={{ fontSize: 19, margin: "0 0 10px" }}>How to check this yourself</h2>
              <p className="caption" style={{ margin: "0 0 14px", maxWidth: "62ch" }}>
                None of the above is something you have to take on trust. The action vocabulary a
                mandate can grant is a fixed list in the contract with no outflow verb in it, and the
                gateway refuses any action outside that list regardless of what a signature says.
              </p>
              <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
                <Link className="btn btn-ghost" href="/status">Integration status</Link>
                <Link className="btn btn-ghost" href="/assets">Read a live Passport</Link>
              </div>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}

function Layer({
  name, grants, ends, risk, last,
}: { name: string; grants: string; ends: string; risk: string; last?: boolean }) {
  return (
    <div style={{ padding: "16px 0", borderBottom: last ? "none" : "1px solid var(--hairline)" }}>
      <div style={{ fontWeight: 500, marginBottom: 10 }}>{name}</div>
      <Detail label="Grants" value={grants} />
      <Detail label="Ends" value={ends} />
      <Detail label="Risk" value={risk} />
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="row" style={{ gap: 12, alignItems: "flex-start", marginTop: 5 }}>
      <span className="caption" style={{ minWidth: 56, color: "var(--graphite)", flex: "none" }}>{label}</span>
      <span className="caption" style={{ maxWidth: "60ch" }}>{value}</span>
    </div>
  );
}

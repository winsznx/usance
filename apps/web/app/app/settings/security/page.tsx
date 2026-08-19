"use client";

import Link from "next/link";
import { Notice } from "@/components/primitives";
import { AccountShell } from "@/components/account-shell";
import { WITHDRAWAL_IS_NOT_DELEGABLE } from "@/lib/mandate";

/**
 * `/app/settings/security` — five things people routinely conflate, kept apart.
 *
 * Connection, session, signature, mandate and transaction are five different grants with five
 * different blast radii, and almost every wallet UI in existence blurs them into "connected". The
 * consequence is a user who thinks disconnecting a site closes their position.
 *
 * The page therefore leads with what disconnecting does *not* do. That is the misconception with
 * the worst outcome, because somebody acting on it walks away from a debt believing it is settled.
 */
export default function SecurityPage() {
  return (
    <AccountShell
      title="Security and authority"
      intro="Five different things get called “connected”. They are not the same, and they do not end at the same time."
      before={
        <div className="stack" style={{ gap: 18 }}>
          <Notice tone="warn" title="Disconnecting does not close anything">
            Disconnecting your wallet from this site ends a browser session. It does not repay debt,
            release collateral, cancel a mandate or stop a liquidation. Your position exists on X
            Layer whether or not any website is open.
          </Notice>

          <div className="card stack" style={{ gap: 0 }}>
            <div className="micro" style={{ marginBottom: 12 }}>What each grant actually is</div>

            <Layer
              name="Wallet connection"
              grants="This site can see your address and read your balances."
              ends="The moment you disconnect, or close the tab."
              risk="None. Nothing can move."
            />
            <Layer
              name="App session"
              grants="A signature proving you control this address, so Usance will show you your own portfolio."
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
              ends="At its expiry, or immediately when you revoke it. Revocation is permanent."
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

          <Notice title="What a mandate can never do">{WITHDRAWAL_IS_NOT_DELEGABLE}</Notice>
        </div>
      }
    >
      {() => (
        <div className="stack" style={{ gap: 18 }}>
          <div className="card">
            <div className="micro" style={{ marginBottom: 12 }}>Ending authority</div>
            <p className="caption" style={{ marginTop: 0 }}>
              The only grant that outlives this browser is a mandate or a token allowance. Both are
              ended on chain, not by closing a tab.
            </p>
            <div className="row" style={{ gap: 10, flexWrap: "wrap", marginTop: 12 }}>
              <Link className="btn btn-ghost" href="/app/mandates">Review your mandates</Link>
              <Link className="btn btn-ghost" href="/app/positions">See what you owe</Link>
              <Link className="btn btn-ghost" href="/security">The full security model</Link>
            </div>
          </div>
        </div>
      )}
    </AccountShell>
  );
}

function Layer({
  name, grants, ends, risk, last,
}: { name: string; grants: string; ends: string; risk: string; last?: boolean }) {
  return (
    <div style={{ padding: "14px 0", borderTop: "1px solid var(--hairline)", borderBottom: last ? "none" : undefined }}>
      <div style={{ fontWeight: 500, marginBottom: 8 }}>{name}</div>
      <Detail label="Grants" value={grants} />
      <Detail label="Ends" value={ends} />
      <Detail label="Risk" value={risk} />
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="row" style={{ gap: 10, alignItems: "flex-start", marginTop: 4 }}>
      <span className="caption" style={{ minWidth: 56, color: "var(--graphite)" }}>{label}</span>
      <span className="caption">{value}</span>
    </div>
  );
}

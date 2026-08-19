"use client";

import Link from "next/link";
import { Notice } from "@/components/primitives";
import { AccountShell } from "@/components/account-shell";
import { activeChain } from "@/lib/deployments";

/**
 * `/app/settings` — only settings that are real.
 *
 * No notification toggles that persist nowhere and no theme switcher pretending to be a preference
 * system. A settings page full of controls that do nothing teaches users that controls in this
 * product do nothing.
 */
export default function SettingsPage() {
  const chain = activeChain();
  return (
    <AccountShell
      title="Settings"
      intro="Your connection, your network, and where your authority sits."
      before={
        <Notice title="There is nothing else to configure">
          Usance has no notification preferences, no display settings and no account profile,
          because none of those exist yet. A settings page listing controls that persist nowhere
          teaches people that controls in this product do nothing.
        </Notice>
      }
    >
      {(account) => (
        <div className="stack" style={{ gap: 18 }}>
          <div className="card">
            <div className="micro" style={{ marginBottom: 12 }}>Account</div>
            <Row label="Address" value={account} mono />
            <Row label="Network" value={`${chain.name} (chain ${chain.id})`} />
            <Row label="Settlement asset" value={chain.id === 196 ? "USDC" : "tUSD — TEST ASSET, NO REAL VALUE"} />
          </div>

          <div className="card">
            <div className="micro" style={{ marginBottom: 12 }}>Where to go</div>
            <LinkRow href="/app/settings/security" label="Security and authority" detail="Sessions, mandates, and what each one can do" />
            <LinkRow href="/app/mandates" label="Mandates" detail="Agents you have authorised, and their limits" />
            <LinkRow href="/app/activity" label="Activity" detail="Everything Usance has done on your account" />
          </div>
        </div>
      )}
    </AccountShell>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="row-between" style={{ padding: "10px 0", borderTop: "1px solid var(--hairline)", gap: 16 }}>
      <span className="caption">{label}</span>
      <span className={`caption${mono ? " mono" : ""}`} style={{ textAlign: "right", wordBreak: "break-all" }}>{value}</span>
    </div>
  );
}

function LinkRow({ href, label, detail }: { href: string; label: string; detail: string }) {
  return (
    <Link href={href} className="row-between" style={{ padding: "12px 0", borderTop: "1px solid var(--hairline)", textDecoration: "none", gap: 16 }}>
      <span className="stack" style={{ gap: 4 }}>
        <span style={{ fontWeight: 500 }}>{label}</span>
        <span className="caption" style={{ color: "var(--graphite)" }}>{detail}</span>
      </span>
      <span className="caption" aria-hidden="true">›</span>
    </Link>
  );
}

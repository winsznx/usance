"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {Notice} from "@/components/primitives";
import { AppShell } from "@/components/app-shell";
import { activeChain } from "@/lib/deployments";
import {
  MANDATE_ACTIONS,
  MANDATE_TEMPLATES,
  WITHDRAWAL_IS_NOT_DELEGABLE,
  actionsOf,
  canIncreaseRisk,
  grantedButRefused,
  maskFor,
} from "@/lib/mandate";

/**
 * `/app/mandates/new` — everything the signature means, before the signature.
 *
 * The failure mode this page is built against is the one that makes delegated authority dangerous:
 * a person signs typed data they did not read, granting powers they did not intend, to an address
 * they did not check. So the disclosure is the page, and the signing button is at the bottom of it.
 *
 * Two things are stated that a feature list would omit. What the mandate cannot do at all, and
 * which granted actions the protocol will still refuse — because a grant that authorises nothing is
 * not authority, and displaying it as though it were would overstate what the signer just did.
 */
export default function NewMandatePage() {
  const chain = activeChain();
  const [templateId, setTemplateId] = useState<string>(MANDATE_TEMPLATES[0]!.id);
  const [agentAddress, setAgentAddress] = useState("");
  const [maxDebt, setMaxDebt] = useState("1000");
  const [days, setDays] = useState("30");

  const template = MANDATE_TEMPLATES.find((t) => t.id === templateId)!;
  const mask = useMemo(() => maskFor(template.actions), [template]);
  const refused = grantedButRefused(mask);
  const agentLooksValid = /^0x[0-9a-fA-F]{40}$/.test(agentAddress.trim());

  return (
    <AppShell>

      <div style={{ maxWidth: 820 }}>
        <h1 className="heading-lg" style={{ marginBottom: 10 }}>Create a mandate</h1>
        <p className="muted" style={{ marginTop: 0, marginBottom: 28 }}>
          You are about to let another address act on your account. Read what it can do before you
          sign it.
        </p>

        <div className="stack" style={{ gap: 18 }}>
          <Notice title="What this mandate can never do">{WITHDRAWAL_IS_NOT_DELEGABLE}</Notice>

          <div className="card stack" style={{ gap: 16 }}>
            <div className="micro">What should the agent be able to do?</div>
            {MANDATE_TEMPLATES.map((t) => (
              <label
                key={t.id}
                className="panel"
                style={{ display: "block", cursor: "pointer", borderColor: t.id === templateId ? "var(--ink)" : undefined }}
              >
                <div className="row" style={{ gap: 10, alignItems: "flex-start" }}>
                  <input
                    type="radio"
                    name="template"
                    checked={t.id === templateId}
                    onChange={() => setTemplateId(t.id)}
                    style={{ marginTop: 4 }}
                  />
                  <div>
                    <div style={{ fontWeight: 500 }}>{t.title}</div>
                    <p className="caption" style={{ margin: "6px 0 0" }}>{t.blurb}</p>
                  </div>
                </div>
              </label>
            ))}
          </div>

          <div className="card stack" style={{ gap: 14 }}>
            <div className="micro">Who may act</div>
            <input
              className="input mono"
              placeholder="0x… the agent's address"
              value={agentAddress}
              onChange={(e) => setAgentAddress(e.target.value)}
              aria-label="Agent address"
            />
            {agentAddress.length > 0 && !agentLooksValid ? (
              <p className="caption" style={{ margin: 0, color: "var(--stop)" }}>
                That is not a 20-byte address. Check it against the agent you intend to authorise.
                A mandate signed to the wrong address authorises the wrong party.
              </p>
            ) : null}

            <div className="grid-2" style={{ gap: 12 }}>
              <div>
                <label className="stat-label" htmlFor="maxDebt">Debt ceiling (USD)</label>
                <input id="maxDebt" className="input tnum" value={maxDebt} onChange={(e) => setMaxDebt(e.target.value)} />
              </div>
              <div>
                <label className="stat-label" htmlFor="days">Expires in (days)</label>
                <input id="days" className="input tnum" value={days} onChange={(e) => setDays(e.target.value)} />
              </div>
            </div>
          </div>

          {/* The disclosure, assembled from the same data the signature will carry. */}
          <div className="card">
            <div className="micro" style={{ marginBottom: 12 }}>What you are signing</div>
            <Row label="Authorised agent" value={agentLooksValid ? agentAddress : "not set"} mono />
            <Row label="Allowed actions" value={actionsOf(mask).map((a) => a.label).join(", ") || "none"} />
            <Row label="Debt ceiling" value={`$${maxDebt}`} />
            <Row label="Expires" value={`${days} days from signing`} />
            <Row label="Can this raise your risk?" value={canIncreaseRisk(mask) ? "Yes" : "No"} />
            <Row label="Can this withdraw your collateral?" value="No, never" />
          </div>

          {refused.length > 0 ? (
            <Notice tone="warn" title="Some of these are granted but not yet executable">
              {refused.map((a) => a.label).join(", ")} would be inside this signature, and Usance
              still refuses them: no venue execution path is wired, so granting them authorises an
              act with nowhere to go. They are listed so the signature is not overstated.
            </Notice>
          ) : null}

          <Notice tone="warn" title="Signing is not yet wired to the deployed registry">
            The disclosure above is generated from the same action vocabulary the contract enforces,
            and the limits are real. Submitting the signature is not connected yet, so this page
            will not pretend to create a mandate it did not create.
          </Notice>

          <div className="row" style={{ gap: 12 }}>
            <button className="btn btn-primary btn-lg" disabled>
              Review and sign
            </button>
            <Link className="btn btn-ghost btn-lg" href="/app/mandates">Cancel</Link>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="row-between" style={{ padding: "10px 0", borderTop: "1px solid var(--hairline)" }}>
      <span className="caption">{label}</span>
      <span className={`caption${mono ? " mono" : ""}`} style={{ textAlign: "right" }}>{value}</span>
    </div>
  );
}

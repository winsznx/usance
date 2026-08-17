"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { formatUsd, parseUsd, formatTokens, type Gate, GATE_COPY } from "@usance/domain";
import type { TxState } from "@/lib/tx";
import { Notice, Steps } from "./primitives";

/**
 * The shared skeleton every transactional flow uses.
 *
 * Deposit, borrow, repay and withdraw are the same shape: pick an amount, see exactly what will
 * change before signing, sign once, then follow named stages that survive leaving the page. Doing
 * that four times independently is how three of them end up subtly worse than the best one, so it
 * lives here once.
 */

// ---------------------------------------------------------------------------------- amount input

export function AmountField({
  label,
  value,
  onChange,
  suffix,
  max,
  maxLabel = "Max",
  hint,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  suffix: string;
  max?: bigint | undefined;
  maxLabel?: string | undefined;
  hint?: string | undefined;
  disabled?: boolean | undefined;
}) {
  const shortcuts = [25, 50, 100];
  return (
    <div className="stack-sm">
      <div className="row-between">
        <label className="caption" style={{ color: "var(--graphite)" }}>
          {label}
        </label>
        {max !== undefined ? (
          <span className="caption tnum">
            {maxLabel}: ${formatUsd(max)}
          </span>
        ) : null}
      </div>

      <div className="row" style={{ gap: 10 }}>
        <input
          className="input"
          inputMode="decimal"
          // Not type="number": it silently accepts locale separators and exponent notation, and
          // a financial input that reinterprets what the user typed is a financial input that
          // will eventually move the wrong amount.
          type="text"
          placeholder="0.00"
          value={value}
          disabled={disabled}
          onChange={(e) => {
            const v = e.target.value;
            if (v === "" || /^\d*\.?\d{0,18}$/.test(v.replace(/,/g, ""))) onChange(v);
          }}
        />
        <span className="caption" style={{ minWidth: 56 }}>
          {suffix}
        </span>
      </div>

      {max !== undefined && max > 0n ? (
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          {shortcuts.map((pct) => (
            <button
              key={pct}
              type="button"
              className="btn btn-ghost"
              style={{ padding: "6px 14px", minHeight: 34, fontSize: 13 }}
              disabled={disabled}
              onClick={() => onChange(formatUsd((max * BigInt(pct)) / 100n, 6))}
            >
              {pct === 100 ? maxLabel : `${pct}%`}
            </button>
          ))}
        </div>
      ) : null}

      {hint ? (
        <p className="caption" style={{ margin: 0 }}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function useAmount(max?: bigint) {
  const [raw, setRaw] = useState("");
  const parsed = useMemo(() => parseUsd(raw), [raw]);
  const overMax = max !== undefined && parsed > max;
  return { raw, setRaw, parsed, overMax, isEmpty: parsed === 0n };
}

// ---------------------------------------------------------------------------------- preview

export function PreviewRow({
  label,
  before,
  after,
  emphasis,
}: {
  label: string;
  before?: string | undefined;
  after: string;
  emphasis?: boolean | undefined;
}) {
  return (
    <div className="row-between" style={{ padding: "11px 0", borderBottom: "1px solid var(--hairline)" }}>
      <span className="caption" style={{ color: "var(--graphite)" }}>
        {label}
      </span>
      <span className="row" style={{ gap: 8 }}>
        {before !== undefined ? (
          <>
            <span className="caption tnum" style={{ textDecoration: "line-through", opacity: 0.5 }}>
              {before}
            </span>
            <span className="caption" aria-hidden>
              →
            </span>
          </>
        ) : null}
        <span className="tnum" style={{ fontWeight: emphasis ? 500 : 400 }}>
          {after}
        </span>
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------------- tx timeline

const STAGE_STEPS: Array<{ key: string; label: string }> = [
  { key: "AWAITING_WALLET", label: "Confirm in your wallet" },
  { key: "SUBMITTED", label: "Submitted to X Layer" },
  { key: "CONFIRMING", label: "Confirming" },
  { key: "RECONCILING", label: "Reconciling protocol state" },
  { key: "COMPLETE", label: "Complete" },
];

export function TxTimeline({ tx, explorerUrl }: { tx: TxState; explorerUrl?: string | undefined }) {
  const idx = STAGE_STEPS.findIndex((s) => s.key === tx.stage);
  const terminalBad = tx.stage === "REJECTED" || tx.stage === "FAILED";

  if (tx.stage === "CONFIRMATION_UNKNOWN") {
    return (
      <Notice tone="warn" title="Checking the chain">
        {tx.message} Usance is looking your transaction up by its identity. This resolves on its
        own, and you can safely leave this page.
        {explorerUrl && tx.hash ? (
          <>
            {" "}
            <a href={`${explorerUrl}/tx/${tx.hash}`} target="_blank" rel="noreferrer" style={{ textDecoration: "underline" }}>
              View on the explorer
            </a>
            .
          </>
        ) : null}
      </Notice>
    );
  }

  if (terminalBad) {
    return (
      <Notice tone={tx.stage === "REJECTED" ? "warn" : "stop"} title={tx.reason?.title ?? (tx.stage === "REJECTED" ? "Declined in your wallet" : "Could not complete")}>
        {tx.reason ? (
          <>
            {tx.reason.body} {tx.reason.repair}
          </>
        ) : (
          (tx.message ?? "Nothing moved. You can adjust the amount and try again.")
        )}
      </Notice>
    );
  }

  return (
    <div className="stack-sm">
      <Steps
        steps={STAGE_STEPS.map((s, i) => ({
          label: s.label,
          state: idx < 0 ? "pending" : i < idx ? "done" : i === idx ? "active" : "pending",
        }))}
      />
      {tx.hash && explorerUrl ? (
        <p className="caption" style={{ margin: 0 }}>
          <a href={`${explorerUrl}/tx/${tx.hash}`} target="_blank" rel="noreferrer" style={{ textDecoration: "underline" }}>
            View transaction
          </a>
        </p>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------------- gates

export function GateBanners({ gates }: { gates: Gate[] }) {
  if (gates.length === 0) return null;
  return (
    <div className="stack-sm">
      {gates.map((g) => (
        <Notice key={g} tone="warn" title={GATE_COPY[g].title}>
          {GATE_COPY[g].body} {GATE_COPY[g].repair}
        </Notice>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------------- shell

export function ActionShell({
  title,
  intro,
  backHref = "/app",
  backLabel = "Back to portfolio",
  children,
}: {
  title: string;
  intro?: string | undefined;
  backHref?: string | undefined;
  backLabel?: string | undefined;
  children: React.ReactNode;
}) {
  return (
    <main className="shell" style={{ padding: "40px 24px 80px", maxWidth: 660 }}>
      <Link href={backHref} className="caption" style={{ textDecoration: "underline" }}>
        ← {backLabel}
      </Link>
      <h1 className="heading" style={{ margin: "18px 0 8px" }}>
        {title}
      </h1>
      {intro ? (
        <p className="muted" style={{ marginTop: 0, marginBottom: 30 }}>
          {intro}
        </p>
      ) : (
        <div style={{ height: 24 }} />
      )}
      {children}
    </main>
  );
}

/**
 * Shown when the flow is reachable but the protocol is not deployed on this chain.
 *
 * The form still renders above this so the shape of the action is inspectable. What is refused
 * is the pretence that pressing the button would do something.
 */
export function NotDeployedNotice({ chainName }: { chainName: string }) {
  return (
    <Notice
      tone="stop"
      title={`Not deployed on ${chainName} yet`}
      action={
        <div className="row" style={{ flexWrap: "wrap" }}>
          <Link className="btn btn-primary" href="/simulate">
            See the mechanism
          </Link>
          <Link className="btn btn-ghost" href="/status">
            Integration status
          </Link>
        </div>
      }
    >
      There are no contracts to call, so this action cannot be signed. The form above is the real
      one and works the moment a deployment is published.
    </Notice>
  );
}

export { formatUsd, formatTokens };

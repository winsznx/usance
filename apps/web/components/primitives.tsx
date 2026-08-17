import Link from "next/link";
import type { AccountStatus } from "@usance/domain";

/**
 * Shared presentational primitives.
 *
 * Every risk signal carries a text label as well as a colour. Red and green alone are not an
 * accessible way to tell someone their account is in trouble.
 */

const STATUS_LABEL: Record<AccountStatus, string> = {
  NORMAL: "Healthy",
  NO_NEW_RISK: "No new risk",
  REDUCE_ONLY: "Reduce only",
  MARGIN_CALL: "Action required",
  LIQUIDATING: "Liquidating",
  SETTLED: "Settled",
  BAD_DEBT: "Bad debt",
};

export function RiskBadge({ status }: { status: AccountStatus }) {
  return (
    <span className={`risk risk-${status}`} title={status}>
      {STATUS_LABEL[status]}
    </span>
  );
}

export function Stat({
  label,
  value,
  hint,
  prefix = "$",
}: {
  label: string;
  value: string;
  hint?: string | undefined;
  prefix?: string | undefined;
}) {
  return (
    <div className="stack-sm">
      <div className="stat-label">{label}</div>
      <div className="stat-value tnum">
        {prefix}
        {value}
      </div>
      {hint ? <div className="caption">{hint}</div> : null}
    </div>
  );
}

export function Logo({ light = false }: { light?: boolean }) {
  return (
    <Link href="/" className="row" style={{ gap: 9, color: light ? "var(--paper)" : undefined }}>
      <span style={{ fontSize: 19, lineHeight: 1 }}>✳</span>
      <span style={{ fontSize: 17, fontWeight: 500, letterSpacing: "-0.02em" }}>USANCE</span>
    </Link>
  );
}

export function Nav({ cta = true }: { cta?: boolean }) {
  return (
    <header
      style={{
        background: "var(--paper)",
        borderBottom: "1px solid var(--hairline)",
      }}
    >
      <div
        className="shell row-between"
        style={{ height: 68 }}
      >
        <Logo />
        <nav className="row" style={{ gap: 26, fontSize: 14 }}>
          <Link href="/assets" className="muted">
            Assets
          </Link>
          <Link href="/simulate" className="muted">
            How it works
          </Link>
          <Link href="/status" className="muted">
            Status
          </Link>
        </nav>
        {cta ? (
          <Link href="/app" className="btn btn-primary">
            Open Usance
          </Link>
        ) : (
          <span />
        )}
      </div>
    </header>
  );
}

export function Footer() {
  return (
    <footer style={{ borderTop: "1px solid var(--hairline)", padding: "40px 0 56px" }}>
      <div className="shell stack" style={{ gap: 20 }}>
        <div className="row-between" style={{ flexWrap: "wrap" }}>
          <Logo />
          <div className="row" style={{ gap: 22, fontSize: 14, flexWrap: "wrap" }}>
            <Link href="/assets" className="muted">
              Supported assets
            </Link>
            <Link href="/status" className="muted">
              Integration status
            </Link>
            <Link href="/simulate" className="muted">
              Walkthrough
            </Link>
          </div>
        </div>
        <p className="caption" style={{ maxWidth: 620, margin: 0 }}>
          Usance settles on X Layer. Borrowing against a tokenized asset carries risk, including
          liquidation. Recognised collateral value is deliberately lower than market value and can
          fall when the evidence behind an asset changes.
        </p>
      </div>
    </footer>
  );
}

/** A named stage in an asynchronous action. Users can leave and come back to it. */
export function Steps({
  steps,
}: {
  steps: Array<{ label: string; state: "pending" | "active" | "done" }>;
}) {
  return (
    <ul className="steps">
      {steps.map((s) => (
        <li key={s.label} data-state={s.state}>
          <span className="step-dot">{s.state === "done" ? "✓" : ""}</span>
          {s.label}
        </li>
      ))}
    </ul>
  );
}

export function Notice({
  tone = "neutral",
  title,
  children,
  action,
}: {
  tone?: ("neutral" | "warn" | "stop") | undefined;
  title: string;
  children?: React.ReactNode | undefined;
  action?: React.ReactNode | undefined;
}) {
  const cls = tone === "warn" ? "notice notice-warn" : tone === "stop" ? "notice notice-stop" : "notice";
  return (
    <div className={cls}>
      <div className="stack-sm">
        <strong style={{ fontWeight: 500 }}>{title}</strong>
        {children ? <div className="caption" style={{ color: "var(--graphite)" }}>{children}</div> : null}
        {action ? <div style={{ marginTop: 6 }}>{action}</div> : null}
      </div>
    </div>
  );
}

import Image from "next/image";
import Link from "next/link";
import { HeaderIsland } from "@/components/header-island";
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

/**
 * The Capacity Cut lockup from the kit.
 *
 * Both variants render and CSS picks one, because the header inverts on scroll and swapping the
 * `src` at that moment would blank the mark for a frame while the second file loads. Two 2KB SVGs
 * cost less than a logo that flickers on every scroll.
 */
export function Logo({ light = false }: { light?: boolean }) {
  return (
    <Link href="/" className={`logo${light ? " logo-light" : ""}`} aria-label="Usance home">
      <Image
        src="/assets/brand/svg/usance-lockup-horizontal.svg"
        alt="Usance"
        width={116}
        height={30}
        className="logo-dark-ink"
        priority
        unoptimized
      />
      <Image
        src="/assets/brand/svg/usance-lockup-horizontal-reversed.svg"
        alt=""
        aria-hidden
        width={116}
        height={30}
        className="logo-light-ink"
        unoptimized
      />
    </Link>
  );
}

/**
 * The site header, which condenses into a floating island on scroll.
 *
 * At rest it is a full-width bar sitting on the hero. Once the page moves it collapses to a
 * centred pill in Espresso, so the navigation stays reachable without a solid band cutting across
 * the artwork for the whole scroll.
 *
 * The same element on both widths. On a phone the links drop and the pill keeps the mark and the
 * action, because four navigation links at 12px are four links nobody can hit — the full set lives
 * one tap away inside the app rather than crammed into a bar.
 *
 * Every transition is width, padding, colour and elevation. Nothing reflows the links relative to
 * each other, so a target does not move out from under a cursor that is already travelling to it.
 */
export function Nav({ cta = true }: { cta?: boolean }) {
  return (
    <>
      <HeaderIsland headerId="site-header" />
      <header id="site-header" className="site-header" data-condensed="false">
        <div className="site-header-inner">
          <Logo />
          <nav className="site-header-nav" aria-label="Site">
            <Link href="/assets">Assets</Link>
            <Link href="/simulate">How it works</Link>
            <Link href="/security">Security</Link>
            <Link href="/status">Status</Link>
          </nav>
          {cta ? (
            <Link href="/app/onboarding" className="btn btn-primary site-header-cta">
              Open Usance
            </Link>
          ) : (
            <span />
          )}
        </div>
      </header>
    </>
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
  // Severity is named, not just coloured. A reader who cannot tell the two browns apart, or who is
  // looking at a greyscale screenshot, still learns which of these needs acting on.
  const label = tone === "warn" ? "Needs attention" : tone === "stop" ? "Action required" : null;

  return (
    <div className={cls} role={tone === "stop" ? "alert" : undefined}>
      <div className="stack-sm">
        {label ? <span className="notice-label">{label}</span> : null}
        <strong style={{ fontWeight: 500 }}>{title}</strong>
        {children ? <div className="caption" style={{ color: "var(--graphite)" }}>{children}</div> : null}
        {action ? <div style={{ marginTop: 6 }}>{action}</div> : null}
      </div>
    </div>
  );
}

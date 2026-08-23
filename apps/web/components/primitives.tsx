import Image from "next/image";
import Link from "next/link";
import { HeaderIsland } from "@/components/header-island";
import { Lockup } from "@/components/kit-icon";
import { SubscribeForm } from "@/components/subscribe-form";
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

/**
 * The site footer.
 *
 * One footer for every public page. It used to be a slim strip here and a rich four-column block
 * hand-written on the landing page, so the two drifted; this is the landing block, promoted to the
 * shared component so nothing can diverge again.
 */
export function Footer() {
  return (
    <footer className="site-footer">
      <div className="shell">
        <div className="footer-grid">
          <div className="footer-brand">
            <Lockup width={132} reversed />
            <p className="caption" style={{ margin: "16px 0 0", maxWidth: "30ch" }}>
              Make tokenized assets usable as capital.
            </p>
          </div>

          <div className="footer-col">
            <h4>Product</h4>
            <ul>
              <li><Link href="/assets">Assets</Link></li>
              <li><Link href="/earn">Earn</Link></li>
              <li><Link href="/simulate">Walkthrough</Link></li>
              <li><a href="https://docs.usance.xyz" target="_blank" rel="noreferrer">Docs</a></li>
              <li><Link href="/app/onboarding">Launch Usance</Link></li>
            </ul>
          </div>

          <div className="footer-col">
            <h4>Verify</h4>
            <ul>
              <li><Link href="/status">Integration status</Link></li>
              <li><Link href="/assets/franklin-fobxx">A live Passport</Link></li>
              <li><Link href="/security">Security model</Link></li>
            </ul>
          </div>

          <div className="footer-col">
            <h4>Legal</h4>
            <ul>
              <li><Link href="/terms">Terms of Service</Link></li>
              <li><Link href="/privacy">Privacy Policy</Link></li>
              <li><a href="https://x.com/usance_fi" target="_blank" rel="noreferrer">X (@usance_fi)</a></li>
            </ul>
          </div>

          <div className="footer-col footer-join">
            <h4>Network</h4>
            <ul>
              <li>
                <a href="https://www.okx.com/web3/explorer/xlayer-test" target="_blank" rel="noreferrer">
                  X Layer explorer
                </a>
              </li>
              <li>
                <a href="https://web3.okx.com/xlayer" target="_blank" rel="noreferrer">About X Layer</a>
              </li>
            </ul>

            {/*
              Wired for real: posts to /api/subscribe, which stores the address in Supabase. Its
              own states report success, already-subscribed, or the reason it could not — no fake
              confirmation.
            */}
            <p className="caption" style={{ margin: "0 0 12px", maxWidth: "32ch" }}>
              Get an email when Usance goes live on X Layer mainnet.
            </p>
            <SubscribeForm />
          </div>
        </div>

        <div className="footer-base">
          <span className="caption">© 2026 Usance. Built on X Layer.</span>
          <span className="caption" style={{ color: "var(--stone)" }}>
            Testnet deployment. Test assets have no real value.
          </span>
        </div>
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

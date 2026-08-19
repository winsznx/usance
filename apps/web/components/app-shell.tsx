"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "@/components/icon";
import { KitIcon, Lockup, MarkOnly, type KitIconName } from "@/components/kit-icon";
import { activeChain } from "@/lib/deployments";
import { ModeToggle } from "@/components/mode";

/**
 * The application frame.
 *
 * Three layouts from one component, because the alternative is a desktop app and a separate mobile
 * app that drift. Wide screens get a rail that collapses to icons; narrow screens get a bottom bar
 * for the four things people do repeatedly and a drawer for the rest.
 *
 * The bottom bar is not a shrunken sidebar. On a phone the top of the screen is the hardest place
 * to reach and the bottom is the easiest, so the frequent destinations go where the thumb already
 * is. Nine items in a drawer nobody opens is a worse answer than four items always reachable.
 *
 * Collapse state persists. Somebody who collapsed the rail meant it, and restoring it expanded on
 * every navigation is the kind of small betrayal that makes an interface feel unowned.
 */

interface NavItem {
  href: string;
  label: string;
  /** From the shipped kit. BRAND_LOCK.md forbids redrawing these. */
  icon: KitIconName;
  /** Shown in the phone's bottom bar. Everything else lives in the drawer. */
  primary?: boolean;
}

const NAV: NavItem[] = [
  { href: "/app", label: "Overview", icon: "status", primary: true },
  { href: "/app/positions", label: "Position", icon: "collateral", primary: true },
  { href: "/app/activity", label: "Activity", icon: "activity", primary: true },
  { href: "/app/alerts", label: "Alerts", icon: "alerts", primary: true },
  { href: "/assets", label: "Assets", icon: "passport" },
  { href: "/app/mandates", label: "Mandates", icon: "mandate" },
  { href: "/earn", label: "Earn", icon: "earn" },
  { href: "/app/settings", label: "Settings", icon: "settings" },
];

const STORAGE_KEY = "usance.rail.collapsed";

/** `g` then one of these. Chosen so the letter matches the destination's first sound. */
const SHORTCUTS: Record<string, string> = {
  o: "/app",
  p: "/app/positions",
  a: "/app/activity",
  n: "/app/alerts",
  m: "/app/mandates",
  e: "/earn",
  s: "/app/settings",
};

export function AppShell({
  children,
  account,
  alertCount = 0,
}: {
  children: React.ReactNode;
  account?: `0x${string}` | null;
  /** Shown against Alerts. Zero renders nothing rather than a "0" nobody needs to see. */
  alertCount?: number;
}) {
  const chain = activeChain();
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [drawer, setDrawer] = useState(false);

  useEffect(() => {
    setCollapsed(localStorage.getItem(STORAGE_KEY) === "1");
  }, []);

  const toggle = useCallback(() => {
    setCollapsed((c) => {
      localStorage.setItem(STORAGE_KEY, c ? "0" : "1");
      return !c;
    });
  }, []);

  /**
   * Readiness, polled once on mount.
   *
   * A page that quotes numbers while the chain is unreachable is worse than one that says so: the
   * user acts on a figure nobody can honour and finds out through a reverted transaction they paid
   * for. `/api/ready` already knows; this surfaces it.
   */
  const [degraded, setDegraded] = useState<string[] | null>(null);
  useEffect(() => {
    let live = true;
    fetch("/api/ready")
      .then((r) => r.json())
      .then((d) => live && setDegraded(d.ready ? [] : (d.blockedBy ?? ["unknown"])))
      // A failed readiness check is itself a degraded signal, not something to swallow.
      .catch(() => live && setDegraded(["the app could not reach its own readiness check"]));
    return () => {
      live = false;
    };
  }, []);

  /**
   * Keyboard navigation: `g` then a letter.
   *
   * Ignored while typing, or the sequence would swallow characters in a form. Deliberately not
   * single-letter shortcuts for the same reason — a bare `p` jumping pages while somebody types an
   * amount is the kind of thing that gets a shortcut system turned off.
   */
  useEffect(() => {
    let armed = false;
    let timer: number | undefined;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      if (armed) {
        const hit = SHORTCUTS[e.key.toLowerCase()];
        armed = false;
        window.clearTimeout(timer);
        if (hit) {
          e.preventDefault();
          window.location.assign(hit);
        }
        return;
      }
      if (e.key.toLowerCase() === "g") {
        armed = true;
        // The sequence expires, so a stray `g` does not turn the next keystroke into navigation.
        timer = window.setTimeout(() => (armed = false), 1400);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      window.clearTimeout(timer);
    };
  }, []);

  // A route change closes the drawer. Leaving it open over the destination is the commonest
  // navigation bug on a phone and it makes the app feel like it did not register the tap.
  useEffect(() => setDrawer(false), [pathname]);

  // Escape closes it too, and the drawer must not scroll the page behind it.
  useEffect(() => {
    if (!drawer) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setDrawer(false);
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [drawer]);

  const isActive = (href: string) => (href === "/app" ? pathname === "/app" : pathname.startsWith(href));

  return (
    <div className={`app-frame${collapsed ? " app-frame-collapsed" : ""}`}>
      {/* ------------------------------------------------------------------ desktop rail */}
      <nav className="rail" aria-label="Main">
        <div className="rail-head">
          <Link href="/" className="rail-mark" aria-label="Usance home">
            {collapsed ? <MarkOnly size={22} reversed /> : <Lockup width={118} reversed />}
          </Link>
        </div>

        <ul className="rail-list">
          {NAV.map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                className={`rail-item${isActive(item.href) ? " rail-item-active" : ""}`}
                aria-current={isActive(item.href) ? "page" : undefined}
                // The label is the accessible name when the rail is collapsed to icons.
                title={collapsed ? item.label : undefined}
              >
                <KitIcon name={item.icon} size={20} className="rail-glyph" />
                <span className="rail-label">{item.label}</span>
                {item.href === "/app/alerts" && alertCount > 0 ? (
                  <span className="rail-badge" aria-label={`${alertCount} needing attention`}>{alertCount}</span>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>

        {/*
          On the edge of the rail rather than buried at the bottom of the list. A collapse control
          that looks like a nav item reads as one more destination, and the previous version was a
          row of small text nobody found — which is exactly the report that produced this change.
        */}
        <button
          className="rail-handle"
          onClick={toggle}
          aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
          aria-expanded={!collapsed}
        >
          <Icon name={collapsed ? "chevronRight" : "chevronLeft"} size={14} />
        </button>
      </nav>

      {/* ------------------------------------------------------------------ content */}
      <div className="app-main">
        <header className="app-topbar">
          <button className="icon-button only-mobile" onClick={() => setDrawer(true)} aria-label="Open navigation" aria-expanded={drawer}>
            <Icon name="menu" size={20} />
          </button>

          <Link href="/" className="topbar-mark only-mobile" aria-label="Usance home">
            <MarkOnly size={22} />
          </Link>

          <div className="topbar-right">
            <ModeToggle />
            <span className="tag">{chain.name}</span>
            {account ? (
              <span className="tag mono" style={{ fontSize: 12 }}>
                {account.slice(0, 6)}…{account.slice(-4)}
              </span>
            ) : null}
          </div>
        </header>

        {degraded && degraded.length > 0 ? (
          <div className="degraded" role="status">
            <Icon name="warn" size={16} />
            <span>
              Usance cannot safely quote right now ({degraded.join(", ")}). Figures on screen may be
              stale, and actions may be refused. Nothing on chain has changed.
            </span>
          </div>
        ) : null}

        {chain.id !== 196 ? (
          <div className="testnet-strip">
            X LAYER TESTNET · TEST ASSETS HAVE NO REAL VALUE · tUSTB IS NOT FOBXX, OUSG OR ARCOIN
          </div>
        ) : null}

        <div className="app-content">{children}</div>
      </div>

      {/* ------------------------------------------------------------------ phone drawer */}
      {drawer ? (
        <div className="drawer-scrim" onClick={() => setDrawer(false)} role="presentation">
          <nav className="drawer" aria-label="All destinations" onClick={(e) => e.stopPropagation()}>
            <div className="row-between" style={{ marginBottom: 20 }}>
              <Lockup width={112} />
              <button className="icon-button" onClick={() => setDrawer(false)} aria-label="Close navigation">
                <Icon name="close" size={18} />
              </button>
            </div>
            <ul className="drawer-list">
              {NAV.map((item) => (
                <li key={item.href}>
                  <Link href={item.href} className={`drawer-item${isActive(item.href) ? " drawer-item-active" : ""}`}>
                    <KitIcon name={item.icon} size={20} />
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      ) : null}

      {/* ------------------------------------------------------------------ phone bottom bar */}
      <nav className="tabbar" aria-label="Primary">
        {NAV.filter((i) => i.primary).map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`tabbar-item${isActive(item.href) ? " tabbar-item-active" : ""}`}
            aria-current={isActive(item.href) ? "page" : undefined}
          >
            <KitIcon name={item.icon} size={22} />
            <span>{item.label}</span>
            {item.href === "/app/alerts" && alertCount > 0 ? (
              <span className="tabbar-badge" aria-label={`${alertCount} needing attention`}>{alertCount}</span>
            ) : null}
          </Link>
        ))}
      </nav>
    </div>
  );
}

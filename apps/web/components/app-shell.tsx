"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, Mark, type IconName } from "@/components/icon";
import { activeChain } from "@/lib/deployments";

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
  icon: IconName;
  /** Shown in the phone's bottom bar. Everything else lives in the drawer. */
  primary?: boolean;
}

const NAV: NavItem[] = [
  { href: "/app", label: "Overview", icon: "home", primary: true },
  { href: "/app/positions", label: "Position", icon: "position", primary: true },
  { href: "/app/activity", label: "Activity", icon: "activity", primary: true },
  { href: "/app/alerts", label: "Alerts", icon: "alerts", primary: true },
  { href: "/assets", label: "Assets", icon: "assets" },
  { href: "/app/mandates", label: "Mandates", icon: "mandates" },
  { href: "/earn", label: "Earn", icon: "earn" },
  { href: "/app/settings", label: "Settings", icon: "settings" },
];

const STORAGE_KEY = "usance.rail.collapsed";

export function AppShell({ children, account }: { children: React.ReactNode; account?: `0x${string}` | null }) {
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
            <Mark size={18} />
            <span className="rail-wordmark">USANCE</span>
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
                <Icon name={item.icon} size={20} />
                <span className="rail-label">{item.label}</span>
              </Link>
            </li>
          ))}
        </ul>

        <button className="rail-toggle" onClick={toggle} aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}>
          <Icon name={collapsed ? "chevronRight" : "chevronLeft"} size={16} />
          <span className="rail-label">Collapse</span>
        </button>
      </nav>

      {/* ------------------------------------------------------------------ content */}
      <div className="app-main">
        <header className="app-topbar">
          <button className="icon-button only-mobile" onClick={() => setDrawer(true)} aria-label="Open navigation" aria-expanded={drawer}>
            <Icon name="menu" size={20} />
          </button>

          <Link href="/" className="topbar-mark only-mobile" aria-label="Usance home">
            <Mark size={16} />
          </Link>

          <div className="topbar-right">
            <span className="tag">{chain.name}</span>
            {account ? (
              <span className="tag mono" style={{ fontSize: 12 }}>
                {account.slice(0, 6)}…{account.slice(-4)}
              </span>
            ) : null}
          </div>
        </header>

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
              <span className="row" style={{ gap: 8 }}>
                <Mark size={16} />
                <strong style={{ fontWeight: 500, letterSpacing: "0.06em" }}>USANCE</strong>
              </span>
              <button className="icon-button" onClick={() => setDrawer(false)} aria-label="Close navigation">
                <Icon name="close" size={18} />
              </button>
            </div>
            <ul className="drawer-list">
              {NAV.map((item) => (
                <li key={item.href}>
                  <Link href={item.href} className={`drawer-item${isActive(item.href) ? " drawer-item-active" : ""}`}>
                    <Icon name={item.icon} size={20} />
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
            <Icon name={item.icon} size={22} />
            <span>{item.label}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}

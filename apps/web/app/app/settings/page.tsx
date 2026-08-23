"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Notice } from "@/components/primitives";
import { AccountShell } from "@/components/account-shell";
import { OnChain } from "@/components/onchain";
import { ModeToggle } from "@/components/mode";
import { activeChain } from "@/lib/deployments";
import { clearSession } from "@/lib/session";
import { usePreferences, notificationPermission, clearPreferences, type NotifySeverity } from "@/lib/preferences";

/**
 * `/app/settings` — real settings, and only real ones.
 *
 * The rule the old page stated still holds: a control that persists nowhere teaches people that
 * controls in this product do nothing. So everything here is stored in this browser and takes
 * effect immediately. Notifications add a desktop alert; they never hide the in-app one, because a
 * setting that could mute a margin call is a setting that gets somebody liquidated.
 */

const SEVERITY_COPY: Record<NotifySeverity, { label: string; detail: string }> = {
  URGENT: { label: "Urgent", detail: "Margin call, or a liquidation in progress." },
  WARN: { label: "Warnings", detail: "Borrowing or withdrawal paused, a mandate about to lapse, a refused input." },
  INFO: { label: "Updates", detail: "Risk-policy changes, reserved capital, a redemption ready to claim." },
};

const SHORTCUTS: Array<{ keys: string; label: string }> = [
  { keys: "G O", label: "Overview" },
  { keys: "G P", label: "Position" },
  { keys: "G A", label: "Activity" },
  { keys: "G N", label: "Alerts" },
  { keys: "G M", label: "Mandates" },
  { keys: "G E", label: "Earn" },
  { keys: "G S", label: "Settings" },
];

export default function SettingsPage() {
  return (
    <AccountShell
      title="Settings"
      intro="Notifications, display, your session, and where your authority sits. Everything here is stored in this browser and takes effect immediately."
    >
      {(account) => <SettingsBody account={account} />}
    </AccountShell>
  );
}

function SettingsBody({ account }: { account: `0x${string}` }) {
  const chain = activeChain();
  const router = useRouter();
  const { prefs, update } = usePreferences();
  const [perm, setPerm] = useState<ReturnType<typeof notificationPermission>>("unsupported");
  const [notifError, setNotifError] = useState<string | null>(null);
  const [cleared, setCleared] = useState(false);

  useEffect(() => setPerm(notificationPermission()), []);

  const notificationsLive = prefs.browserNotifications && perm === "granted";

  const enableBrowser = useCallback(async () => {
    setNotifError(null);
    if (typeof Notification === "undefined") {
      setNotifError("This browser cannot show notifications.");
      return;
    }
    const result = await Notification.requestPermission();
    setPerm(result);
    if (result === "granted") {
      update({ browserNotifications: true });
      new Notification("Usance notifications are on", {
        body: "You'll get a desktop alert when something on your account needs a decision.",
      });
    } else {
      update({ browserNotifications: false });
      setNotifError("Your browser is blocking notifications for this site. Allow them in your browser's site settings, then try again.");
    }
  }, [update]);

  const signOut = useCallback(() => {
    clearSession();
    router.replace("/app/onboarding");
  }, [router]);

  const resetPrefs = useCallback(() => {
    clearPreferences();
    setNotifError(null);
    setCleared(true);
    setTimeout(() => setCleared(false), 2500);
  }, []);

  return (
    <div className="dash-grid">
      {/* -------------------------------------------------------------- left */}
      <div className="stack" style={{ gap: 18 }}>
        {/* Notifications */}
        <section className="card">
          <div className="micro" style={{ marginBottom: 6 }}>Notifications</div>
          <p className="caption" style={{ margin: "0 0 6px", color: "var(--graphite)" }}>
            A desktop alert when something needs a decision, even with this tab in the background.
            Your in-app alerts always show regardless. This only adds one outside the tab.
          </p>

          <SettingRow
            title="Desktop notifications"
            detail={
              perm === "unsupported"
                ? "This browser cannot show notifications."
                : perm === "denied"
                  ? "Blocked by your browser. Allow them in site settings to turn this on."
                  : notificationsLive
                    ? "On. You'll be notified even when this tab is not in focus."
                    : "Off. Turn on to be notified when this tab is not in focus."
            }
            control={
              notificationsLive ? (
                <Toggle on label="Desktop notifications" onClick={() => update({ browserNotifications: false })} />
              ) : (
                <Toggle
                  on={false}
                  label="Desktop notifications"
                  disabled={perm === "unsupported" || perm === "denied"}
                  onClick={enableBrowser}
                />
              )
            }
          />

          <div style={{ opacity: notificationsLive ? 1 : 0.5 }}>
            {(Object.keys(SEVERITY_COPY) as NotifySeverity[]).map((s) => (
              <SettingRow
                key={s}
                title={SEVERITY_COPY[s].label}
                detail={SEVERITY_COPY[s].detail}
                control={
                  <Toggle
                    on={prefs.notify[s]}
                    label={`Notify: ${SEVERITY_COPY[s].label}`}
                    disabled={!notificationsLive || s === "URGENT"}
                    onClick={() => update({ notify: { [s]: !prefs.notify[s] } })}
                  />
                }
              />
            ))}
            <p className="caption" style={{ margin: "12px 0 0", color: "var(--graphite)" }}>
              Urgent always notifies. A margin call is the one thing this product will not let you mute.
            </p>
          </div>

          {notifError ? (
            <div style={{ marginTop: 14 }}>
              <Notice tone="warn" title="Notifications not enabled">{notifError}</Notice>
            </div>
          ) : null}
        </section>

        {/* Detail level */}
        <section className="card">
          <div className="row-between" style={{ marginBottom: 10 }}>
            <div className="micro">Detail level</div>
            <ModeToggle />
          </div>
          <p className="caption" style={{ margin: 0, color: "var(--graphite)" }}>
            Advanced adds provenance, like block numbers, asset ids, and which bound was binding. It
            never removes risk information: a mode that could hide a margin call would get somebody
            liquidated for using the default.
          </p>
        </section>

        {/* Appearance */}
        <section className="card">
          <div className="micro" style={{ marginBottom: 6 }}>Appearance</div>
          <SettingRow
            title="Reduce motion"
            detail="Turn off transitions and animation across the app. Stored in this browser."
            control={
              <Toggle
                on={prefs.reduceMotion}
                label="Reduce motion"
                onClick={() => update({ reduceMotion: !prefs.reduceMotion })}
              />
            }
          />
        </section>

        {/* Keyboard shortcuts */}
        <section className="card">
          <div className="micro" style={{ marginBottom: 6 }}>Keyboard</div>
          <p className="caption" style={{ margin: "0 0 6px", color: "var(--graphite)" }}>
            Press <kbd className="kbd">G</kbd> then a letter to jump between sections.
          </p>
          {SHORTCUTS.map((s) => (
            <div key={s.label} className="row-between" style={{ padding: "9px 0", borderTop: "1px solid var(--hairline)" }}>
              <span className="caption">{s.label}</span>
              <span className="row" style={{ gap: 5 }}>
                {s.keys.split(" ").map((k, i) => (
                  <kbd key={i} className="kbd">{k}</kbd>
                ))}
              </span>
            </div>
          ))}
        </section>
      </div>

      {/* -------------------------------------------------------------- right */}
      <div className="stack" style={{ gap: 18 }}>
        {/* Account */}
        <section className="card">
          <div className="micro" style={{ marginBottom: 12 }}>Account</div>
          <div className="row-between" style={{ padding: "10px 0", borderTop: "1px solid var(--hairline)", gap: 16 }}>
            <span className="caption">Address</span>
            <OnChain kind="address" value={account} label="your account" />
          </div>
          <Row label="Network" value={`${chain.name} (chain ${chain.id})`} />
          <Row label="Settlement asset" value={chain.id === 196 ? "USDC" : "tUSD (TEST ASSET, NO REAL VALUE)"} />
        </section>

        {/* Session */}
        <section className="card">
          <div className="micro" style={{ marginBottom: 10 }}>Session</div>
          <p className="caption" style={{ margin: "0 0 14px", color: "var(--graphite)" }}>
            You are signed in with a signature from this wallet, kept only in this browser. Signing
            out clears it here. It does not touch anything on chain, and your position is unchanged.
          </p>
          <button className="btn btn-ghost" onClick={signOut}>Sign out</button>
        </section>

        {/* Where to go */}
        <section className="card">
          <div className="micro" style={{ marginBottom: 12 }}>Where to go</div>
          <LinkRow href="/app/settings/security" label="Security and authority" detail="Sessions, mandates, and what each one can do" />
          <LinkRow href="/app/mandates" label="Mandates" detail="Agents you have authorised, and their limits" />
          <LinkRow href="/app/activity" label="Activity" detail="Everything Usance has done on your account" />
          <LinkRow href="/status" label="Integration status" detail="What is live, what needs access, what is not available" />
        </section>

        {/* Data */}
        <section className="card">
          <div className="micro" style={{ marginBottom: 6 }}>Saved data</div>
          <SettingRow
            title="Clear preferences on this browser"
            detail="Resets notifications, detail level and motion to their defaults. Does not sign you out or touch anything on chain."
            control={
              <button className="btn btn-ghost" onClick={resetPrefs} style={{ minHeight: 34, padding: "6px 14px" }}>
                {cleared ? "Cleared" : "Clear"}
              </button>
            }
          />
        </section>
      </div>
    </div>
  );
}

function Toggle({ on, onClick, disabled, label }: { on: boolean; onClick: () => void; disabled?: boolean; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      style={{
        width: 44,
        height: 26,
        borderRadius: 999,
        border: "1px solid var(--hairline-strong)",
        background: on ? "var(--espresso)" : "var(--mist)",
        position: "relative",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.45 : 1,
        transition: "background 160ms",
        flex: "none",
        padding: 0,
      }}
    >
      <span
        aria-hidden
        style={{
          position: "absolute",
          top: 2,
          left: on ? 20 : 2,
          width: 20,
          height: 20,
          borderRadius: 999,
          background: "var(--paper)",
          transition: "left 160ms",
          boxShadow: "0 1px 2px rgba(0,0,0,0.2)",
        }}
      />
    </button>
  );
}

function SettingRow({ title, detail, control }: { title: string; detail: string; control: React.ReactNode }) {
  return (
    <div className="row-between" style={{ padding: "12px 0", borderTop: "1px solid var(--hairline)", gap: 16, alignItems: "flex-start" }}>
      <span className="stack" style={{ gap: 3 }}>
        <span style={{ fontWeight: 500, fontSize: 14 }}>{title}</span>
        <span className="caption" style={{ color: "var(--graphite)", maxWidth: "46ch" }}>{detail}</span>
      </span>
      <span style={{ flex: "none", marginTop: 2 }}>{control}</span>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="row-between" style={{ padding: "10px 0", borderTop: "1px solid var(--hairline)", gap: 16 }}>
      <span className="caption">{label}</span>
      <span className="caption" style={{ textAlign: "right", wordBreak: "break-all" }}>{value}</span>
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

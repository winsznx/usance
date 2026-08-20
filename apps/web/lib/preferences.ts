"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Local, per-browser preferences that actually take effect.
 *
 * The settings page used to say "there is nothing to configure" on principle: a control that
 * persists nowhere teaches people that controls in this product do nothing. That principle stands —
 * so everything here is real. It is stored in this browser, it changes behaviour immediately, and
 * none of it can hide a risk signal.
 *
 * The last part is the hard rule. Notification preferences govern the *desktop* notification only,
 * which is additive. They never filter the in-app alert list: a setting that could suppress a
 * margin-call banner is a setting that gets somebody liquidated for having tidied their inbox.
 */

export type NotifySeverity = "URGENT" | "WARN" | "INFO";

export interface Preferences {
  /** Raise a desktop notification for qualifying alerts. Requires the browser permission. */
  browserNotifications: boolean;
  /** Which severities may raise a desktop notification. In-app alerts are shown regardless. */
  notify: Record<NotifySeverity, boolean>;
  /** Kill transitions and animations for this browser, over and above the OS setting. */
  reduceMotion: boolean;
}

export const DEFAULT_PREFERENCES: Preferences = {
  browserNotifications: false,
  notify: { URGENT: true, WARN: true, INFO: false },
  reduceMotion: false,
};

const KEY = "usance.preferences";
const EVENT = "usance:preferences";

export function loadPreferences(): Preferences {
  if (typeof window === "undefined") return DEFAULT_PREFERENCES;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return DEFAULT_PREFERENCES;
    const p = JSON.parse(raw) as Partial<Preferences>;
    return {
      browserNotifications: p.browserNotifications ?? DEFAULT_PREFERENCES.browserNotifications,
      notify: { ...DEFAULT_PREFERENCES.notify, ...(p.notify ?? {}) },
      reduceMotion: p.reduceMotion ?? DEFAULT_PREFERENCES.reduceMotion,
    };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

export function savePreferences(p: Preferences): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, JSON.stringify(p));
  applyReduceMotion(p.reduceMotion);
  // So other hook instances mounted in this same tab update without a reload.
  window.dispatchEvent(new CustomEvent<Preferences>(EVENT, { detail: p }));
}

/** Reset to defaults and return them. Used by the settings "clear" control. */
export function clearPreferences(): Preferences {
  if (typeof window !== "undefined") window.localStorage.removeItem(KEY);
  applyReduceMotion(DEFAULT_PREFERENCES.reduceMotion);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent<Preferences>(EVENT, { detail: DEFAULT_PREFERENCES }));
  }
  return DEFAULT_PREFERENCES;
}

export function applyReduceMotion(on: boolean): void {
  if (typeof document === "undefined") return;
  if (on) document.documentElement.setAttribute("data-reduce-motion", "true");
  else document.documentElement.removeAttribute("data-reduce-motion");
}

/** Whether the browser can raise notifications at all, and the current grant. */
export function notificationPermission(): NotificationPermission | "unsupported" {
  if (typeof window === "undefined" || typeof Notification === "undefined") return "unsupported";
  return Notification.permission;
}

/** A patch may set a subset of the notify severities without restating the others. */
export type PreferencesPatch = Partial<Omit<Preferences, "notify">> & {
  notify?: Partial<Record<NotifySeverity, boolean>>;
};

/**
 * Reactive preferences for a component.
 *
 * Applies reduce-motion on mount so a reload lands in the chosen state, and listens for changes
 * made by another instance in the same tab (the settings page and the overview both read this).
 */
export function usePreferences(): { prefs: Preferences; update: (patch: PreferencesPatch) => void } {
  const [prefs, setPrefs] = useState<Preferences>(DEFAULT_PREFERENCES);

  useEffect(() => {
    const p = loadPreferences();
    setPrefs(p);
    applyReduceMotion(p.reduceMotion);
  }, []);

  useEffect(() => {
    const onLocal = (e: Event) => setPrefs((e as CustomEvent<Preferences>).detail);
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY) setPrefs(loadPreferences());
    };
    window.addEventListener(EVENT, onLocal as EventListener);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(EVENT, onLocal as EventListener);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const update = useCallback((patch: PreferencesPatch) => {
    setPrefs((cur) => {
      const next: Preferences = {
        browserNotifications: patch.browserNotifications ?? cur.browserNotifications,
        reduceMotion: patch.reduceMotion ?? cur.reduceMotion,
        notify: { ...cur.notify, ...(patch.notify ?? {}) },
      };
      savePreferences(next);
      return next;
    });
  }, []);

  return { prefs, update };
}

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

const KEY = "usance.cookie-ack";

/**
 * A storage notice, honest about what it acknowledges.
 *
 * Usance sets no tracking or advertising cookies — it keeps a wallet session and your preferences
 * in local storage. So this is a one-time disclosure, not a consent gate for ad-tech. The
 * acknowledgement is itself stored locally, which is the only thing being disclosed.
 */
export function CookieConsent() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    try {
      if (localStorage.getItem(KEY) !== "1") setShow(true);
    } catch {
      /* storage blocked — then there is nothing to disclose, so no banner */
    }
  }, []);

  if (!show) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(KEY, "1");
    } catch {
      /* ignore */
    }
    setShow(false);
  };

  return (
    <div className="cookie-consent" role="dialog" aria-label="Storage notice">
      <p className="cookie-consent-text">
        Usance stores a wallet session and your preferences in this browser. No third-party tracking
        or advertising cookies. <Link href="/privacy">Privacy Policy</Link>.
      </p>
      <button className="btn btn-primary" type="button" onClick={dismiss} style={{ alignSelf: "flex-start" }}>
        Got it
      </button>
    </div>
  );
}

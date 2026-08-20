"use client";

import { useState } from "react";

/**
 * The footer email capture, wired for real.
 *
 * It posts to `/api/subscribe`, which stores the address in Supabase. The states are honest: a
 * success says you're on the list, an already-subscribed address is treated as success, and any
 * failure (including "not configured yet") surfaces the reason rather than a fake confirmation.
 */

type State = "idle" | "submitting" | "ok" | "already" | "error";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function SubscribeForm() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<State>("idle");
  const [message, setMessage] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const value = email.trim().toLowerCase();
    if (!EMAIL.test(value)) {
      setState("error");
      setMessage("That does not look like an email address.");
      return;
    }
    setState("submitting");
    setMessage(null);
    try {
      const res = await fetch("/api/subscribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: value }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; status?: string; error?: string };
      if (res.ok && data.ok) {
        setState(data.status === "ALREADY" ? "already" : "ok");
      } else {
        setState("error");
        setMessage(data.error ?? "Could not subscribe right now. Please try again.");
      }
    } catch {
      setState("error");
      setMessage("Could not reach the server. Please try again.");
    }
  }

  if (state === "ok" || state === "already") {
    return (
      <p className="subscribe-msg subscribe-ok" role="status">
        {state === "already"
          ? "You're already on the list — thanks."
          : "You're on the list. We'll email you when it's live."}
      </p>
    );
  }

  return (
    <>
      <form className="footer-subscribe" onSubmit={submit} noValidate>
        <label className="sr-only" htmlFor="subscribe">Email address</label>
        <input
          id="subscribe"
          type="email"
          inputMode="email"
          autoComplete="email"
          placeholder="Enter your email"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            if (state === "error") {
              setState("idle");
              setMessage(null);
            }
          }}
          disabled={state === "submitting"}
        />
        <button className="btn btn-primary" type="submit" disabled={state === "submitting"}>
          {state === "submitting" ? "Joining…" : "Subscribe"}
        </button>
      </form>
      {state === "error" && message ? (
        <p className="subscribe-msg subscribe-error" role="alert">{message}</p>
      ) : null}
    </>
  );
}

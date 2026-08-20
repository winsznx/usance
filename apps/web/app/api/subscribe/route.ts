import { NextResponse } from "next/server";

/**
 * `/api/subscribe` — capture an email for the launch list.
 *
 * A stopgap before a real mailing system: it stores each address in a Supabase `subscribers` table
 * over the REST API. It is honest in both directions — it never claims to have stored an email it
 * could not, and a duplicate is reported as success rather than an error, because from the person's
 * side being on the list twice and once are the same thing.
 *
 * Supabase is reached with plain `fetch`, so this runs unchanged on the Cloudflare Worker that
 * OpenNext produces — no Node-only client, no extra dependency. The service-role key is read
 * server-side only and never reaches the browser.
 */

export const dynamic = "force-dynamic";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: Request) {
  let email = "";
  try {
    const body = (await req.json()) as { email?: unknown };
    email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  } catch {
    return NextResponse.json({ ok: false, error: "Send a JSON body with an email." }, { status: 400 });
  }

  if (!EMAIL.test(email) || email.length > 254) {
    return NextResponse.json({ ok: false, error: "That does not look like an email address." }, { status: 400 });
  }

  const base = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key) {
    // Nothing to store into yet. Say so rather than returning a success nobody honoured.
    return NextResponse.json(
      { ok: false, error: "Email capture is not configured on this deployment yet." },
      { status: 503 },
    );
  }

  try {
    const res = await fetch(`${base}/rest/v1/subscribers`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        apikey: key,
        authorization: `Bearer ${key}`,
        prefer: "return=minimal",
      },
      body: JSON.stringify({ email, source: "footer" }),
    });

    if (res.ok) {
      return NextResponse.json({ ok: true, status: "SUBSCRIBED" });
    }

    // A unique-constraint hit means the address is already on the list — a success, not a failure.
    const detail = await res.text().catch(() => "");
    if (res.status === 409 || detail.includes("23505") || detail.toLowerCase().includes("duplicate")) {
      return NextResponse.json({ ok: true, status: "ALREADY" });
    }

    return NextResponse.json({ ok: false, error: "Could not save your email. Please try again." }, { status: 502 });
  } catch {
    return NextResponse.json({ ok: false, error: "Could not reach the mailing store. Please try again." }, { status: 502 });
  }
}

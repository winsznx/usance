import { NextResponse } from "next/server";
import { AUTH_SESSION_TTL_SECONDS, INSTITUTIONAL_SESSION_COOKIE, createSession, findChallenge, isSameOrigin, nonce, sha256, signatureMatches } from "@/lib/institutional-auth";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ outcome: "ORIGIN_REJECTED" }, { status: 403 });
  let body: { challengeId?: unknown; nonce?: unknown; signature?: unknown } = {}; try { body = await request.json() as typeof body; } catch { return NextResponse.json({ outcome: "BAD_REQUEST" }, { status: 400 }); }
  if (typeof body.challengeId !== "string" || typeof body.nonce !== "string" || typeof body.signature !== "string" || !/^[0-9a-f]{64}$/.test(body.nonce)) return NextResponse.json({ outcome: "BAD_REQUEST" }, { status: 400 });
  try {
    const challenge = await findChallenge(body.challengeId);
    if (!challenge || challenge.consumed_at || challenge.expires_at <= new Date().toISOString() || await sha256(body.nonce) !== challenge.nonce_hash || !await signatureMatches(challenge, body.nonce, body.signature)) return NextResponse.json({ outcome: "AUTHENTICATION_REJECTED" }, { status: 401 });
    const sessionToken = nonce(); const session = await createSession(challenge, sessionToken); const response = NextResponse.json({ authenticated: true, caller: { walletAddress: session.wallet_address, organization: { slug: session.organization_slug, displayName: session.organization_display_name }, role: session.membership_role }, expiresAt: session.expires_at });
    response.cookies.set(INSTITUTIONAL_SESSION_COOKIE, sessionToken, { httpOnly: true, secure: new URL(request.url).protocol === "https:", sameSite: "strict", path: "/", maxAge: AUTH_SESSION_TTL_SECONDS }); return response;
  } catch { return NextResponse.json({ outcome: "AUTH_UNAVAILABLE" }, { status: 503 }); }
}

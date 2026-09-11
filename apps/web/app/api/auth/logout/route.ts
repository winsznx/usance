import { NextResponse } from "next/server";
import { INSTITUTIONAL_SESSION_COOKIE, cookieToken, isSameOrigin, revokeSession } from "@/lib/institutional-auth";
export const dynamic = "force-dynamic";
export async function POST(request: Request) { if (!isSameOrigin(request)) return NextResponse.json({ outcome: "ORIGIN_REJECTED" }, { status: 403 }); const token = cookieToken(request); if (token) { try { await revokeSession(token); } catch { return NextResponse.json({ outcome: "AUTH_UNAVAILABLE" }, { status: 503 }); } } const response = NextResponse.json({ loggedOut: true }); response.cookies.set(INSTITUTIONAL_SESSION_COOKIE, "", { httpOnly: true, secure: new URL(request.url).protocol === "https:", sameSite: "strict", path: "/", maxAge: 0 }); return response; }

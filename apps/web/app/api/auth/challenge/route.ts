import { NextResponse } from "next/server";
import { createChallenge, isSameOrigin } from "@/lib/institutional-auth";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ outcome: "ORIGIN_REJECTED" }, { status: 403 });
  let walletAddress: string | null = null; try { const body = await request.json() as { walletAddress?: unknown }; walletAddress = typeof body.walletAddress === "string" ? body.walletAddress : null; } catch { /* invalid JSON is handled below */ }
  if (!walletAddress) return NextResponse.json({ outcome: "BAD_REQUEST" }, { status: 400 });
  try { const { challenge, message } = await createChallenge({ walletAddress, request }); return NextResponse.json({ challengeId: challenge.id, message, expiresAt: challenge.expires_at }); } catch (error) { const invalid = error instanceof Error && error.message === "INVALID_WALLET_ADDRESS"; return NextResponse.json({ outcome: invalid ? "BAD_REQUEST" : "AUTH_UNAVAILABLE" }, { status: invalid ? 400 : 503 }); }
}

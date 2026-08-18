import { NextResponse } from "next/server";
import type { Address } from "viem";
import { loadVault, loadPosition } from "@/lib/vault";

/**
 * Position reads happen server-side so the browser talks to one origin rather than to an RPC
 * endpoint directly. The values are still read from the deployed contract — this moves where the
 * call is made, not who is authoritative.
 */
export async function GET(request: Request) {
  const account = new URL(request.url).searchParams.get("account");
  if (!account || !/^0x[0-9a-fA-F]{40}$/.test(account)) {
    return new NextResponse("account must be a 20-byte address", { status: 400 });
  }

  const [vault, position] = await Promise.all([loadVault(), loadPosition(account as Address)]);
  if (!vault || !position) return NextResponse.json(null);

  // bigints do not survive JSON. Serialised as decimal strings and parsed back with BigInt, rather
  // than as numbers, which would silently lose precision above 2^53.
  return NextResponse.json(JSON.parse(JSON.stringify({ vault, position }, (_k, v) =>
    typeof v === "bigint" ? v.toString() : v,
  )));
}

import { NextResponse } from "next/server";
import type { Address } from "viem";
import { loadAccount } from "@/lib/account";

/** Server-side so the browser talks to one origin. The chain is still authoritative. */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const account = new URL(request.url).searchParams.get("account");
  if (!account || !/^0x[0-9a-fA-F]{40}$/.test(account)) {
    return NextResponse.json({ outcome: "BAD_REQUEST", reason: "account must be a 20-byte address" }, { status: 400 });
  }

  const lookup = await loadAccount(account as Address);
  // bigints as decimal strings. Numbers lose precision above 2^53, which for usd18 is about 9
  // millionths of a dollar — small, and the kind of thing that shows up as an off-by-dust bug.
  return NextResponse.json(
    JSON.parse(JSON.stringify(lookup, (_k, v) => (typeof v === "bigint" ? v.toString() : v))),
  );
}

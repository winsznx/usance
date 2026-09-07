import { NextResponse } from "next/server";
import type { Address } from "viem";
import { loadAssetDetail } from "@/lib/asset-detail";

/** Server-side so the browser talks to one origin. The chain is still authoritative. */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const account = params.get("account");
  const assetId = params.get("assetId");
  if (!account || !/^0x[0-9a-fA-F]{40}$/.test(account)) {
    return NextResponse.json({ outcome: "BAD_REQUEST", reason: "account must be a 20-byte address" }, { status: 400 });
  }
  if (!assetId || !/^0x[0-9a-fA-F]{64}$/.test(assetId)) {
    return NextResponse.json({ outcome: "BAD_REQUEST", reason: "assetId must be a 32-byte id" }, { status: 400 });
  }

  const lookup = await loadAssetDetail(account as Address, assetId);
  return NextResponse.json(
    JSON.parse(JSON.stringify(lookup, (_k, v) => (typeof v === "bigint" ? v.toString() : v))),
  );
}

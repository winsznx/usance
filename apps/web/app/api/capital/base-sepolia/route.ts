import { NextResponse } from "next/server";
import { readBaseSepoliaFacility } from "@/lib/base-sepolia-facility";

export const dynamic = "force-dynamic";

export async function GET() {
  const result = await readBaseSepoliaFacility();
  return NextResponse.json(result, { status: result.outcome === "UNAVAILABLE" ? 503 : 200 });
}

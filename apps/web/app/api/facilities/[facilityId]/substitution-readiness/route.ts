import { NextResponse } from "next/server";
import { readSubstitutionReadiness } from "@/lib/institutional-substitution-readiness";
import { HEDERA_FACILITY } from "@/lib/institutional-proof";

export const dynamic = "force-dynamic";
export async function GET(request: Request, { params }: { params: Promise<{ facilityId: string }> }) {
  const { facilityId } = await params;
  if (facilityId.toLowerCase() !== HEDERA_FACILITY.id.toLowerCase()) return NextResponse.json({ outcome: "NOT_FOUND" }, { status: 404 });
  const url = new URL(request.url); const replacement = url.searchParams.get("replacement") ?? ""; const units = url.searchParams.get("units") ?? "0";
  if (!/^[1-9][0-9]*$/.test(units)) return NextResponse.json({ outcome: "BAD_REQUEST", reason: "units must be a positive integer" }, { status: 400 });
  return NextResponse.json(await readSubstitutionReadiness(replacement, BigInt(units)));
}

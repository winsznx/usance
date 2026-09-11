import { NextResponse } from "next/server";
import { readHederaFacility } from "@/lib/hedera-facility";
import { HEDERA_FACILITY } from "@/lib/institutional-proof";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ facilityId: string }> }) {
  const { facilityId } = await params;
  if (!/^0x[0-9a-fA-F]{64}$/.test(facilityId)) return NextResponse.json({ outcome: "BAD_REQUEST", reason: "facilityId must be a 32-byte id" }, { status: 400 });
  if (facilityId.toLowerCase() !== HEDERA_FACILITY.id.toLowerCase()) return NextResponse.json({ outcome: "NOT_FOUND" }, { status: 404 });
  const result = await readHederaFacility();
  return NextResponse.json(result, { status: result.outcome === "READY" ? 200 : 503 });
}

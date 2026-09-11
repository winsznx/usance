import { NextResponse } from "next/server";
import { findActiveSubstitutionOperation } from "@/lib/substitution-operation-store";
import { HEDERA_FACILITY } from "@/lib/institutional-proof";
import { cookieToken, isCallerAssignedToFacility, lookupSession } from "@/lib/institutional-auth";

export const dynamic = "force-dynamic";

/**
 * The one active (non-terminal) durable operation for this facility, if any. Lets a returning,
 * authenticated browser recover a durable operation across a refresh without creating a second
 * one — the DB's own one-active-per-facility constraint is the source of truth, not client state.
 */
export async function GET(request: Request, { params }: { params: Promise<{ facilityId: string }> }) {
  const { facilityId } = await params;
  if (facilityId.toLowerCase() !== HEDERA_FACILITY.id.toLowerCase()) return NextResponse.json({ outcome: "NOT_FOUND" }, { status: 404 });

  const token = cookieToken(request);
  if (!token) return NextResponse.json({ outcome: "AUTHENTICATION_REQUIRED" }, { status: 401 });
  let caller;
  try { caller = await lookupSession(token); } catch { return NextResponse.json({ outcome: "AUTH_UNAVAILABLE" }, { status: 503 }); }
  if (!caller || caller.membership_role !== "TESTNET_OPERATOR") return NextResponse.json({ outcome: "AUTHENTICATION_REQUIRED" }, { status: 401 });
  if (!isCallerAssignedToFacility(caller, facilityId)) return NextResponse.json({ outcome: "FACILITY_NOT_ASSIGNED" }, { status: 403 });

  try {
    const operation = await findActiveSubstitutionOperation(facilityId);
    return NextResponse.json(operation ? { outcome: "FOUND", operation } : { outcome: "NONE" });
  } catch {
    return NextResponse.json({ outcome: "OPERATION_STORE_UNAVAILABLE" }, { status: 503 });
  }
}

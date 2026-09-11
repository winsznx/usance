import { NextResponse } from "next/server";
import { findSubstitutionOperationByRequestId } from "@/lib/substitution-operation-store";
import { resolveAuthorityAndPrepareOrgApproval, remainingValiditySeconds, toJsonSafePreparation } from "@/lib/substitution-orchestration";
import { HEDERA_FACILITY } from "@/lib/institutional-proof";
import { cookieToken, isCallerAssignedToFacility, isSameOrigin, lookupSession } from "@/lib/institutional-auth";
import { TERMINAL_SUBSTITUTION_STATES } from "@/lib/substitution-operation";

export const dynamic = "force-dynamic";

/**
 * Re-runs authority resolution and prepares a fresh `FacilityDecision` (new nonce, new expiry)
 * under the SAME operation/requestId — an explicit new event, never a silent overwrite of the
 * prior one. No prior Privy signature exists to invalidate: none is produced before the
 * consequential-action gate, so refreshing is always safe here.
 */
export async function POST(request: Request, { params }: { params: Promise<{ facilityId: string; requestId: string }> }) {
  if (!isSameOrigin(request)) return NextResponse.json({ outcome: "ORIGIN_REJECTED" }, { status: 403 });
  const { facilityId, requestId } = await params;
  if (facilityId.toLowerCase() !== HEDERA_FACILITY.id.toLowerCase()) return NextResponse.json({ outcome: "NOT_FOUND" }, { status: 404 });
  if (!/^0x[0-9a-f]{64}$/i.test(requestId)) return NextResponse.json({ outcome: "BAD_REQUEST" }, { status: 400 });

  const token = cookieToken(request);
  if (!token) return NextResponse.json({ outcome: "AUTHENTICATION_REQUIRED" }, { status: 401 });
  let caller;
  try { caller = await lookupSession(token); } catch { return NextResponse.json({ outcome: "AUTH_UNAVAILABLE" }, { status: 503 }); }
  if (!caller || caller.membership_role !== "TESTNET_OPERATOR") return NextResponse.json({ outcome: "AUTHENTICATION_REQUIRED" }, { status: 401 });
  if (!isCallerAssignedToFacility(caller, facilityId)) return NextResponse.json({ outcome: "FACILITY_NOT_ASSIGNED" }, { status: 403 });

  let operation;
  try { operation = await findSubstitutionOperationByRequestId(requestId); }
  catch { return NextResponse.json({ outcome: "OPERATION_STORE_UNAVAILABLE" }, { status: 503 }); }
  if (!operation) return NextResponse.json({ outcome: "NOT_FOUND" }, { status: 404 });
  if (TERMINAL_SUBSTITUTION_STATES.includes(operation.state as (typeof TERMINAL_SUBSTITUTION_STATES)[number])) {
    return NextResponse.json({ outcome: "TERMINAL_OPERATION" }, { status: 409 });
  }

  const { operation: refreshed, preparation } = await resolveAuthorityAndPrepareOrgApproval(operation, "REFRESH");
  return NextResponse.json({
    outcome: "REFRESHED",
    operation: refreshed,
    preparation: preparation ? toJsonSafePreparation(preparation) : null,
    remainingValiditySeconds: preparation ? remainingValiditySeconds(preparation.decision) : null,
  });
}

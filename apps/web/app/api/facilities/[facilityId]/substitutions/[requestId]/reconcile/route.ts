import { NextResponse } from "next/server";
import { findSubstitutionOperationByRequestId, transitionDurableSubstitutionOperation } from "@/lib/substitution-operation-store";
import { reconcileSubstitutionOperation } from "@/lib/hedera-reconciliation";
import { HEDERA_FACILITY } from "@/lib/institutional-proof";
import { cookieToken, isCallerAssignedToFacility, isSameOrigin, lookupSession } from "@/lib/institutional-auth";
import { TERMINAL_SUBSTITUTION_STATES } from "@/lib/substitution-operation";

export const dynamic = "force-dynamic";

const RECONCILIATION_STATE: Record<string, string> = {
  COMMITMENT_UNKNOWN: "COMMITMENT_UNKNOWN",
  EXTERNAL_ATTEMPT_DETECTED: "COMMITMENT_UNKNOWN",
};

/**
 * Authoritative READ/reconciliation only — it never sends a transaction. Safe to call repeatedly;
 * it only ever moves the durable state toward `COMMITMENT_UNKNOWN` when the chain disagrees with
 * what this operation expects, never toward a success state (only Hedera's own state transitions,
 * observed elsewhere, can do that).
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

  const current = await reconcileSubstitutionOperation({
    requestId: requestId as `0x${string}`,
    replacement: operation.replacement_instrument_id,
    requestedUnits: BigInt(operation.requested_units),
  });

  if (TERMINAL_SUBSTITUTION_STATES.includes(operation.state as (typeof TERMINAL_SUBSTITUTION_STATES)[number])) {
    return NextResponse.json({ outcome: "RECONCILED", operation, CURRENT: current });
  }

  const nextState = RECONCILIATION_STATE[current.outcome] ?? operation.state;
  try {
    const updated = await transitionDurableSubstitutionOperation({
      operationId: operation.operation_id,
      expectedVersion: operation.version,
      nextState,
      eventType: "RECONCILED",
      payload: current,
      source: "USANCE_API",
      sourceReference: current.onChainRequestId,
    });
    return NextResponse.json({ outcome: "RECONCILED", operation: updated, CURRENT: current });
  } catch (error) {
    if ((error as Error).message === "SUBSTITUTION_OPERATION_STALE") {
      return NextResponse.json({ outcome: "RECONCILED", operation, CURRENT: current, note: "Operation advanced elsewhere between read and reconcile; re-fetch before retrying." });
    }
    return NextResponse.json({ outcome: "OPERATION_STORE_UNAVAILABLE" }, { status: 503 });
  }
}

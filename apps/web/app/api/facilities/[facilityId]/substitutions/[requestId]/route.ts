import { NextResponse } from "next/server";
import { findSubstitutionOperationByRequestId, listSubstitutionOperationEvents } from "@/lib/substitution-operation-store";
import { reconcileSubstitutionOperation } from "@/lib/hedera-reconciliation";
import { HEDERA_FACILITY } from "@/lib/institutional-proof";

export const dynamic = "force-dynamic";

/**
 * The durable orchestration view for one operation: `CURRENT` (a fresh Hedera/ATS read), `PENDING`
 * (the PostgreSQL projection and its append-only events), and `HISTORICAL_PROOF` (Phase 07
 * artifacts) are returned as separate labelled sections — never flattened into one "status".
 */
export async function GET(request: Request, { params }: { params: Promise<{ facilityId: string; requestId: string }> }) {
  const { facilityId, requestId } = await params;
  if (facilityId.toLowerCase() !== HEDERA_FACILITY.id.toLowerCase()) return NextResponse.json({ outcome: "NOT_FOUND" }, { status: 404 });
  if (!/^0x[0-9a-f]{64}$/i.test(requestId)) return NextResponse.json({ outcome: "BAD_REQUEST" }, { status: 400 });

  let operation;
  try { operation = await findSubstitutionOperationByRequestId(requestId); }
  catch { return NextResponse.json({ outcome: "OPERATION_STORE_UNAVAILABLE" }, { status: 503 }); }
  if (!operation) return NextResponse.json({ outcome: "NOT_FOUND" }, { status: 404 });

  const [events, current] = await Promise.all([
    listSubstitutionOperationEvents(operation.operation_id).catch(() => []),
    reconcileSubstitutionOperation({
      requestId: requestId as `0x${string}`,
      replacement: operation.replacement_instrument_id,
      requestedUnits: BigInt(operation.requested_units),
    }),
  ]);

  return NextResponse.json({
    outcome: "FOUND",
    PENDING: { operation, events },
    CURRENT: current,
    HISTORICAL_PROOF: {
      note: "The completed Phase 07 A->B/A->C operations are evidence of previous requests. They do not describe this operation.",
      references: ["/docs/ethonline-2026/proof/hedera-substitution-positive.json", "/docs/ethonline-2026/proof/hedera-substitution-negative.json"],
    },
  });
}

import { NextResponse } from "next/server";
import { askUsance } from "@/lib/zerog-router";
import { readHederaFacility } from "@/lib/hedera-facility";
import { HEDERA_FACILITY } from "@/lib/institutional-proof";
import { buildFacilityContext, buildReplacementContext, type ContextPacket } from "@/lib/ask-usance-context";
import { findSubstitutionOperationByRequestId, listSubstitutionOperationEvents } from "@/lib/substitution-operation-store";
import { reconcileSubstitutionOperation } from "@/lib/hedera-reconciliation";
import { buildEvidenceTimeline } from "@/lib/substitution-evidence-timeline";

export const dynamic = "force-dynamic";

const MAX_QUESTION_LENGTH = 500;

/**
 * Ask Usance — a read-only explanation endpoint over the 0G Compute Router. It never accepts an
 * arbitrary facility identifier or free-text context from the caller — the server always builds
 * its own context packet from an existing authoritative read, keyed only by the request's
 * `contextType`/`requestId`. No wallet, no signature, no write path exists anywhere in this
 * handler — it can only ever return text plus a deterministic (server-computed, never
 * model-claimed) source list and safe next actions.
 */
export async function POST(request: Request) {
  let body: { question?: unknown; contextType?: unknown; requestId?: unknown };
  try {
    body = (await request.json()) as { question?: unknown; contextType?: unknown; requestId?: unknown };
  } catch {
    return NextResponse.json({ outcome: "BAD_REQUEST", reason: "Send { question: string, contextType?: 'facility' | 'replacement', requestId?: string }." }, { status: 400 });
  }
  const question = typeof body.question === "string" ? body.question.trim() : "";
  if (!question || question.length > MAX_QUESTION_LENGTH) {
    return NextResponse.json({ outcome: "BAD_REQUEST", reason: `question must be 1-${MAX_QUESTION_LENGTH} characters.` }, { status: 400 });
  }
  const contextType = body.contextType === "replacement" ? "replacement" : "facility";
  const requestId = typeof body.requestId === "string" ? body.requestId : null;

  let packet: ContextPacket;
  if (contextType === "replacement" && requestId && /^0x[0-9a-f]{64}$/i.test(requestId)) {
    let operation;
    try { operation = await findSubstitutionOperationByRequestId(requestId); }
    catch { return NextResponse.json({ outcome: "ROUTER_UNAVAILABLE", reason: "Could not read the operation record." }, { status: 503 }); }
    if (!operation) return NextResponse.json({ outcome: "BAD_REQUEST", reason: "No operation found for that requestId." }, { status: 404 });
    const [events, current] = await Promise.all([
      listSubstitutionOperationEvents(operation.operation_id).catch(() => []),
      reconcileSubstitutionOperation({
        requestId: requestId as `0x${string}`,
        replacement: operation.replacement_instrument_id,
        requestedUnits: BigInt(operation.requested_units),
        operationAlreadyCompleted: operation.state === "COMPLETED",
      }),
    ]);
    const timeline = buildEvidenceTimeline(operation, events);
    packet = buildReplacementContext(operation, current.outcome, timeline);
  } else {
    const facility = await readHederaFacility();
    packet = buildFacilityContext(facility, HEDERA_FACILITY.id);
  }

  const result = await askUsance(question, packet.text);

  switch (result.outcome) {
    case "ANSWERED":
      return NextResponse.json({
        outcome: "ANSWERED",
        answer: result.answer,
        sources: packet.sources,
        limitations: ["Answers are grounded only in the context above; Ask Usance never invents facts not present in it.", "0G is the inference path, not proof that any financial fact is true — Usance's own evidence and contracts remain the factual basis."],
        safeNextActions: packet.safeNextActions,
        evidence: { route: result.route, model: result.model, provider: result.provider, requestId: result.requestId, createdAt: result.createdAt },
      });
    case "ROUTER_NOT_CONFIGURED":
      return NextResponse.json({ outcome: "ROUTER_NOT_CONFIGURED", reason: "Ask Usance is unavailable right now." }, { status: 503 });
    case "ROUTER_UNAVAILABLE":
      return NextResponse.json({ outcome: "ROUTER_UNAVAILABLE", reason: "Ask Usance could not reach its explanation service. Your financial state is unchanged." }, { status: 503 });
    case "MALFORMED_RESPONSE":
      return NextResponse.json({ outcome: "MALFORMED_RESPONSE", reason: "Ask Usance could not produce a reliable explanation. No action was taken." }, { status: 502 });
    case "REFUSED_FINANCIAL_REQUEST":
      return NextResponse.json({ outcome: "REFUSED_FINANCIAL_REQUEST", reason: "Ask Usance only explains current state. Usance's facility contracts are the sole financial authority; no model can borrow, withdraw, approve, sign, or change policy." }, { status: 200 });
  }
}

import { NextResponse } from "next/server";
import { askUsance } from "@/lib/zerog-router";
import { readHederaFacility } from "@/lib/hedera-facility";
import { HEDERA_FACILITY } from "@/lib/institutional-proof";

export const dynamic = "force-dynamic";

const MAX_QUESTION_LENGTH = 500;

/** Maps the current collateral adapter address to its human series label. Fails closed to
 *  "unknown" rather than guessing if the deployment ever adds a fourth adapter this doesn't know. */
function seriesLabel(adapter: string): string {
  const known: Record<string, string> = {
    "0xA73fee136aCAE887251757a474c2D89811f32adD": "A",
    "0xC5E77C98165633c1B093b8bf76d1b923856dFf42": "B",
    "0x3F131Bde9dd165C303F27801fF32828B68C73f79": "C",
  };
  return known[adapter] ?? "unknown";
}

/**
 * Ask Usance — a read-only explanation endpoint over the 0G Compute Router. It never accepts a
 * facility identifier that would let a caller pick what context to leak; it always explains this
 * one public facility's current state. No wallet, no signature, no write path exists anywhere in
 * this handler — it can only ever return text.
 */
export async function POST(request: Request) {
  let body: { question?: unknown };
  try {
    body = (await request.json()) as { question?: unknown };
  } catch {
    return NextResponse.json({ outcome: "BAD_REQUEST", reason: "Send { question: string }." }, { status: 400 });
  }
  const question = typeof body.question === "string" ? body.question.trim() : "";
  if (!question || question.length > MAX_QUESTION_LENGTH) {
    return NextResponse.json({ outcome: "BAD_REQUEST", reason: `question must be 1-${MAX_QUESTION_LENGTH} characters.` }, { status: 400 });
  }

  const facility = await readHederaFacility();
  const context =
    facility.outcome === "READY"
      ? [
          `Facility ${HEDERA_FACILITY.id} on ${HEDERA_FACILITY.homeDomain}.`,
          `Status: ${facility.facility.status}.`,
          `Outstanding: ${facility.facility.outstanding} settlement units.`,
          `Current collateral: series ${seriesLabel(facility.facility.collateral.adapter)}, adapter ${facility.facility.collateral.adapter}, committed units: ${facility.facility.collateral.committedUnits}.`,
          `Substitution state: ${facility.facility.substitution.state}.`,
          `This is Hedera testnet evidence. Test securities and test settlement; not production funds.`,
        ].join(" ")
      : `Current facility state could not be read (${facility.reason}). Say so rather than guessing.`;

  const result = await askUsance(question, context);

  switch (result.outcome) {
    case "ANSWERED":
      return NextResponse.json({ outcome: "ANSWERED", answer: result.answer, evidence: { route: result.route, model: result.model, provider: result.provider, requestId: result.requestId, createdAt: result.createdAt } });
    case "ROUTER_NOT_CONFIGURED":
      return NextResponse.json({ outcome: "ROUTER_NOT_CONFIGURED", reason: "Ask Usance is not configured in this environment." }, { status: 503 });
    case "ROUTER_UNAVAILABLE":
      return NextResponse.json({ outcome: "ROUTER_UNAVAILABLE", reason: result.reason }, { status: 503 });
    case "MALFORMED_RESPONSE":
      return NextResponse.json({ outcome: "MALFORMED_RESPONSE", reason: result.reason }, { status: 502 });
    case "REFUSED_FINANCIAL_REQUEST":
      return NextResponse.json({ outcome: "REFUSED_FINANCIAL_REQUEST", reason: "Ask Usance only explains current state. Usance's facility contracts are the sole financial authority; no model can borrow, withdraw, approve, sign, or change policy." }, { status: 200 });
  }
}

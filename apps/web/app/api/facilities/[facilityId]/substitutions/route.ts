import { NextResponse } from "next/server";
import { createDurableSubstitutionOperation } from "@/lib/substitution-operation-store";
import { readSubstitutionReadiness } from "@/lib/institutional-substitution-readiness";
import { resolveAuthorityAndPrepareOrgApproval, toJsonSafePreparation } from "@/lib/substitution-orchestration";
import { HEDERA_FACILITY } from "@/lib/institutional-proof";
import { cookieToken, isCallerAssignedToFacility, isSameOrigin, lookupSession } from "@/lib/institutional-auth";

export const dynamic = "force-dynamic";

/**
 * Creates a durable, authenticated `SubstitutionOperation` and runs the one automatic,
 * non-financial preparation step: resolve current ENS authority and, if valid, compute the exact
 * digest a Privy quorum approval would bind. No Hedera, ATS, Privy, or CRE mutation occurs here.
 */
export async function POST(request: Request, { params }: { params: Promise<{ facilityId: string }> }) {
  if (!isSameOrigin(request)) return NextResponse.json({ outcome: "ORIGIN_REJECTED" }, { status: 403 });
  if (process.env.INSTITUTIONAL_OPERATION_CREATION_ENABLED !== "true") {
    return NextResponse.json({ outcome: "OPERATION_CREATION_DISABLED", reason: "Institutional caller authentication is required before operation creation is enabled." }, { status: 503 });
  }
  const token = cookieToken(request);
  if (!token) return NextResponse.json({ outcome: "AUTHENTICATION_REQUIRED" }, { status: 401 });
  let caller;
  try { caller = await lookupSession(token); } catch { return NextResponse.json({ outcome: "AUTH_UNAVAILABLE" }, { status: 503 }); }
  if (!caller || caller.membership_role !== "TESTNET_OPERATOR") return NextResponse.json({ outcome: "AUTHENTICATION_REQUIRED" }, { status: 401 });

  const { facilityId } = await params;
  if (facilityId.toLowerCase() !== HEDERA_FACILITY.id.toLowerCase()) return NextResponse.json({ outcome: "NOT_FOUND" }, { status: 404 });
  // Facility assignment is derived from server-side configuration, never the caller's own claim.
  if (!isCallerAssignedToFacility(caller, facilityId)) return NextResponse.json({ outcome: "FACILITY_NOT_ASSIGNED" }, { status: 403 });

  let body: { replacement?: unknown; units?: unknown; requestId?: unknown };
  try { body = (await request.json()) as { replacement?: unknown; units?: unknown; requestId?: unknown }; }
  catch { return NextResponse.json({ outcome: "BAD_REQUEST", reason: "Send a JSON substitution request." }, { status: 400 }); }
  const replacement = typeof body.replacement === "string" ? body.replacement : "";
  const units = typeof body.units === "string" ? body.units : "";
  const requestId = typeof body.requestId === "string" ? body.requestId.toLowerCase() : "";
  if (!/^[1-9][0-9]*$/.test(units) || !/^0x[0-9a-f]{64}$/.test(requestId)) {
    return NextResponse.json({ outcome: "BAD_REQUEST", reason: "requestId must be a 32-byte hex value and units a positive integer." }, { status: 400 });
  }

  const readiness = await readSubstitutionReadiness(replacement, BigInt(units));
  if (readiness.outcome === "FACILITY_UNAVAILABLE") return NextResponse.json(readiness, { status: 503 });

  const actor = { walletAddress: caller.wallet_address, organizationSlug: caller.organization_slug, role: caller.membership_role, sessionId: caller.session_id };
  try {
    const created = await createDurableSubstitutionOperation({
      operationId: crypto.randomUUID(), requestId, facilityId: readiness.facilityId, homeDomain: readiness.homeDomain,
      oldInstrumentId: readiness.current.collateralAssetId, replacementInstrumentId: replacement, requestedUnits: units, state: "CREATED",
    });
    // Idempotent create: a repeated call with the same requestId returns the existing operation
    // unchanged rather than re-running preparation from a stale readiness snapshot.
    const existing = created.state !== "CREATED" ? created : null;
    const { operation, preparation } = existing
      ? { operation: existing, preparation: null }
      : await resolveAuthorityAndPrepareOrgApproval(created);
    return NextResponse.json(
      { outcome: "CREATED", operation, preparation: preparation ? toJsonSafePreparation(preparation) : null, readiness, actor },
      { status: 201 },
    );
  } catch (error) {
    if ((error as Error).message === "SUBSTITUTION_STORE_UNAVAILABLE") {
      return NextResponse.json({ outcome: "OPERATION_STORE_UNAVAILABLE", reason: "No substitution operation was created and no financial action was submitted." }, { status: 503 });
    }
    return NextResponse.json({ outcome: "OPERATION_STORE_UNAVAILABLE", reason: "No financial action was submitted." }, { status: 503 });
  }
}

import type { CreateSubstitutionOperation } from "./substitution-operation";

export type SupabaseOperation = {
  operation_id: string; request_id: string; facility_id: string; home_domain: string;
  old_instrument_id: string; replacement_instrument_id: string; requested_units: string;
  state: string; version: number; created_at: string; updated_at: string; completed_at: string | null;
};
export type SupabaseOperationEvent = {
  event_id: string; operation_id: string; sequence: number; event_type: string;
  payload: Record<string, unknown>; source: string; source_reference: string | null; created_at: string;
};

function dbConfig(): { base: string; key: string } {
  const base = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key) throw new Error("SUBSTITUTION_STORE_UNAVAILABLE");
  return { base, key };
}

/** Cloudflare-safe Postgres transport. The SQL function supplies the transaction and constraints. */
export async function createDurableSubstitutionOperation(input: CreateSubstitutionOperation) {
  const { base, key } = dbConfig();
  const response = await fetch(`${base}/rest/v1/rpc/create_substitution_operation`, {
    method: "POST", headers: { "content-type": "application/json", apikey: key, authorization: `Bearer ${key}` },
    body: JSON.stringify({ p_operation_id: input.operationId, p_request_id: input.requestId, p_facility_id: input.facilityId, p_home_domain: input.homeDomain, p_old_instrument_id: input.oldInstrumentId, p_replacement_instrument_id: input.replacementInstrumentId, p_requested_units: input.requestedUnits, p_state: input.state, p_payload: { requestId: input.requestId, schemaVersion: 1 } }),
  });
  if (!response.ok) throw new Error("SUBSTITUTION_STORE_UNAVAILABLE");
  return await response.json() as SupabaseOperation;
}

/** Uses PostgreSQL row locking and an expected version; callers must reconcile before retrying a stale transition. */
export async function transitionDurableSubstitutionOperation(input: { operationId: string; expectedVersion: number; nextState: string; eventType: string; payload: Record<string, unknown>; source: string; sourceReference?: string; outboxEventType?: string }) {
  const { base, key } = dbConfig();
  const response = await fetch(`${base}/rest/v1/rpc/transition_substitution_operation`, { method: "POST", headers: { "content-type": "application/json", apikey: key, authorization: `Bearer ${key}` }, body: JSON.stringify({ p_operation_id: input.operationId, p_expected_version: input.expectedVersion, p_next_state: input.nextState, p_event_type: input.eventType, p_payload: input.payload, p_source: input.source, p_source_reference: input.sourceReference ?? null, p_outbox_event_type: input.outboxEventType ?? null }) });
  if (!response.ok) throw new Error(response.status === 409 ? "SUBSTITUTION_OPERATION_STALE" : "SUBSTITUTION_STORE_UNAVAILABLE");
  return await response.json() as SupabaseOperation;
}

const TERMINAL_STATES = ["COMPLETED", "REFUSED", "EXPIRED", "CANCELLED"];

/** The one active (non-terminal) operation for a facility, if any — the DB's own invariant. */
export async function findActiveSubstitutionOperation(facilityId: string): Promise<SupabaseOperation | null> {
  const { base, key } = dbConfig();
  const notIn = `(${TERMINAL_STATES.join(",")})`;
  const response = await fetch(
    `${base}/rest/v1/substitution_operations?facility_id=eq.${encodeURIComponent(facilityId.toLowerCase())}&state=not.in.${encodeURIComponent(notIn)}&select=*&limit=1`,
    { headers: { apikey: key, authorization: `Bearer ${key}` } },
  );
  if (!response.ok) throw new Error("SUBSTITUTION_STORE_UNAVAILABLE");
  const rows = (await response.json()) as SupabaseOperation[];
  return rows[0] ?? null;
}

/** The most recently created operation for a facility regardless of state — used only to let a
 *  returning browser view its own completed/blocked receipt after the active operation reaches a
 *  terminal state. Never used to decide whether a NEW request may be created; that remains
 *  `findActiveSubstitutionOperation`'s exclusive job. */
export async function findMostRecentSubstitutionOperation(facilityId: string): Promise<SupabaseOperation | null> {
  const { base, key } = dbConfig();
  const response = await fetch(
    `${base}/rest/v1/substitution_operations?facility_id=eq.${encodeURIComponent(facilityId.toLowerCase())}&select=*&order=created_at.desc&limit=1`,
    { headers: { apikey: key, authorization: `Bearer ${key}` } },
  );
  if (!response.ok) throw new Error("SUBSTITUTION_STORE_UNAVAILABLE");
  const rows = (await response.json()) as SupabaseOperation[];
  return rows[0] ?? null;
}

/** Read-only lookup by `requestId` — the canonical external identity for one economic intent. */
export async function findSubstitutionOperationByRequestId(requestId: string): Promise<SupabaseOperation | null> {
  const { base, key } = dbConfig();
  const response = await fetch(`${base}/rest/v1/substitution_operations?request_id=eq.${encodeURIComponent(requestId.toLowerCase())}&select=*`, {
    headers: { apikey: key, authorization: `Bearer ${key}` },
  });
  if (!response.ok) throw new Error("SUBSTITUTION_STORE_UNAVAILABLE");
  const rows = (await response.json()) as SupabaseOperation[];
  return rows[0] ?? null;
}

/** The append-only audit trail for one operation, in sequence order. */
export async function listSubstitutionOperationEvents(operationId: string): Promise<SupabaseOperationEvent[]> {
  const { base, key } = dbConfig();
  const response = await fetch(
    `${base}/rest/v1/substitution_operation_events?operation_id=eq.${encodeURIComponent(operationId)}&select=*&order=sequence.asc`,
    { headers: { apikey: key, authorization: `Bearer ${key}` } },
  );
  if (!response.ok) throw new Error("SUBSTITUTION_STORE_UNAVAILABLE");
  return (await response.json()) as SupabaseOperationEvent[];
}

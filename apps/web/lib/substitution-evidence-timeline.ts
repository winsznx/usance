import type { SupabaseOperation } from "./substitution-operation-store";

/**
 * Every timeline item must say where it came from. The durable Postgres event log is honest but
 * partial — several live steps in the canonical Phase 11 proof ran through standalone operator
 * scripts and were never written through the orchestration transition path. Rather than
 * backfilling synthetic `substitution_operation_events` rows to make the log look complete (which
 * would misrepresent what the database actually recorded), a timeline item sourced from the
 * on-chain record or the written proof manifest carries its own provenance tag instead of
 * pretending to be a `DURABLE_EVENT`.
 */
export type EvidenceProvenance = "DURABLE_EVENT" | "ONCHAIN_EVIDENCE" | "PROOF_MANIFEST" | "CURRENT_STATE";

export type TimelineItem = {
  provenance: EvidenceProvenance;
  title: string;
  detail?: string;
  /** ISO timestamp when known precisely (durable events); omitted when the proof manifest only
   *  establishes relative order, not an exact time this reader can vouch for. */
  timestamp: string | null;
  txHash?: string;
  network?: "hedera-testnet" | "sepolia";
};

const DURABLE_EVENT_LABELS: Record<string, string> = {
  OPERATION_CREATED: "Substitution request created",
  AUTHORITY_RESOLVING_STARTED: "Resolving organization authority",
  AUTHORITY_VALID: "Organization authority resolved",
  AUTHORITY_REQUIRED: "Organization authority not configured",
  AUTHORITY_REVOKED: "Organization authority revoked",
  AUTHORITY_UNAVAILABLE: "Organization authority unavailable",
  ORG_APPROVAL_PENDING: "Awaiting organization approval",
  ORG_APPROVED: "Organization approval recorded",
  AUTHORITY_APPROVED_ONCHAIN: "Organization approval recorded on Hedera",
  DECISION_REFRESHED: "Approval package refreshed",
  POLICY_APPROVED_ONCHAIN: "Lender policy verdict recorded on Hedera",
  SUBSTITUTION_REQUESTED: "Replacement collateral requested",
  REPLACEMENT_COMMITTED: "Replacement collateral secured",
  RELEASE_BLOCKED: "Release paused: settlement valuation was stale",
  RELEASE_BLOCKED_REPLACEMENT_PRICE_STALE: "Release paused: replacement valuation was stale",
  RECONCILED: "Reconciled against current facility state",
  COMPLETED: "Collateral replacement completed",
};

/**
 * The live execution steps that ran outside the orchestration transition path for the canonical
 * proof operation, keyed by requestId. Empty for any other operation — this module never
 * fabricates evidence for an operation it has no written proof for. Sourced from
 * `docs/phase-11/PHASE_11_SUBSTITUTION_PROOF.md`; kept here as a small typed mapping rather than
 * parsing that markdown at runtime.
 */
const PROOF_MANIFEST_STEPS: Record<string, TimelineItem[]> = {
  "0xb1d927f704bd47533a34d800609827fec3ad95c94620b2843e35ac4a67809526": [
    { provenance: "ONCHAIN_EVIDENCE", title: "One recovery transaction reverted because its gas limit was insufficient", detail: "No partial state change occurred — confirmed via the Hedera mirror node's transaction trace.", timestamp: null, txHash: "0x76efa45503611713546523ed66117a30bc70c4fd29355133a2f3ee5342e84e98", network: "hedera-testnet" },
    { provenance: "ONCHAIN_EVIDENCE", title: "Recovery completed with a corrected gas limit", timestamp: null, txHash: "0xca010e03741ab9cb51a5bb95ee21d3382be2f1834efd309f50fe3f48c42a73c9", network: "hedera-testnet" },
    { provenance: "ONCHAIN_EVIDENCE", title: "Settlement valuation freshness restored", detail: "Test-fixture price value unchanged; only its observation timestamp was refreshed.", timestamp: null, txHash: "0x50aa4c99f9ec8933c76fdfe2c40f3158c3a51b9f6c6f897b782a0113074b5c3d", network: "hedera-testnet" },
    { provenance: "ONCHAIN_EVIDENCE", title: "Organization approval recorded on Hedera (refreshed package)", timestamp: null, txHash: "0xd8d7a20e2ff46cf5590aa1abcd60e9e49c6190a912912058a9b839e677f00a29", network: "hedera-testnet" },
    { provenance: "ONCHAIN_EVIDENCE", title: "Lender policy verdict recorded on Hedera (refreshed package)", timestamp: null, txHash: "0xd2ad97c71b1a9b42da75907afe67c0559cb4a1df98aa53ae99d86433d8bf3e76", network: "hedera-testnet" },
    { provenance: "ONCHAIN_EVIDENCE", title: "Replacement collateral requested again", timestamp: null, txHash: "0x9efa559e54ab0d7378092eee483e5412432d7f1a94180e85b534e89f1926dce4", network: "hedera-testnet" },
    { provenance: "ONCHAIN_EVIDENCE", title: "Replacement collateral secured again", timestamp: null, txHash: "0x2cd4a70ab2c40caf22ba73a10d9ca1ae16d87973d5ed6293f96a03a145f1b85d", network: "hedera-testnet" },
    { provenance: "ONCHAIN_EVIDENCE", title: "Replacement valuation freshness restored", detail: "Test-fixture price value unchanged; only its observation timestamp was refreshed.", timestamp: null, txHash: "0xa1209b13e7262d223631a26874d94e36205333288fb3059a991a7486cc698f87", network: "hedera-testnet" },
    { provenance: "ONCHAIN_EVIDENCE", title: "Existing collateral released", timestamp: null, txHash: "0x37924db3ee4c712e7f2cd3a5c00200703f243a7e63f12b655e06f4fd018f55da", network: "hedera-testnet" },
  ],
};

/**
 * Composes the durable event log (chronological, exact timestamps) with any independently
 * referenced on-chain/proof-manifest evidence for the same operation, and the current live read.
 * Durable events are never reordered or dropped; manifest items are appended in their documented
 * order but carry no timestamp this reader can vouch for, since they were not observed through the
 * transition path that assigns one.
 */
export function buildEvidenceTimeline(
  operation: Pick<SupabaseOperation, "request_id" | "state">,
  events: Array<{ event_type: string; created_at: string | null }>,
): TimelineItem[] {
  const durable: TimelineItem[] = events.map((e) => ({
    provenance: "DURABLE_EVENT",
    title: DURABLE_EVENT_LABELS[e.event_type] ?? e.event_type.replace(/_/g, " ").toLowerCase(),
    timestamp: e.created_at,
  }));
  const manifest = PROOF_MANIFEST_STEPS[operation.request_id.toLowerCase()] ?? [];
  if (manifest.length === 0) return durable;

  // The proof-manifest steps document a gap in the durable log between the first settlement-price
  // release block and the later replacement-price release block. They are inserted there, in their
  // documented order, rather than appended at the end where they would misrepresent chronology.
  const gapIndex = durable.findIndex((item) => item.title === DURABLE_EVENT_LABELS.RELEASE_BLOCKED);
  if (gapIndex === -1) return [...durable, ...manifest];
  return [...durable.slice(0, gapIndex + 1), ...manifest, ...durable.slice(gapIndex + 1)];
}

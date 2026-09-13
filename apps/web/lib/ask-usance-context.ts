import type { HederaFacilityRead } from "./hedera-facility";
import type { TimelineItem } from "./substitution-evidence-timeline";

export type AskUsanceContextType = "facility" | "replacement";

export type AskUsanceSource = "Current state" | "Receipt" | "Policy evidence" | "Authority evidence" | "Asset evidence" | "Onchain transaction";

export type SafeNextAction = { label: string; href: string };

export type ContextPacket = { text: string; sources: AskUsanceSource[]; safeNextActions: SafeNextAction[] };

const KNOWN_ADAPTER_SERIES: Record<string, string> = {
  "0xA73fee136aCAE887251757a474c2D89811f32adD": "A",
  "0xC5E77C98165633c1B093b8bf76d1b923856dFf42": "B",
  "0x3F131Bde9dd165C303F27801fF32828B68C73f79": "C",
};
function seriesLabel(adapter: string): string {
  return KNOWN_ADAPTER_SERIES[adapter] ?? "unknown";
}

/** Only the fields a facility question needs — never the full read model, never anything the
 *  facility itself wouldn't already show publicly. */
export function buildFacilityContext(facility: HederaFacilityRead, facilityId: string): ContextPacket {
  if (facility.outcome !== "READY") {
    return {
      text: `Current facility state could not be read (${facility.reason}). Say so rather than guessing.`,
      sources: ["Current state"],
      safeNextActions: [{ label: "Refresh state", href: `/institutional/facilities/${facilityId}` }],
    };
  }
  const text = [
    `Facility ${facilityId} on Hedera testnet.`,
    `Status: ${facility.facility.status}.`,
    `Outstanding financing: ${facility.facility.outstanding} settlement units.`,
    `Current collateral: series ${seriesLabel(facility.facility.collateral.adapter)}, committed units: ${facility.facility.collateral.committedUnits}.`,
    `Substitution state: ${facility.facility.substitution.state}.`,
    `This is Hedera testnet evidence. Test securities and test settlement; not production funds.`,
  ].join(" ");
  return {
    text,
    sources: ["Current state"],
    safeNextActions: [
      { label: "Go to facility", href: `/institutional/facilities/${facilityId}` },
      { label: "Refresh state", href: `/institutional/facilities/${facilityId}` },
    ],
  };
}

const TIMELINE_LABEL_TO_SOURCE: Array<[RegExp, AskUsanceSource]> = [
  [/organization approval|authority/i, "Authority evidence"],
  [/lender policy|policy verdict|policy was stale/i, "Policy evidence"],
  [/released|secured|committed|requested/i, "Onchain transaction"],
];

/** The replacement-operation context packet: durable operation state, the read-only reconciliation
 *  against current chain state, and the evidence timeline — never the raw event payloads (those can
 *  carry internal source/reference fields not meant for an external explanation). */
export function buildReplacementContext(
  operation: { state: string; request_id: string; replacement_instrument_id?: string; requested_units?: string | number },
  currentOutcome: string,
  timeline: TimelineItem[],
): ContextPacket {
  const safetyEvents = timeline.filter((t) => /paused|reverted/i.test(t.title));
  const lines = [
    `Substitution operation ${operation.request_id}, durable state: ${operation.state}.`,
    `Current authoritative chain reconciliation: ${currentOutcome}.`,
    `Replacement target: series ${operation.replacement_instrument_id ?? "unknown"}, requested units: ${operation.requested_units ?? "unknown"}.`,
    safetyEvents.length > 0
      ? `Safety events in this operation's history: ${safetyEvents.map((e) => e.title).join("; ")}. Existing collateral remained secured through each of these — they are safety controls working as intended, not failures.`
      : `No safety events were recorded for this operation.`,
    `This is Hedera testnet evidence. Test securities and test settlement; not production funds.`,
  ];
  const sources = new Set<AskUsanceSource>(["Current state", "Receipt"]);
  for (const item of timeline) {
    for (const [pattern, source] of TIMELINE_LABEL_TO_SOURCE) {
      if (pattern.test(item.title)) sources.add(source);
    }
  }
  return {
    text: lines.join(" "),
    sources: Array.from(sources),
    safeNextActions: [{ label: "Open evidence", href: "#evidence-timeline" }],
  };
}

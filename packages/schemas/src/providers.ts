import type { CanonicalDocument, ClaimSet, Corroboration, Extraction, Observation, ObservationQuery } from "./evidence";

/**
 * The provider interfaces, frozen in `spec/interfaces.md §7`.
 *
 * No external SDK type appears in any of these signatures. That is the rule that keeps a vendor
 * change from becoming a domain change, and it is why ChainGPT is one implementation of
 * `EvidenceExtractor` rather than a name that appears anywhere in the pipeline.
 */

export interface EvidenceExtractor {
  readonly id: string;
  /**
   * Extractors sharing a group cannot corroborate each other. Two prompts against one model are
   * one path wearing two hats, and counting them as two defeats the entire corroboration rule.
   */
  readonly independenceGroup: string;
  extract(input: CanonicalDocument, signal?: AbortSignal): Promise<Extraction>;
}

export interface EvidenceCorroborator {
  compare(claims: readonly ClaimSet[], signal?: AbortSignal): Promise<Corroboration>;
}

export interface ObservationProvider {
  poll(query: ObservationQuery, signal?: AbortSignal): Promise<readonly Observation[]>;
}

export type ProviderStatus = "available" | "access_required" | "not_available";

/** Every provider must be able to say whether it can actually run, without being called. */
export interface ProviderAvailability {
  readonly name: string;
  status(): ProviderStatus;
}

/**
 * Thrown when a provider cannot run.
 *
 * Distinct from a failed call on purpose. "No credential configured" and "the model returned
 * something unusable" need different handling, and collapsing them is how a missing key turns into
 * a silently degraded pipeline.
 */
export class ProviderUnavailable extends Error {
  constructor(
    readonly provider: string,
    readonly providerStatus: Exclude<ProviderStatus, "available">,
    message: string,
  ) {
    super(message);
    this.name = "ProviderUnavailable";
  }
}

/** Thrown when a provider ran but returned something that failed schema validation. */
export class ProviderOutputRejected extends Error {
  constructor(
    readonly provider: string,
    readonly detail: string,
  ) {
    super(`${provider} returned output that failed validation: ${detail}`);
    this.name = "ProviderOutputRejected";
  }
}

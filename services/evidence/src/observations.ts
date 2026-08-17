import { isLowTrust, sourceClassName, type Hex32, type Observation, type UnixSeconds } from "@usance/schemas";

/**
 * The low-trust channel: what an observation is allowed to cause.
 *
 * `spec/evidence-model.md §9` gives an observation exactly three permitted effects — trigger a re-fetch
 * of a stronger source, open an operational alert, or prompt a guardian (a human key) to restrict — and
 * four prohibitions: it may not be an input to `commitPassport`, may not supersede any evidence, may
 * not change a risk parameter, and may not raise a limit under any circumstances.
 *
 * The asymmetry is the entire design. A poisoned news feed can make Usance more cautious about an
 * asset. It cannot make Usance lend more against one.
 *
 * That is enforced structurally rather than by review, in three places:
 *
 *  - `ReviewAction.action` is a union of two restrictive verbs. There is no member that widens
 *    anything, so there is no value this module can return that a downstream consumer could read as
 *    permission.
 *  - Nothing here produces an `EvidenceClaim`, a `ClaimSet` or a `PassportCandidate`. The types do not
 *    appear in this file, so there is no code path from an observation into the Passport builder.
 *  - `ingest` refuses a low-trust `sourceClass` outright, so an observation cannot enter the
 *    claim-bearing pipeline by being re-labelled as a document either.
 */

export type ReviewActionKind =
  /** An asset's evidence should be looked at by a human. Blocks nothing on its own. */
  | "REVIEW_REQUIRED"
  /** Re-fetch and re-extract the authoritative source. The refresh is what may change a claim; the
   *  observation never is. */
  | "PASSPORT_REFRESH";

export interface ReviewAction {
  readonly action: ReviewActionKind;
  readonly observationId: string;
  readonly headline: string;
  readonly uri: string;
  readonly observedAt: UnixSeconds;
  /** Which assets an operator should look at. Supplied by the caller from a verified watchlist. */
  readonly assetIds: readonly Hex32[];
  readonly reason: string;
}

export class ObservationNotLowTrust extends Error {
  constructor(readonly observationId: string, readonly sourceClass: number) {
    super(
      `observation ${observationId} carries sourceClass ${sourceClass} ` +
        `(${sourceClassName(sourceClass as never)}), which is not a low-trust class. ` +
        "An observation is never promoted to a claim; a document of that class must go through ingest.",
    );
    this.name = "ObservationNotLowTrust";
  }
}

/**
 * Phrases that make an observation worth a re-read of the authoritative source rather than just an
 * alert.
 *
 * A keyword list is a triage heuristic and nothing more. It cannot be wrong in a way that matters:
 * both outcomes are restrictive, so a false positive costs a re-fetch and a false negative costs an
 * alert that a human still sees. Nothing here decides a number.
 */
const REFRESH_TRIGGERS: readonly RegExp[] = [
  /\bredemption/i,
  /\bredeem/i,
  /\bsuspend/i,
  /\bhalt/i,
  /\bgate[sd]?\b/i,
  /\bdefault/i,
  /\bdelist/i,
  /\bprospectus/i,
  /\bregulat/i,
  /\bwind[- ]?down/i,
  /\bliquidat/i,
  /\bissuer/i,
  /\bcustodian/i,
  /\bdepeg/i,
];

export interface ReviewOptions {
  /**
   * Assets the operator has already associated with this feed.
   *
   * Passed in rather than read off the observation because mapping a headline to an asset is an
   * inference, and an inference made here would be indistinguishable downstream from a verified
   * association. `ChainGptNewsObservations` returns an empty `assetIds` for the same reason.
   */
  readonly watchedAssetIds: readonly Hex32[];
}

/**
 * Turn observations into review actions.
 *
 * Every returned action is restrictive or neutral. There is no branch, no option and no configuration
 * that produces anything else.
 */
export function reviewActionsFor(
  observations: readonly Observation[],
  opts: ReviewOptions,
): readonly ReviewAction[] {
  const out: ReviewAction[] = [];
  for (const o of observations) {
    // Asserted rather than assumed. This is the single most likely place for a future change to
    // quietly promote a rumour into evidence, so the guarantee is checked at runtime as well as typed.
    if (!isLowTrust(o.sourceClass)) throw new ObservationNotLowTrust(o.observationId, o.sourceClass);

    const trigger = REFRESH_TRIGGERS.find((p) => p.test(o.headline));
    out.push({
      action: trigger ? "PASSPORT_REFRESH" : "REVIEW_REQUIRED",
      observationId: o.observationId,
      headline: o.headline,
      uri: o.uri,
      observedAt: o.observedAt,
      assetIds: opts.watchedAssetIds,
      reason: trigger
        ? `headline matched ${String(trigger)}; re-read the authoritative source. The re-read may ` +
          "change a claim. This observation cannot."
        : "low-trust observation recorded for human review; it changes no claim and no limit",
    });
  }
  return out;
}

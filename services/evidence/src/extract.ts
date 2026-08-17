import {
  extractionSchema,
  ProviderOutputRejected,
  ProviderUnavailable,
  UNKNOWN,
  type CanonicalDocument,
  type ClaimSet,
  type EvidenceExtractor,
  type Extraction,
} from "@usance/schemas";

/**
 * The `EXTRACTED → VALIDATED | SCHEMA_INVALID` span of `spec/evidence-model.md §2`.
 *
 * Every extractor is treated as hostile, including the deterministic one. Not because a regex is
 * likely to lie, but because "this path is trustworthy so its output need not be checked" is how the
 * checks end up applying only to the path that happens to be easiest to distrust today.
 *
 * `SCHEMA_INVALID` discards the extraction whole. An extraction that fails validation is not a
 * smaller extraction, it is no extraction, and the asset keeps whatever Passport it already had.
 */

/**
 * Field names a claim may never carry, whatever produced it.
 *
 * This is belt-and-braces over `FIELD_KINDS` in the ChainGPT extractor, which already drops
 * out-of-scope fields. The reason to check again here is that this stage is where *any* extractor's
 * output arrives, including one written next year by someone who did not read
 * `spec/evidence-model.md §7`. A claim named `riskPolicy.maxLtvBps` has no consumer downstream and
 * could not move a limit if it did, so this rejection is not the safety property — it is the tripwire
 * that makes an attempt visible instead of silent.
 */
const RISK_PARAMETER_PATTERN =
  /ltv|haircut|riskpolicy|risk_policy|liquidationthreshold|borrowlimit|creditlimit|collateralfactor|maxconcentration|exitcurve|recoverybps/i;

export class RiskParameterFieldRejected extends Error {
  constructor(
    readonly extractor: string,
    readonly field: string,
  ) {
    super(
      `extractor ${extractor} emitted the field "${field}", which names a risk parameter. ` +
        "Risk parameters are written by GOVERNANCE through RiskPolicyRegistry and by nothing else. " +
        "The extraction is discarded.",
    );
    this.name = "RiskParameterFieldRejected";
  }
}

export class ExtractionSchemaInvalid extends Error {
  constructor(
    readonly extractor: string,
    readonly detail: string,
  ) {
    super(`extraction from ${extractor} failed validation: ${detail}`);
    this.name = "ExtractionSchemaInvalid";
  }
}

export class NoExtractionPathAvailable extends Error {
  constructor(readonly reasons: readonly string[]) {
    super(
      `no extraction path produced a result: ${reasons.join(" | ")}. ` +
        "Nothing is fabricated to fill the gap, so the Passport does not move.",
    );
    this.name = "NoExtractionPathAvailable";
  }
}

/** Why a path is missing from the result. Kept apart because they need different operator responses. */
export type PathFailureKind = "UNAVAILABLE" | "OUTPUT_REJECTED" | "FAILED";

export interface PathFailure {
  readonly extractor: string;
  readonly independenceGroup: string;
  readonly kind: PathFailureKind;
  readonly reason: string;
}

export interface ExtractionOutcome {
  readonly claimSets: readonly ClaimSet[];
  readonly extractions: readonly Extraction[];
  readonly failures: readonly PathFailure[];
  /** Distinct `independenceGroup` values that returned a validated extraction. */
  readonly independentPathCount: number;
}

/**
 * Validate one extraction against the document it claims to be about.
 *
 * The provenance check is the part worth reading. An extractor supplies `evidenceId`, `sourceClass`
 * and both timestamps on every claim, and every one of those is already known from the hashed
 * document. Comparing rather than trusting closes the promotion path: an extractor that could report
 * a `sourceClass` of its own choosing could promote its own guess to `ISSUER_SIGNED`.
 */
export function validateExtraction(
  doc: CanonicalDocument,
  extraction: Extraction,
  independenceGroup: string,
): ClaimSet {
  const parsed = extractionSchema.safeParse(extraction);
  if (!parsed.success) {
    throw new ExtractionSchemaInvalid(
      extraction.extractor,
      parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
    );
  }
  const e = parsed.data;

  if (e.documentEvidenceId !== doc.evidenceId) {
    throw new ExtractionSchemaInvalid(
      e.extractor,
      `documentEvidenceId ${e.documentEvidenceId} is not the document's ${doc.evidenceId}`,
    );
  }

  for (const c of e.claims) {
    if (RISK_PARAMETER_PATTERN.test(c.field)) throw new RiskParameterFieldRejected(e.extractor, c.field);
    if (c.evidenceId !== doc.evidenceId) {
      throw new ExtractionSchemaInvalid(e.extractor, `claim ${c.field} cites evidence ${c.evidenceId}`);
    }
    if (c.sourceClass !== doc.sourceClass) {
      throw new ExtractionSchemaInvalid(
        e.extractor,
        `claim ${c.field} asserts sourceClass ${c.sourceClass}, document is ${doc.sourceClass}`,
      );
    }
    if (c.retrievedAt !== doc.retrievedAt || c.effectiveAt !== doc.effectiveAt) {
      throw new ExtractionSchemaInvalid(e.extractor, `claim ${c.field} restates timestamps incorrectly`);
    }
  }

  return { extractor: e.extractor, independenceGroup, claims: e.claims };
}

/**
 * Run every extractor over one document.
 *
 * A path that cannot run is recorded and skipped, never substituted. `ProviderUnavailable` (no
 * credential) and `ProviderOutputRejected` (ran, returned nonsense) are kept distinct because
 * collapsing them is how a missing key turns into a silently degraded pipeline: the first is a
 * configuration fact an operator can fix, the second is a provider defect.
 *
 * Losing the model path leaves one path, which corroboration reports as `SINGLE_SOURCE` and policy
 * caps. That is a real, honest degradation. The alternative — synthesising a second opinion so the
 * count reaches two — would make `CORROBORATED` mean nothing at all.
 */
export async function runExtractors(
  doc: CanonicalDocument,
  extractors: readonly EvidenceExtractor[],
  signal?: AbortSignal,
): Promise<ExtractionOutcome> {
  const claimSets: ClaimSet[] = [];
  const extractions: Extraction[] = [];
  const failures: PathFailure[] = [];

  // Sequential rather than concurrent. The model path is rate-limited upstream and the deterministic
  // path costs microseconds, so parallelism buys nothing and would make the failure order in
  // `failures` depend on scheduling, which a fixture test then cannot pin.
  for (const x of extractors) {
    try {
      const extraction = await x.extract(doc, signal);
      claimSets.push(validateExtraction(doc, extraction, x.independenceGroup));
      extractions.push(extraction);
    } catch (e) {
      failures.push({
        extractor: x.id,
        independenceGroup: x.independenceGroup,
        kind: classify(e),
        reason: e instanceof Error ? e.message : String(e),
      });
    }
  }

  if (claimSets.length === 0) throw new NoExtractionPathAvailable(failures.map((f) => `${f.extractor}: ${f.reason}`));

  return {
    claimSets,
    extractions,
    failures,
    independentPathCount: new Set(claimSets.map((s) => s.independenceGroup)).size,
  };
}

function classify(e: unknown): PathFailureKind {
  if (e instanceof ProviderUnavailable) return "UNAVAILABLE";
  if (e instanceof ProviderOutputRejected) return "OUTPUT_REJECTED";
  if (e instanceof ExtractionSchemaInvalid || e instanceof RiskParameterFieldRejected) return "OUTPUT_REJECTED";
  return "FAILED";
}

/** Whether a claim set said anything at all. Used to report a document that answered no question. */
export function hasAnyValue(set: ClaimSet): boolean {
  return set.claims.some((c) => c.value !== UNKNOWN);
}

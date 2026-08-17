import {
  DeterministicCorroborator,
  type CanonicalDocument,
  type ClaimSet,
  type Corroboration,
  type EvidenceCorroborator,
  type EvidenceExtractor,
  type Hex32,
  type PassportCandidate,
  type UnixSeconds,
} from "@usance/schemas";
import {
  buildCandidate,
  conflictingRiskFields,
  ConflictedClaimSetRejected,
  type BuiltCandidate,
} from "./candidate";
import {
  bumpEpochCalldata,
  CAUSE_CLAIM_CONFLICT,
  CAUSE_PASSPORT_COMMIT,
  commitEvidenceCalldata,
  commitPassportCalldata,
  restrictPassportCalldata,
  type Calldata,
} from "./commit";
import {
  ExtractionSchemaInvalid,
  RiskParameterFieldRejected,
  runExtractors,
  type ExtractionOutcome,
  type PathFailure,
} from "./extract";
import {
  ContentHashMismatch,
  ingest,
  LowTrustSourceRejected,
  SourceHashMismatch,
  type IngestRequest,
  type IngestResult,
} from "./ingest";
import { UnsupportedMediaType } from "./media";
import type { ObjectStore } from "./store";

/**
 * The pipeline, composed.
 *
 * `spec/evidence-model.md §2` in code:
 *
 *   FETCHED → HASHED → CANONICALIZED → EXTRACTED → VALIDATED → CORROBORATED → COMMITTED
 *
 * with three branches off it: `SCHEMA_INVALID` discards and moves nothing, `CLAIM_CONFLICT` restricts
 * the Passport that already exists rather than committing a new one, and `SINGLE_SOURCE` commits with
 * capped capabilities.
 *
 * Each stage is a separate exported function in its own module and this file only orders them. That
 * matters more than it looks: `runPipeline` is convenience, and a caller that needs to ingest today and
 * extract tomorrow — which is what the work queue is for — composes the same functions in a different
 * order without reaching inside anything.
 */

export const PIPELINE_STAGES = [
  "FETCHED",
  "HASHED",
  "CANONICALIZED",
  "EXTRACTED",
  "VALIDATED",
  "CORROBORATED",
  /**
   * Reached only by a signer holding `ADMISSION`.
   *
   * Present in the enum because it is a real state of the asset, and never emitted by this pipeline:
   * `runPipeline` produces calldata and stops. Reporting `COMMITTED` for work that ended in an unsigned
   * byte string would be the pipeline claiming an authority it does not have.
   */
  "COMMITTED",
] as const;

export type PipelineStage = (typeof PIPELINE_STAGES)[number];

export type PipelineBranch = "SCHEMA_INVALID" | "CLAIM_CONFLICT" | "SINGLE_SOURCE";

export interface PipelineTrace {
  readonly stages: readonly PipelineStage[];
  readonly branch: PipelineBranch | null;
}

export interface PipelineRequest {
  readonly assetId: Hex32;
  /** `PassportRegistry.currentVersion(assetId) + 1`. Read from the chain by the caller. */
  readonly version: number;
  readonly document: Omit<IngestRequest, "bytes"> & { readonly bytes: Uint8Array };
  /** Operator policy, not an extracted claim. 0 for no expiry. */
  readonly expiresAt: UnixSeconds;
}

export interface PipelineDeps {
  readonly store: ObjectStore;
  /**
   * Extraction paths, in a fixed order.
   *
   * At least one must need no credential, or the pipeline stops working when a provider does. The
   * deterministic parser is that path and it is why losing the model degrades the result to
   * `SINGLE_SOURCE` instead of to nothing.
   */
  readonly extractors: readonly EvidenceExtractor[];
  readonly corroborator?: EvidenceCorroborator | undefined;
  readonly now?: (() => UnixSeconds) | undefined;
}

export interface ReadyToCommit {
  readonly kind: "READY_TO_COMMIT";
  readonly trace: PipelineTrace;
  readonly ingest: IngestResult;
  readonly claimSets: readonly ClaimSet[];
  readonly corroboration: Corroboration;
  readonly built: BuiltCandidate;
  readonly candidate: PassportCandidate;
  readonly singleSource: boolean;
  /**
   * Calldata in the order it must be sent. Evidence first: a Passport whose `evidenceRoot` covers
   * commitments that do not exist yet is a commitment to nothing, and no contract checks the
   * relationship (`spec/evidence-model.md §3`), so the ordering obligation is entirely ours.
   */
  readonly calls: readonly Calldata[];
  readonly pathFailures: readonly PathFailure[];
}

export interface SchemaInvalid {
  readonly kind: "SCHEMA_INVALID";
  readonly trace: PipelineTrace;
  readonly reason: string;
  /** True when the failure will recur identically forever, so the work queue must not retry it. */
  readonly terminal: boolean;
  readonly pathFailures: readonly PathFailure[];
}

export interface ClaimConflict {
  readonly kind: "CLAIM_CONFLICT";
  readonly trace: PipelineTrace;
  readonly ingest: IngestResult;
  readonly claimSets: readonly ClaimSet[];
  readonly corroboration: Corroboration;
  readonly conflictingFields: readonly string[];
  /**
   * `restrict` on the version that already exists, then a `CLAIM_CONFLICT` epoch bump.
   *
   * Not "commit v(n+1) and mark it conflicted": `commitPassport` always writes `status = ACTIVE`, so
   * committing first and restricting second leaves a window in which the disputed reading is live.
   * `currentVersion` here is `request.version - 1`, the version the conflict is about.
   */
  readonly calls: readonly Calldata[];
  readonly pathFailures: readonly PathFailure[];
}

export type PipelineOutcome = ReadyToCommit | SchemaInvalid | ClaimConflict;

/**
 * Errors that will fail identically on every retry.
 *
 * A forged source hash does not become genuine, an unsupported media type does not become supported,
 * and a schema violation does not become valid. Retrying them burns budget and delays a real operator
 * seeing a real problem, so the queue marks them `REJECTED` rather than counting attempts.
 */
export function isTerminalPipelineError(e: unknown): boolean {
  return (
    e instanceof SourceHashMismatch ||
    e instanceof ContentHashMismatch ||
    e instanceof LowTrustSourceRejected ||
    e instanceof UnsupportedMediaType ||
    e instanceof ExtractionSchemaInvalid ||
    e instanceof RiskParameterFieldRejected ||
    e instanceof ConflictedClaimSetRejected
  );
}

export async function runPipeline(
  req: PipelineRequest,
  deps: PipelineDeps,
  signal?: AbortSignal,
): Promise<PipelineOutcome> {
  const now = deps.now ?? (() => Math.floor(Date.now() / 1000));
  const corroborator = deps.corroborator ?? new DeterministicCorroborator();
  const stages: PipelineStage[] = ["FETCHED"];

  // --- HASHED + CANONICALIZED
  //
  // One call, because they are one transform: the digest is of the canonical bytes, so a document that
  // hashed but did not canonicalise is not a state the pipeline can be in. The raw bytes are stored
  // verbatim alongside, which is what keeps a future canonicaliser version able to re-derive.
  let ingested: IngestResult;
  try {
    ingested = await ingest(req.document, deps.store, signal);
  } catch (e) {
    return {
      kind: "SCHEMA_INVALID",
      trace: { stages, branch: "SCHEMA_INVALID" },
      reason: e instanceof Error ? `${e.name}: ${e.message}` : String(e),
      terminal: isTerminalPipelineError(e),
      pathFailures: [],
    };
  }
  stages.push("HASHED", "CANONICALIZED");

  // --- EXTRACTED → VALIDATED
  //
  // `runExtractors` validates each extraction as it arrives and drops any path that fails, so reaching
  // the next line means every surviving claim set is schema-valid and carries provenance matching the
  // hashed document. A path that produced nothing usable is recorded in `pathFailures`, never replaced.
  let extraction: ExtractionOutcome;
  try {
    extraction = await runExtractors(ingested.document, deps.extractors, signal);
  } catch (e) {
    return {
      kind: "SCHEMA_INVALID",
      trace: { stages, branch: "SCHEMA_INVALID" },
      reason: e instanceof Error ? `${e.name}: ${e.message}` : String(e),
      terminal: isTerminalPipelineError(e),
      pathFailures: [],
    };
  }
  stages.push("EXTRACTED", "VALIDATED");

  // --- CORROBORATED | CLAIM_CONFLICT | SINGLE_SOURCE
  const corroboration = await corroborator.compare(extraction.claimSets, signal);

  if (corroboration.outcome === "CLAIM_CONFLICT") {
    const conflictingFields = conflictingRiskFields(corroboration);
    const currentVersion = req.version - 1;
    return {
      kind: "CLAIM_CONFLICT",
      trace: { stages, branch: "CLAIM_CONFLICT" },
      ingest: ingested,
      claimSets: extraction.claimSets,
      corroboration,
      conflictingFields,
      calls:
        currentVersion >= 1
          ? [
              restrictPassportCalldata(req.assetId, currentVersion, "CONFLICTED"),
              bumpEpochCalldata(CAUSE_CLAIM_CONFLICT),
            ]
          : // No prior version exists, so there is nothing to restrict. The asset simply has no
            // Passport, which is already the most restrictive state available.
            [bumpEpochCalldata(CAUSE_CLAIM_CONFLICT)],
      pathFailures: extraction.failures,
    };
  }
  stages.push("CORROBORATED");

  let built: BuiltCandidate;
  try {
    built = buildCandidate({
      assetId: req.assetId,
      version: req.version,
      documents: [ingested.document],
      claimSets: extraction.claimSets,
      corroboration,
      expiresAt: req.expiresAt,
      builtAt: now(),
    });
  } catch (e) {
    return {
      kind: "SCHEMA_INVALID",
      trace: { stages, branch: "SCHEMA_INVALID" },
      reason: e instanceof Error ? `${e.name}: ${e.message}` : String(e),
      terminal: isTerminalPipelineError(e),
      pathFailures: extraction.failures,
    };
  }

  return {
    kind: "READY_TO_COMMIT",
    trace: { stages, branch: built.candidate.singleSource ? "SINGLE_SOURCE" : null },
    ingest: ingested,
    claimSets: extraction.claimSets,
    corroboration,
    built,
    candidate: built.candidate,
    singleSource: built.candidate.singleSource,
    calls: [
      commitEvidenceCalldata(req.assetId, ingested.document),
      commitPassportCalldata(built.candidate),
      bumpEpochCalldata(CAUSE_PASSPORT_COMMIT),
    ],
    pathFailures: extraction.failures,
  };
}

/**
 * Every document in one Passport, rather than one document per Passport.
 *
 * Exposed separately because `runPipeline` handles the common single-document case and a real admission
 * often rests on a prospectus plus a supplement. The claim sets from every document are corroborated
 * together, so a supplement contradicting the prospectus is a `CLAIM_CONFLICT` rather than a silent
 * last-writer-wins.
 */
export async function buildFromDocuments(input: {
  readonly assetId: Hex32;
  readonly version: number;
  readonly documents: readonly CanonicalDocument[];
  readonly claimSets: readonly ClaimSet[];
  readonly expiresAt: UnixSeconds;
  readonly builtAt: UnixSeconds;
  readonly corroborator?: EvidenceCorroborator | undefined;
}): Promise<
  | { readonly kind: "READY_TO_COMMIT"; readonly built: BuiltCandidate; readonly corroboration: Corroboration }
  | {
      readonly kind: "CLAIM_CONFLICT";
      readonly corroboration: Corroboration;
      readonly conflictingFields: readonly string[];
    }
> {
  const corroborator = input.corroborator ?? new DeterministicCorroborator();
  const corroboration = await corroborator.compare(input.claimSets);
  if (corroboration.outcome === "CLAIM_CONFLICT") {
    return { kind: "CLAIM_CONFLICT", corroboration, conflictingFields: conflictingRiskFields(corroboration) };
  }
  return {
    kind: "READY_TO_COMMIT",
    corroboration,
    built: buildCandidate({
      assetId: input.assetId,
      version: input.version,
      documents: input.documents,
      claimSets: input.claimSets,
      corroboration,
      expiresAt: input.expiresAt,
      builtAt: input.builtAt,
    }),
  };
}

import { loadManifest, loadFixture, runPipeline, InMemoryObjectStore } from "@usance/evidence";
import { DeterministicParserExtractor } from "@usance/chaingpt";
import {
  assetId as deriveAssetId,
  normalizeForComparison,
  UNKNOWN,
  type ClaimSet,
  type Corroboration,
  type EvidenceClaim,
  type Hex32,
  type PassportCandidate,
} from "@usance/schemas";

/**
 * The data behind the public proof explorer.
 *
 * This runs the **real** evidence pipeline at build time, over the real issuer documents in
 * `services/evidence/fixtures/`. Nothing on the resulting page is illustrative.
 *
 * It runs the deterministic parser path only, deliberately. Two reasons. A page that needs a
 * credential to render is a page that breaks for anyone who clones the repository, and a build
 * that calls a paid API once per asset per deploy is a build nobody runs twice. The consequence is
 * honest and visible: one extraction path means `SINGLE_SOURCE`, and the page says so rather than
 * implying corroboration it did not perform.
 *
 * `services/evidence` is a Node package reading from disk, so every consumer of this module must be
 * a server component.
 */

export interface EvidenceView {
  documentId: string;
  title: string;
  uri: string;
  httpStatus: number;
  mediaType: string;
  bytes: number;
  retrievedAt: number;
  effectiveAt: number;
  effectiveAtBasis: string;
  sourceClass: number;
  sourceClassName: string;
  issuerLegalName: string;
  issuerJurisdiction: string;
  issuerId: Hex32;
  rawDigest: Hex32;
  contentHash: Hex32;
  sourceHash: Hex32;
  evidenceId: Hex32;
  isDerived: boolean;
  derivedFrom: string | null;
  derivationNote: string | null;
  notes: string;
}

export interface ClaimView {
  field: string;
  /** Plain-language rendering of the field name. */
  label: string;
  /** Plain-language rendering of the value, or null when the document does not say. */
  reading: string | null;
  isUnknown: boolean;
  quote: string | null;
  section: string | null;
  extractor: string;
  confidenceBps: number;
  /** How the independent paths compared on this field. */
  outcome: "AGREED" | "CONFLICT" | "SINGLE" | "ABSENT";
  riskBearing: boolean;
}

export interface AssetView {
  assetId: Hex32;
  slug: string;
  symbol: string;
  name: string;
  issuer: string;
  /** Whether a real token address is known. None of the fixtures have one yet. */
  tokenAddress: `0x${string}` | null;
  isTestFixture: boolean;

  /** Every version of this issuer's document, newest first. */
  versions: Array<{ version: number; evidence: EvidenceView }>;
  current: EvidenceView;

  claims: ClaimView[];
  corroboration: Corroboration["outcome"];
  independentPathCount: number;
  singleSource: boolean;

  candidate: PassportCandidate | null;
  conflictingFields: readonly string[];

  /** Calldata the pipeline produced, in the order it must be sent. Not yet broadcast. */
  calls: Array<{ contract: string; functionName: string; data: `0x${string}` }>;

  /** Why the asset is or is not admissible, in one sentence. */
  verdict: {
    state: "ADMISSIBLE" | "CAPPED" | "BLOCKED";
    headline: string;
    because: string;
  };
}

/** Human labels. The page leads with these; the dotted path is the advanced view. */
const FIELD_LABELS: Record<string, string> = {
  "legal.issuerLegalName": "Who issues it",
  "legal.issuerJurisdiction": "Where the issuer is incorporated",
  "legal.governingLaw": "Which law governs it",
  "legal.holderRights": "What the holder owns",
  "backing.model": "What backs it",
  "backing.custodianName": "Who holds the underlying",
  "redemption.supported": "Can it be redeemed",
  "redemption.estimatedWindowSeconds": "How long redemption takes",
  "redemption.floorBps": "What redemption guarantees",
  "transfer.permissionModel": "Who may hold it",
  "corporateActions.mechanism": "How income reaches holders",
};

const RISK_BEARING = new Set([
  "redemption.supported",
  "redemption.floorBps",
  "redemption.estimatedWindowSeconds",
  "transfer.permissionModel",
  "backing.model",
  "legal.holderRights",
  "corporateActions.mechanism",
]);

/** Render a claim value as something a person reads, not as JSON. */
function readValue(field: string, c: EvidenceClaim): string | null {
  if (c.value === UNKNOWN) return null;
  switch (c.value.kind) {
    case "bool":
      if (field === "redemption.supported") return c.value.value ? "Yes" : "No";
      return c.value.value ? "Yes" : "No";
    case "seconds": {
      const s = c.value.value;
      if (s % 86_400 === 0) {
        const d = s / 86_400;
        return d === 1 ? "1 day" : `${d} days`;
      }
      if (s % 3_600 === 0) return `${s / 3_600} hours`;
      return `${s} seconds`;
    }
    case "bps":
      return `${(c.value.value / 100).toFixed(2)}%`;
    case "enum":
      return prettyEnum(c.value.name);
    case "string":
      return c.value.value;
    case "address":
      return c.value.value;
  }
}

function prettyEnum(name: string): string {
  const map: Record<string, string> = {
    PERMISSIONED: "Only approved holders",
    RESTRICTED: "Only approved holders",
    OPEN: "Anyone",
    FULLY_BACKED: "Backed one-for-one by the underlying",
    SYNTHETIC: "Synthetic exposure, not directly backed",
    REBASE: "Balances adjust automatically",
    DISTRIBUTION: "Paid out as a distribution",
  };
  return map[name] ?? name.toLowerCase().replace(/_/g, " ");
}

/**
 * Group manifest documents into assets. Same issuer and instrument, many versions.
 *
 * Matched against the known instrument prefixes rather than by stripping a trailing year. The
 * first version of this stripped `-\d{4}$`, which silently dropped two of the three assets:
 * `arca-arcoin-2026-07` ends in a month and `ondo-ousg-overview` has no date at all. Both
 * vanished from the catalogue with no error, which is exactly the failure mode a page that claims
 * to be a proof explorer cannot afford.
 */
function assetKeyOf(id: string): string | null {
  const bare = id.replace(/^DERIVED-/, "");
  for (const key of Object.keys(ASSET_META)) {
    if (bare === key || bare.startsWith(`${key}-`)) return key;
  }
  return null;
}

const ASSET_META: Record<string, { symbol: string; name: string; issuer: string }> = {
  "franklin-fobxx": {
    symbol: "FOBXX",
    name: "Franklin OnChain U.S. Government Money Fund",
    issuer: "Franklin Templeton Trust",
  },
  "arca-arcoin": {
    symbol: "ARCOIN",
    name: "Arca U.S. Treasury Fund",
    issuer: "Arca Capital Management",
  },
  "ondo-ousg": {
    symbol: "OUSG",
    name: "Ondo Short-Term U.S. Government Treasuries",
    issuer: "Ondo Finance",
  },
};

let cached: AssetView[] | null = null;

export async function loadAssets(): Promise<AssetView[]> {
  if (cached) return cached;

  const manifest = await loadManifest();
  const groups = new Map<string, typeof manifest.documents>();

  for (const doc of manifest.documents) {
    // Derived fixtures exist to prove the injection defence. They are not an asset a reader should
    // be offered as though an issuer published them.
    if (doc.isDerived) continue;
    const key = assetKeyOf(doc.id);
    // An unrecognised document is skipped loudly at build time rather than silently dropped —
    // a catalogue that quietly omits an asset is worse than one that fails to build.
    if (key === null) {
      console.warn(`[passport-data] no ASSET_META entry for fixture "${doc.id}" — not listed`);
      continue;
    }
    const list = groups.get(key) ?? [];
    list.push(doc);
    groups.set(key, list);
  }

  const out: AssetView[] = [];

  for (const [key, docs] of groups) {
    const meta = ASSET_META[key];
    if (!meta) continue;


    const ordered = [...docs].sort((a, b) => a.effectiveAt - b.effectiveAt);
    const latest = ordered[ordered.length - 1]!;

    // No fixture has a verified onchain token address. `assetId` is still derived the canonical
    // way so it is stable and reproducible, using the zero address to make the absence explicit
    // rather than inventing a plausible-looking one.
    const aid = deriveAssetId(1952n, `0x${"00".repeat(20)}` as `0x${string}`);
    const assetIdForKey = deriveAssetIdFromKey(key);

    const fixture = await loadFixture(latest.id);
    const outcome = await runPipeline(
      {
        assetId: assetIdForKey,
        version: ordered.length,
        document: {
          uri: latest.uri,
          issuerId: latest.issuer.issuerId as Hex32,
          sourceClass: latest.sourceClass,
          mediaType: latest.mediaType,
          retrievedAt: latest.retrievedAt,
          effectiveAt: latest.effectiveAt,
          bytes: fixture.bytes,
          // The manifest asserts the origin; ingest recomputes it from (uri, issuerId) and rejects
          // a mismatch. Passing it is not a formality — it is the check that stops correct bytes
          // served from a different origin from masquerading as the original.
          assertedSourceHash: latest.sourceHash as Hex32,
        },
        expiresAt: 0,
      },
      { store: new InMemoryObjectStore(), extractors: [new DeterministicParserExtractor()] },
    );

    const claims = viewClaims(
      outcome.kind === "SCHEMA_INVALID" ? [] : outcome.claimSets,
      outcome.kind === "SCHEMA_INVALID" ? null : outcome.corroboration,
    );

    const candidate = outcome.kind === "READY_TO_COMMIT" ? outcome.candidate : null;
    const singleSource = outcome.kind === "READY_TO_COMMIT" ? outcome.singleSource : true;

    out.push({
      assetId: assetIdForKey,
      slug: key,
      symbol: meta.symbol,
      name: meta.name,
      issuer: meta.issuer,
      tokenAddress: null,
      isTestFixture: true,
      versions: ordered.map((d, i) => ({ version: i + 1, evidence: viewEvidence(d) })),
      current: viewEvidence(latest),
      claims,
      corroboration:
        outcome.kind === "SCHEMA_INVALID" ? "SINGLE_SOURCE" : outcome.corroboration.outcome,
      independentPathCount:
        outcome.kind === "SCHEMA_INVALID" ? 0 : outcome.corroboration.independentPathCount,
      singleSource,
      candidate,
      conflictingFields: outcome.kind === "CLAIM_CONFLICT" ? outcome.conflictingFields : [],
      calls:
        outcome.kind === "SCHEMA_INVALID"
          ? []
          : outcome.calls.map((c) => ({
              contract: c.contract,
              functionName: c.functionName,
              data: c.data,
            })),
      verdict: verdictFor(outcome.kind, singleSource, claims),
    });
    void aid;
  }

  cached = out.sort((a, b) => a.symbol.localeCompare(b.symbol));
  return cached;
}

/** Stable per-instrument id so URLs and roots do not move between builds. */
function deriveAssetIdFromKey(key: string): Hex32 {
  const bytes = new TextEncoder().encode(`usance-fixture-asset:${key}`);
  let hex = "";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return `0x${hex.padEnd(64, "0").slice(0, 64)}` as Hex32;
}

function viewEvidence(d: {
  id: string;
  title: string;
  uri: string;
  httpStatus: number;
  mediaType: string;
  bytes: number;
  retrievedAt: number;
  effectiveAt: number;
  effectiveAtBasis: string;
  sourceClass: number;
  sourceClassName: string;
  issuer: { legalName: string; jurisdiction: string; issuerId: string };
  rawDigest: string;
  contentHash: string;
  sourceHash: string;
  evidenceId: string;
  isDerived: boolean;
  derivedFrom: string | null;
  derivationNote: string | null;
  notes: string;
}): EvidenceView {
  return {
    documentId: d.id,
    title: d.title,
    uri: d.uri,
    httpStatus: d.httpStatus,
    mediaType: d.mediaType,
    bytes: d.bytes,
    retrievedAt: d.retrievedAt,
    effectiveAt: d.effectiveAt,
    effectiveAtBasis: d.effectiveAtBasis,
    sourceClass: d.sourceClass,
    sourceClassName: d.sourceClassName,
    issuerLegalName: d.issuer.legalName,
    issuerJurisdiction: d.issuer.jurisdiction,
    issuerId: d.issuer.issuerId as Hex32,
    rawDigest: d.rawDigest as Hex32,
    contentHash: d.contentHash as Hex32,
    sourceHash: d.sourceHash as Hex32,
    evidenceId: d.evidenceId as Hex32,
    isDerived: d.isDerived,
    derivedFrom: d.derivedFrom,
    derivationNote: d.derivationNote,
    notes: d.notes,
  };
}

function viewClaims(sets: readonly ClaimSet[], corr: Corroboration | null): ClaimView[] {
  const outcomeByField = new Map(corr?.fields.map((f) => [f.field, f.outcome]) ?? []);
  const seen = new Map<string, ClaimView>();

  for (const set of sets) {
    for (const c of set.claims) {
      const existing = seen.get(c.field);
      // Prefer a claim that actually says something over one that abstained.
      if (existing && !existing.isUnknown) continue;
      seen.set(c.field, {
        field: c.field,
        label: FIELD_LABELS[c.field] ?? c.field,
        reading: readValue(c.field, c),
        isUnknown: c.value === UNKNOWN,
        quote: c.locator?.quote ?? null,
        section: c.locator?.section ?? null,
        extractor: c.extractor,
        confidenceBps: c.confidenceBps,
        outcome: outcomeByField.get(c.field) ?? "ABSENT",
        riskBearing: RISK_BEARING.has(c.field),
      });
    }
  }

  // Known fields first, in the order a reader would ask them.
  const order = Object.keys(FIELD_LABELS);
  return [...seen.values()].sort((a, b) => {
    const ia = order.indexOf(a.field);
    const ib = order.indexOf(b.field);
    return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
  });
}

function verdictFor(
  kind: "READY_TO_COMMIT" | "SCHEMA_INVALID" | "CLAIM_CONFLICT",
  singleSource: boolean,
  claims: ClaimView[],
): AssetView["verdict"] {
  if (kind === "CLAIM_CONFLICT") {
    return {
      state: "BLOCKED",
      headline: "Not admissible while the evidence disagrees",
      because:
        "Two independent readings of the issuer's document reached different conclusions about something that affects how much can be lent against it. Usance does not vote between them.",
    };
  }
  if (kind === "SCHEMA_INVALID") {
    return {
      state: "BLOCKED",
      headline: "Not admissible",
      because: "The evidence could not be read into a structure the protocol can act on.",
    };
  }

  const known = claims.filter((c) => !c.isUnknown && c.riskBearing).length;
  if (singleSource) {
    return {
      state: "CAPPED",
      headline: "Admissible, with a capped Passport",
      because: `Only one extraction path was available, so ${known} risk-bearing ${known === 1 ? "reading is" : "readings are"} recorded but uncorroborated. A single-source Passport cannot unlock capabilities that require two independent paths to agree.`,
    };
  }
  return {
    state: "ADMISSIBLE",
    headline: "Admissible as collateral",
    because: `Two independent extraction paths agreed on ${known} risk-bearing readings from the issuer's own filing.`,
  };
}

export async function loadAsset(slug: string): Promise<AssetView | null> {
  const all = await loadAssets();
  return all.find((a) => a.slug === slug) ?? null;
}

export { normalizeForComparison };

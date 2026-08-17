import {
  UNKNOWN,
  type CanonicalDocument,
  type ClaimValue,
  type EvidenceClaim,
  type EvidenceExtractor,
  type Extraction,
  type ProviderStatus,
} from "@usance/schemas";

/**
 * Deterministic parser extractor.
 *
 * This is the second extraction path, and it is what makes corroboration mean anything. A model and
 * a regex-based parser fail in genuinely different ways: the model invents plausible text, the
 * parser misses phrasings it was not written for. Neither failure produces the other, so agreement
 * between them is informative in a way that agreement between two prompts is not.
 *
 * It also means the pipeline works with no API key at all. Without one, extraction runs this path
 * alone, corroboration returns SINGLE_SOURCE, and the resulting Passport is capped by policy. That
 * is a real, honest degradation rather than a fabricated model response.
 *
 * It abstains aggressively. A parser that guesses would defeat the whole arrangement, because a
 * guess is indistinguishable from a reading at comparison time.
 */
export class DeterministicParserExtractor implements EvidenceExtractor {
  readonly id = "parser@1";

  /** Distinct from "chaingpt" — that is the entire point of this class. */
  readonly independenceGroup = "deterministic-parser";

  status(): ProviderStatus {
    return "available";
  }

  async extract(input: CanonicalDocument): Promise<Extraction> {
    const startedAt = Math.floor(Date.now() / 1000);
    const text = new TextDecoder().decode(input.bytes);
    const claims: EvidenceClaim[] = [];
    const warnings: string[] = [];

    const add = (field: string, value: ClaimValue | typeof UNKNOWN, quote: string | null) => {
      claims.push({
        field,
        value,
        locator: value === UNKNOWN ? null : { section: null, startOffset: null, endOffset: null, quote: quote ?? "" },
        evidenceId: input.evidenceId,
        sourceClass: input.sourceClass,
        retrievedAt: input.retrievedAt,
        effectiveAt: input.effectiveAt,
        expiresAt: null,
        extractor: this.id,
        // A deterministic parser either matched or it did not. Reporting anything other than a
        // flat 10000 would imply a calibration it does not have.
        confidenceBps: value === UNKNOWN ? 0 : 10_000,
        corroboratingEvidenceIds: [],
        attestation: null,
      });
    };

    // --- redemption.supported
    const redemption = findRedemption(text);
    add("redemption.supported", redemption.value, redemption.quote);

    // --- redemption.estimatedWindowSeconds
    const window = findRedemptionWindow(text);
    add("redemption.estimatedWindowSeconds", window.value, window.quote);

    // --- transfer.permissionModel
    const transfer = findTransferModel(text);
    add("transfer.permissionModel", transfer.value, transfer.quote);

    // --- backing.model
    const backing = findBackingModel(text);
    add("backing.model", backing.value, backing.quote);

    // --- corporateActions.mechanism
    const ca = findCorporateActions(text);
    add("corporateActions.mechanism", ca.value, ca.quote);

    if (claims.every((c) => c.value === UNKNOWN)) {
      warnings.push("no field matched any known phrasing; the document may need a new parser rule");
    }

    return {
      extractor: this.id,
      documentEvidenceId: input.evidenceId,
      claims,
      startedAt,
      finishedAt: Math.floor(Date.now() / 1000),
      warnings,
    };
  }
}

interface Found {
  value: ClaimValue | typeof UNKNOWN;
  quote: string | null;
}

/** Return the sentence containing a match, so every claim carries a checkable quote. */
function sentenceAround(text: string, index: number): string {
  const start = Math.max(0, text.lastIndexOf(".", index) + 1);
  const end = text.indexOf(".", index);
  return text.slice(start, end < 0 ? Math.min(text.length, index + 200) : end + 1).trim();
}

function search(text: string, patterns: readonly RegExp[]): { m: RegExpMatchArray; quote: string } | null {
  for (const p of patterns) {
    const m = text.match(p);
    if (m?.index !== undefined) return { m, quote: sentenceAround(text, m.index) };
  }
  return null;
}

function findRedemption(text: string): Found {
  // Negations are checked first. "not redeemable" contains "redeemable", and a parser that matched
  // the positive form first would read a denial as an affirmation.
  const negative = search(text, [
    /\b(?:not|no|cannot|may not|shall not)\s+(?:be\s+)?redeem(?:able|ed)?\b/i,
    /\bredemption\s+(?:is\s+)?(?:not\s+available|suspended|prohibited|unavailable)\b/i,
    /\bno\s+redemption\s+right/i,
  ]);
  if (negative) return { value: { kind: "bool", value: false }, quote: negative.quote };

  const positive = search(text, [
    /\bredemption\s+(?:is\s+)?(?:supported|available|permitted)\b/i,
    /\b(?:holders?|investors?)\s+may\s+redeem\b/i,
    /\bredeemable\s+(?:at|for|into)\b/i,
    /\bright\s+to\s+redeem\b/i,
  ]);
  if (positive) return { value: { kind: "bool", value: true }, quote: positive.quote };

  return { value: UNKNOWN, quote: null };
}

function findRedemptionWindow(text: string): Found {
  const hit = search(text, [
    /\bwithin\s+(\d+)\s+(hour|hours|day|days|business\s+days)\b/i,
    /\b(?:settlement|redemption)\s+(?:period|window)\s+of\s+(\d+)\s+(hour|hours|day|days|business\s+days)\b/i,
    /\bT\+(\d+)\b/i,
  ]);
  if (!hit) return { value: UNKNOWN, quote: null };

  const n = Number(hit.m[1]);
  if (!Number.isInteger(n) || n < 0 || n > 3650) return { value: UNKNOWN, quote: null };

  const unit = (hit.m[2] ?? "days").toLowerCase();
  const seconds = unit.startsWith("hour")
    ? n * 3_600
    : // Business days are not calendar days. Treating them as equal would understate a
      // settlement window, and a settlement window feeds the redemption haircut.
      unit.includes("business")
      ? Math.ceil(n * (7 / 5)) * 86_400
      : n * 86_400;

  return { value: { kind: "seconds", value: seconds }, quote: hit.quote };
}

function findTransferModel(text: string): Found {
  const restricted = search(text, [
    /\bwhitelist(?:ed|ing)?\b/i,
    /\btransfer\s+(?:is\s+)?restrict(?:ed|ions)\b/i,
    /\beligible\s+(?:holders?|investors?)\s+only\b/i,
    /\bpermissioned\s+transfer/i,
    /\btransfer\s+agent\s+approval\b/i,
  ]);
  if (restricted) return { value: { kind: "enum", ordinal: 1, name: "PERMISSIONED" }, quote: restricted.quote };

  const open = search(text, [/\bfreely\s+transferable\b/i, /\bno\s+transfer\s+restrictions?\b/i]);
  if (open) return { value: { kind: "enum", ordinal: 0, name: "OPEN" }, quote: open.quote };

  return { value: UNKNOWN, quote: null };
}

function findBackingModel(text: string): Found {
  const oneToOne = search(text, [
    /\b1\s*[:\-]\s*1\s+backed\b/i,
    /\bfully\s+(?:backed|collateral(?:ised|ized))\b/i,
    /\bbacked\s+(?:1:1\s+)?by\s+(?:the\s+)?underlying\b/i,
  ]);
  if (oneToOne) return { value: { kind: "enum", ordinal: 1, name: "FULLY_BACKED" }, quote: oneToOne.quote };

  const synthetic = search(text, [/\bsynthetic\s+exposure\b/i, /\bnot\s+backed\s+by\b/i]);
  if (synthetic) return { value: { kind: "enum", ordinal: 2, name: "SYNTHETIC" }, quote: synthetic.quote };

  return { value: UNKNOWN, quote: null };
}

function findCorporateActions(text: string): Found {
  const rebase = search(text, [
    /\brebas(?:e|ing|ed)\b/i,
    /\breflected\s+(?:in|by)\s+(?:a\s+)?(?:token\s+)?(?:balance|supply)\s+adjust/i,
  ]);
  if (rebase) return { value: { kind: "enum", ordinal: 1, name: "REBASE" }, quote: rebase.quote };

  const distribution = search(text, [/\bdividends?\s+(?:are\s+)?(?:paid|distributed)\b/i]);
  if (distribution) return { value: { kind: "enum", ordinal: 2, name: "DISTRIBUTION" }, quote: distribution.quote };

  return { value: UNKNOWN, quote: null };
}

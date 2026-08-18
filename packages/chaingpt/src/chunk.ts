import { keccak256, stringToBytes } from "viem";
import type { Hex32 } from "@usance/schemas";

/**
 * Deterministic document chunking.
 *
 * Measured against the live API: a ~500-character fixture extracts in 11 seconds, a 25,713-character
 * SEC filing does not return inside 150 seconds. That is why the first live Franklin Passport
 * committed as `singleSource` — the model path was invoked, took too long to be usable, and
 * contributed no reading. The corroborator counted honestly and the Passport was capped.
 *
 * The fix is to send less at a time, not to send something different. Nothing here summarises,
 * rewrites or reorders the document: using a model to preprocess a model's input would put an
 * unverifiable transformation between the issuer's words and the claim that cites them, and the
 * quote a reviewer checks would no longer be the quote the extractor saw.
 *
 * Chunking is byte-for-byte reproducible. The same canonical text always yields the same chunks
 * with the same offsets and the same digests, so a claim's `locator` still points into the document
 * that was hashed.
 */

/**
 * Target characters per chunk.
 *
 * Chosen from the latency probe rather than from a token budget: the constraint here is the
 * provider's wall-clock behaviour, not a context window.
 */
export const CHUNK_TARGET_CHARS = 6_000;

/** Overlap so a fact spanning a boundary is visible whole in at least one chunk. */
export const CHUNK_OVERLAP_CHARS = 400;

export interface DocumentChunk {
  readonly index: number;
  readonly total: number;
  /** Character offsets into the canonical text. A locator resolves through these. */
  readonly startOffset: number;
  readonly endOffset: number;
  readonly text: string;
  /** Digest of this chunk's text, so a per-chunk extraction is attributable. */
  readonly chunkHash: Hex32;
  /** Nearest preceding heading, when one exists. Recorded, never inferred. */
  readonly section: string | null;
}

/**
 * Split canonical text on paragraph boundaries.
 *
 * Never mid-sentence. A chunk that ends halfway through "redemption is not" and resumes with
 * "available within 24 hours" invites exactly the misreading this whole pipeline exists to prevent,
 * and the overlap alone would not save it.
 */
export function chunkDocument(
  text: string,
  targetChars: number = CHUNK_TARGET_CHARS,
  overlapChars: number = CHUNK_OVERLAP_CHARS,
): DocumentChunk[] {
  if (text.length <= targetChars) {
    return [
      {
        index: 0,
        total: 1,
        startOffset: 0,
        endOffset: text.length,
        text,
        chunkHash: keccak256(stringToBytes(text)),
        section: headingBefore(text, 0),
      },
    ];
  }

  const bounds: Array<{ start: number; end: number }> = [];
  let cursor = 0;

  while (cursor < text.length) {
    const hardEnd = Math.min(cursor + targetChars, text.length);
    let end = hardEnd;

    if (hardEnd < text.length) {
      // Prefer a paragraph break, then a line break, then a sentence end. Only if none of those
      // appear in the last quarter of the window does it cut on the raw boundary.
      const window = text.slice(cursor, hardEnd);
      const floor = Math.floor(targetChars * 0.75);
      for (const sep of ["\n\n", "\n", ". "]) {
        const at = window.lastIndexOf(sep);
        if (at >= floor) {
          end = cursor + at + sep.length;
          break;
        }
      }
    }

    bounds.push({ start: cursor, end });
    if (end >= text.length) break;
    cursor = Math.max(end - overlapChars, cursor + 1);
  }

  return bounds.map((b, i) => {
    const slice = text.slice(b.start, b.end);
    return {
      index: i,
      total: bounds.length,
      startOffset: b.start,
      endOffset: b.end,
      text: slice,
      chunkHash: keccak256(stringToBytes(slice)),
      section: headingBefore(text, b.start),
    };
  });
}

/**
 * The nearest preceding line that looks like a heading.
 *
 * Heuristic and honest about it: it decorates a claim's locator so a reviewer can find the passage
 * faster. Nothing downstream depends on it, and a wrong guess costs a reader one scroll rather than
 * changing what was read.
 */
function headingBefore(text: string, offset: number): string | null {
  const before = text.slice(0, offset);
  const lines = before.split("\n");
  for (let i = lines.length - 1; i >= 0 && i > lines.length - 60; i--) {
    const line = (lines[i] ?? "").trim();
    if (line.length === 0 || line.length > 90) continue;
    const isHeading =
      /^(section|item|part|article)\s+[\dIVXA-Z]/i.test(line) ||
      (line === line.toUpperCase() && /[A-Z]{4}/.test(line)) ||
      /^[A-Z][^.!?]{3,80}$/.test(line);
    if (isHeading) return line;
  }
  return null;
}

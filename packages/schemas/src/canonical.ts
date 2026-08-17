import { keccak256, encodeAbiParameters, stringToBytes, toHex } from "viem";
import type { Hex32 } from "./primitives";

/**
 * Canonicalisation and content addressing.
 *
 * Two rules make everything downstream verifiable. First, the same document must always produce
 * the same hash, on any machine, in any locale, forever — otherwise a Passport cannot be checked
 * against the bytes it was built from. Second, the canonicaliser is versioned, because changing
 * it changes every hash it has ever produced, and that has to be a visible event rather than a
 * silent one.
 */

/**
 * Bump on ANY behavioural change to `canonicalizeText`.
 *
 * The version travels with every `CanonicalDocument`, so a Passport built under v1 stays
 * verifiable after v2 ships instead of becoming unreproducible.
 */
export const CANONICALIZER_VERSION = "usance-text/1" as const;

const ZERO_WIDTH = /[​-‍⁠﻿]/g;
// Unicode separators, excluding the ordinary space and newline handled explicitly below.
const UNICODE_SPACES = /[   -   　]/g;

/**
 * Deterministic text canonicalisation.
 *
 * Idempotent by construction: running it twice yields the same output, which is asserted in the
 * tests. Everything it removes is something that can differ between two retrievals of the same
 * document without the document having changed — line-ending style, trailing whitespace,
 * invisible characters injected by a CMS, or a decomposed vs precomposed accent.
 */
export function canonicalizeText(input: string): string {
  return (
    input
      // NFC first: normalising after whitespace collapsing would let a decomposed sequence
      // recompose into a character that then needed collapsing again, breaking idempotence.
      .normalize("NFC")
      .replace(ZERO_WIDTH, "")
      .replace(UNICODE_SPACES, " ")
      .replace(/\r\n?/g, "\n")
      .split("\n")
      .map((line) => line.replace(/[ \t]+/g, " ").trim())
      .join("\n")
      // Collapse runs of blank lines to a single blank line: paragraph structure is meaningful,
      // the exact number of blank lines between paragraphs is not.
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

export function canonicalBytes(input: string): Uint8Array {
  return stringToBytes(canonicalizeText(input));
}

/** Digest of the canonicalised bytes. This is what a Passport commits to. */
export function contentHash(canonicalised: Uint8Array): Hex32 {
  return keccak256(canonicalised);
}

export function contentHashOfText(input: string): Hex32 {
  return contentHash(canonicalBytes(input));
}

/**
 * Digest of where a document came from.
 *
 * Bound to both the URI and the issuer identity, so the same bytes served from a different origin
 * produce a different `sourceHash` and therefore a different `evidenceId`. That is what makes the
 * forged-source-metadata case detectable: correct content under a wrong origin does not
 * masquerade as the original.
 */
export function sourceHash(uri: string, issuerId: Hex32): Hex32 {
  return keccak256(
    encodeAbiParameters(
      [{ type: "string" }, { type: "bytes32" }],
      [uri.trim().normalize("NFC"), issuerId],
    ),
  );
}

/** Stable identity for an issuer, derived rather than assigned. */
export function issuerId(legalName: string, jurisdiction: string): Hex32 {
  return keccak256(
    encodeAbiParameters(
      [{ type: "string" }, { type: "string" }],
      [legalName.trim().normalize("NFC").toLowerCase(), jurisdiction.trim().toUpperCase()],
    ),
  );
}

export { toHex };

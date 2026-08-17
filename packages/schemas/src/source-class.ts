import { z } from "zod";

/**
 * Evidence authority hierarchy.
 *
 * Ordinals are load-bearing and must match `contracts/src/libraries/Types.sol` exactly. The
 * onchain `EvidenceRegistry.supersede` compares them as `uint8`, so a mismatch here would let a
 * news article overwrite a regulatory filing offchain while the chain refused the same move.
 */
export const SourceClass = {
  SOCIAL: 0,
  NEWS: 1,
  MARKET_DATA: 2,
  INDEPENDENT_PROVIDER: 3,
  ISSUER_DOC: 4,
  REGULATORY_FILING: 5,
  ISSUER_SIGNED: 6,
} as const;

export type SourceClass = (typeof SourceClass)[keyof typeof SourceClass];

export const SOURCE_CLASS_NAMES = [
  "SOCIAL",
  "NEWS",
  "MARKET_DATA",
  "INDEPENDENT_PROVIDER",
  "ISSUER_DOC",
  "REGULATORY_FILING",
  "ISSUER_SIGNED",
] as const;

export type SourceClassName = (typeof SOURCE_CLASS_NAMES)[number];

export const sourceClassSchema = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
  z.literal(6),
]);

export function sourceClassName(c: SourceClass): SourceClassName {
  return SOURCE_CLASS_NAMES[c];
}

/**
 * The classes that may never become a claim.
 *
 * An observation from one of these can trigger a refresh or an alert. It can never be an input to
 * `commitPassport` and can never raise a limit (invariant I-18). Keeping the set explicit means an
 * `ObservationProvider` can be checked against it at runtime rather than trusted.
 */
export const LOW_TRUST_CLASSES = [SourceClass.SOCIAL, SourceClass.NEWS, SourceClass.MARKET_DATA] as const;

export type LowTrustSourceClass = (typeof LOW_TRUST_CLASSES)[number];

export function isLowTrust(c: SourceClass): c is LowTrustSourceClass {
  return (LOW_TRUST_CLASSES as readonly SourceClass[]).includes(c);
}

/**
 * Whether `replacement` is strong enough to supersede `existing`.
 *
 * Mirrors `EvidenceRegistry.supersede`'s `WeakerSource` check. Equal class is permitted — a newer
 * filing replaces an older filing — but a strictly weaker one is not.
 */
export function canSupersede(existing: SourceClass, replacement: SourceClass): boolean {
  return replacement >= existing;
}

/** The minimum class that may support a claim reaching the chain. */
export const MIN_CLAIM_CLASS: SourceClass = SourceClass.INDEPENDENT_PROVIDER;

export function maySupportClaim(c: SourceClass): boolean {
  return c >= MIN_CLAIM_CLASS;
}

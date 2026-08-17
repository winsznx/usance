import { z } from "zod";

/**
 * Shared primitive types, matching `spec/interfaces.md §7`.
 *
 * These are the names the rest of the system uses. They exist so that `Usd18` and `Bps` cannot be
 * confused at a call site: both are numbers in the loosest sense, and mixing them is how a
 * haircut becomes a dollar amount.
 */

export type Hex32 = `0x${string}`;
export type EvmAddress = `0x${string}`;
export type AssetId = Hex32;
export type Usd18 = bigint;
export type Bps = number;
export type UnixSeconds = number;

export const hex32Schema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/, "expected a 32-byte hex string")
  .transform((s) => s.toLowerCase() as Hex32);

export const addressSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/, "expected a 20-byte address")
  .transform((s) => s.toLowerCase() as EvmAddress);

export const bpsSchema = z.number().int().min(0).max(10_000);

export const unixSecondsSchema = z.number().int().min(0);

/**
 * The UNKNOWN sentinel.
 *
 * A first-class outcome, never a placeholder to be filled in later. An extractor that guesses is
 * worse than one that abstains: at corroboration time a guess is indistinguishable from a reading,
 * so it converts an absence of evidence into an agreement.
 */
export const UNKNOWN = "UNKNOWN" as const;
export type Unknown = typeof UNKNOWN;

/** A canonical claim value. Deliberately narrow — no objects, no free-form JSON. */
export const claimValueSchema = z.union([
  z.object({ kind: z.literal("bool"), value: z.boolean() }),
  z.object({ kind: z.literal("bps"), value: bpsSchema }),
  z.object({ kind: z.literal("seconds"), value: z.number().int().min(0) }),
  z.object({ kind: z.literal("enum"), ordinal: z.number().int().min(0), name: z.string().min(1) }),
  z.object({ kind: z.literal("string"), value: z.string() }),
  z.object({ kind: z.literal("address"), value: addressSchema }),
]);

export type ClaimValue = z.infer<typeof claimValueSchema>;

/**
 * Type-directed normalisation for comparison (`spec/evidence-model.md §6`).
 *
 * Exact equality after normalisation. Not fuzzy matching, not embedding distance, not "close
 * enough" — a corroborator that tolerates near-misses will eventually corroborate two different
 * readings of a redemption term.
 */
export function normalizeForComparison(v: ClaimValue | Unknown): string {
  if (v === UNKNOWN) return UNKNOWN;
  switch (v.kind) {
    case "bool":
      return `bool:${v.value ? "1" : "0"}`;
    case "bps":
      return `bps:${v.value}`;
    case "seconds":
      return `seconds:${v.value}`;
    case "enum":
      // By ordinal, not by name. Two extractors may render the same enum with different labels.
      return `enum:${v.ordinal}`;
    case "string":
      return `string:${v.value.normalize("NFC").toLowerCase().replace(/\s+/g, " ").trim()}`;
    case "address":
      return `address:${v.value.toLowerCase()}`;
  }
}

export function claimValuesEqual(a: ClaimValue | Unknown, b: ClaimValue | Unknown): boolean {
  return normalizeForComparison(a) === normalizeForComparison(b);
}

import { z } from "zod";
import { addressSchema, hex32Schema, type Hex32 } from "./primitives";
import { issuerId as deriveIssuerId } from "./canonical";
import {
  domainId as deriveDomainId,
  evmCanonicalRef,
  instrumentId as deriveInstrumentId,
  instrumentStandardId as deriveInstrumentStandardId,
  nativeCanonicalRef,
  underlyingReferenceId as deriveUnderlyingReferenceId,
} from "./ids";

/**
 * Instrument identity — `spec/identity-model.md`.
 *
 * The exact identity of a tokenized instrument, as distinct from the company or fund it refers to
 * and from its own economic state at a point in time. Additive to the deployed system: nothing
 * here is read by a money contract or is an input to a formula in `spec/accounting.md`.
 *
 * The guards in this file are the enforcement point for two Product Lock rules: a ticker alone
 * never identifies an underlying, and domain / issuer / standard are part of an instrument's
 * identity rather than incidental metadata.
 */

// ---------------------------------------------------------------------------- closed vocabularies

export const INSTRUMENT_STANDARDS = [
  "ERC20",
  "B20",
  "XSTOCKS_TRACKER_CERT",
  "HTS",
  "ATS_ERC1400",
] as const;
export const instrumentStandardSchema = z.enum(INSTRUMENT_STANDARDS);
export type InstrumentStandard = z.infer<typeof instrumentStandardSchema>;

export const ASSET_CLASSES = [
  "EQUITY",
  "FUND",
  "MONEY_MARKET_FUND",
  "TREASURY",
  "PRIVATE_CREDIT",
  "COMMODITY",
  "CASH",
  "OTHER",
] as const;
export const assetClassSchema = z.enum(ASSET_CLASSES);
export type AssetClass = z.infer<typeof assetClassSchema>;

/**
 * How a held quantity relates to economic value. A field on the identity record, never an input
 * to `instrumentId` — an instrument does not acquire a new identity because it rebased.
 */
export const INSTRUMENT_ACCOUNTING_MODES = [
  // spec/corporate-action-model.md §2. Names describe Usance semantics, not provider brands.
  "FIXED_UNIT", //          no corporate-action factor; stored == effective == credited
  "EXTERNALLY_SCALED", //   balanceOf() raw and stable; a separate multiplier() accessor (B20)
  "REBASING_BALANCE", //    balanceOf() itself is adjusted by the token (xStocks on EVM)
  "SHARE_BASED_CUSTODY", // the account holds Usance pool shares; effective tracks the pool
  "EXTERNALLY_MANAGED", //  partition/compliance-gated (Hedera ATS)
] as const;
export const instrumentAccountingModeSchema = z.enum(INSTRUMENT_ACCOUNTING_MODES);
export type InstrumentAccountingMode = z.infer<typeof instrumentAccountingModeSchema>;

export const LEGACY_ASSET_ID_KINDS = ["DERIVED", "FIXTURE_LABEL"] as const;
export const legacyAssetIdKindSchema = z.enum(LEGACY_ASSET_ID_KINDS);
export type LegacyAssetIdKind = z.infer<typeof legacyAssetIdKindSchema>;

// ---------------------------------------------------------------------------- normalisation

/** Trim, NFC, lower-case. The same rule `canonical.ts::issuerId` applies to a legal name. */
export function normalizeName(s: string): string {
  return s.trim().normalize("NFC").toLowerCase();
}

const ZERO32 = `0x${"00".repeat(32)}` as Hex32;

// ---------------------------------------------------------------------------- CAIP-2 / domain

export const caip2Schema = z
  .string()
  .transform((s) => s.trim().toLowerCase())
  .refine((s) => /^[a-z0-9]+:[a-zA-Z0-9._-]+$/.test(s), {
    message: "expected a CAIP-2 chain id, e.g. 'eip155:8453' or 'hedera:testnet'",
  });

export const domainSchema = z
  .object({
    caip2: caip2Schema,
    /** Human label for display. Not hashed. */
    label: z.string().min(1),
  })
  .strict()
  .transform((d) => ({ ...d, domainId: deriveDomainId(d.caip2) }));

export type Domain = z.infer<typeof domainSchema>;

// ---------------------------------------------------------------------------- issuer

export const issuerIdentitySchema = z
  .object({
    legalName: z.string().min(1),
    jurisdiction: z.string().min(1),
  })
  .strict()
  .transform((i) => ({
    ...i,
    issuerId: deriveIssuerId(i.legalName, i.jurisdiction),
  }));

export type IssuerIdentity = z.infer<typeof issuerIdentitySchema>;

// ---------------------------------------------------------------------------- underlying reference

export const underlyingReferenceSchema = z
  .object({
    assetClass: assetClassSchema,
    isin: z.string().default(""),
    figi: z.string().default(""),
    /** A hint. Never sufficient on its own — see the refine below. */
    ticker: z.string().default(""),
    name: z.string().default(""),
  })
  .strict()
  .superRefine((u, ctx) => {
    const anchored = [u.isin, u.figi, u.name].some((v) => v.trim() !== "");
    if (!anchored) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["ticker"],
        message:
          "a ticker alone does not identify an underlying; provide at least one of isin, figi or name",
      });
    }
  })
  .transform((u) => {
    const parts = {
      assetClass: u.assetClass,
      isin: u.isin.trim(),
      figi: u.figi.trim(),
      ticker: u.ticker.trim(),
      name: normalizeName(u.name),
    };
    return {
      ...u,
      underlyingReferenceId: deriveUnderlyingReferenceId(parts),
    };
  });

export type UnderlyingReference = z.infer<typeof underlyingReferenceSchema>;

// ---------------------------------------------------------------------------- canonical reference

export const canonicalRefSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("evm"), token: addressSchema }).strict(),
  z.object({ kind: z.literal("native"), nativeId: z.string().min(1) }).strict(),
  // The literal bytes32 that was used on chain. Only for a FIXTURE_LABEL legacy id, where no
  // token was ever deployed and the on-chain reference is a UTF-8 string packed into bytes32.
  z.object({ kind: z.literal("raw"), value: hex32Schema }).strict(),
]);

export function canonicalRefOf(ref: z.infer<typeof canonicalRefSchema>): Hex32 {
  switch (ref.kind) {
    case "evm":
      return evmCanonicalRef(ref.token);
    case "native":
      return nativeCanonicalRef(ref.nativeId);
    case "raw":
      return ref.value;
  }
}

// ---------------------------------------------------------------------------- instrument identity

export const instrumentIdentitySchema = z
  .object({
    domain: domainSchema,
    canonicalRef: canonicalRefSchema,
    issuer: issuerIdentitySchema,
    standard: instrumentStandardSchema,
    /** uint32, starts at 1. Bumped only on a genuine identity change (§5). */
    instrumentVersion: z.number().int().min(1).max(0xffffffff),
    underlying: underlyingReferenceSchema,
    accountingMode: instrumentAccountingModeSchema,
  })
  .strict()
  .superRefine((i, ctx) => {
    // Each corporate-action-capable standard has a specific accounting mode — spec/corporate-action-model.md §2.
    // B20 keeps balanceOf() raw and exposes a separate multiplier; xStocks adjusts balanceOf() itself.
    if (i.standard === "B20" && i.accountingMode !== "EXTERNALLY_SCALED") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["accountingMode"],
        message:
          "B20 keeps balanceOf() raw and exposes a separate WAD multiplier; it must be EXTERNALLY_SCALED",
      });
    }
    if (
      i.standard === "XSTOCKS_TRACKER_CERT" &&
      i.accountingMode !== "REBASING_BALANCE" &&
      i.accountingMode !== "SHARE_BASED_CUSTODY"
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["accountingMode"],
        message:
          "xStocks adjusts balanceOf() itself; custody it as REBASING_BALANCE or the SHARE_BASED_CUSTODY V2 path",
      });
    }
    if (i.standard === "ATS_ERC1400" && i.accountingMode !== "EXTERNALLY_MANAGED") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["accountingMode"],
        message: "an ATS security is gated by an external partition/compliance system",
      });
    }
  })
  .transform((i) => {
    const standardId = deriveInstrumentStandardId(i.standard);
    const canonicalRef = canonicalRefOf(i.canonicalRef);
    return {
      ...i,
      instrumentStandardId: standardId,
      canonicalRefHex: canonicalRef,
      instrumentId: deriveInstrumentId({
        domainId: i.domain.domainId,
        canonicalRef,
        issuerId: i.issuer.issuerId,
        instrumentStandardId: standardId,
        instrumentVersion: i.instrumentVersion,
      }),
    };
  });

export type InstrumentIdentity = z.infer<typeof instrumentIdentitySchema>;

// ---------------------------------------------------------------------------- binding

/**
 * `legacyAssetId → instrumentId`, an explicit provenance-bearing record. Never a reinterpretation
 * of the old `bytes32`. `spec/identity-model.md §3`.
 */
export const instrumentBindingSchema = z
  .object({
    bindingId: hex32Schema,
    legacyAssetId: hex32Schema,
    legacyAssetIdKind: legacyAssetIdKindSchema,
    instrumentId: hex32Schema,
    boundAt: z.number().int().min(0),
    boundAtBlock: z.number().int().min(0),
    boundBy: z.string().min(1),
    boundAtDomain: caip2Schema,
    deploymentDigest: z.string().min(1),
    /** Prior bindingId, or 32 zero bytes for the first binding of this legacyAssetId. */
    supersedes: hex32Schema,
    note: z.string().min(1),
  })
  .strict();

export type InstrumentBinding = z.infer<typeof instrumentBindingSchema>;

/** The `$provenance` block every generated artifact in this repo carries (`scripts/_artifact.mjs`). */
export const artifactProvenanceSchema = z
  .object({
    generatedAt: z.string().min(1),
    generatedBy: z.string().min(1),
    gitCommit: z.string().min(1),
    chainId: z.number().int().optional(),
    deploymentDigest: z.string().nullable().optional(),
    inputDigest: z.string().min(1),
    schema: z.literal(1),
  })
  .passthrough();

export const instrumentBindingsArtifactSchema = z
  .object({
    $provenance: artifactProvenanceSchema,
    instruments: z.array(instrumentIdentityRecordSchema()),
    bindings: z.array(instrumentBindingSchema).min(1),
  })
  .strict()
  .superRefine((a, ctx) => {
    const instrumentIds = new Set(a.instruments.map((x) => x.instrumentId));
    const seenBindingIds = new Set<string>();
    const byLegacy = new Map<string, InstrumentBinding[]>();

    for (const [idx, b] of a.bindings.entries()) {
      if (!instrumentIds.has(b.instrumentId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["bindings", idx, "instrumentId"],
          message: "binding references an instrumentId not present in `instruments`",
        });
      }
      if (seenBindingIds.has(b.bindingId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["bindings", idx, "bindingId"],
          message: "duplicate bindingId",
        });
      }
      seenBindingIds.add(b.bindingId);
      const list = byLegacy.get(b.legacyAssetId) ?? [];
      list.push(b);
      byLegacy.set(b.legacyAssetId, list);
    }

    // Exactly one root (supersedes == 0) per legacyAssetId, and the rest must chain to a known
    // bindingId for the same legacyAssetId.
    for (const [legacy, list] of byLegacy) {
      const roots = list.filter((b) => b.supersedes === ZERO32);
      if (roots.length !== 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["bindings"],
          message: `legacyAssetId ${legacy} must have exactly one root binding, found ${roots.length}`,
        });
      }
      const ids = new Set(list.map((b) => b.bindingId));
      for (const b of list) {
        if (b.supersedes !== ZERO32 && !ids.has(b.supersedes)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["bindings"],
            message: `binding ${b.bindingId} supersedes an unknown binding for the same legacyAssetId`,
          });
        }
      }
    }
  });

export type InstrumentBindingsArtifact = z.infer<typeof instrumentBindingsArtifactSchema>;

/**
 * The instrument identity as it is stored in the artifact: the human inputs plus every derived id,
 * so a reader can recompute and check every one without re-deriving from scratch.
 */
function instrumentIdentityRecordSchema() {
  return z
    .object({
      instrumentId: hex32Schema,
      domainId: hex32Schema,
      caip2: caip2Schema,
      canonicalRef: hex32Schema,
      canonicalRefKind: z.enum(["evm", "native", "raw"]),
      token: addressSchema.optional(),
      nativeId: z.string().optional(),
      issuerId: hex32Schema,
      issuerLegalName: z.string().min(1),
      issuerJurisdiction: z.string().min(1),
      instrumentStandard: instrumentStandardSchema,
      instrumentStandardId: hex32Schema,
      instrumentVersion: z.number().int().min(1),
      underlyingReferenceId: hex32Schema,
      underlying: z
        .object({
          assetClass: assetClassSchema,
          isin: z.string(),
          figi: z.string(),
          ticker: z.string(),
          name: z.string(),
        })
        .strict(),
      accountingMode: instrumentAccountingModeSchema,
    })
    .strict();
}

// ---------------------------------------------------------------------------- resolution

export interface ResolvedInstrument {
  legacyAssetId: Hex32;
  instrumentId: Hex32;
  /** Ordered oldest → newest for this legacyAssetId. */
  chain: InstrumentBinding[];
  active: InstrumentBinding;
}

/**
 * Resolve a legacy `assetId` to its instrument identity through the binding chain.
 *
 * `at` (unix seconds) selects the binding that was active then; omitted, it returns the newest.
 * Returns null for an unknown `assetId` — an unrecognised id is not an error, it is an id we have
 * not bound yet.
 */
export function resolveInstrument(
  bindings: readonly InstrumentBinding[],
  legacyAssetId: Hex32,
  at?: number,
): ResolvedInstrument | null {
  const want = legacyAssetId.toLowerCase();
  const chain = bindings
    .filter((b) => b.legacyAssetId.toLowerCase() === want)
    .sort((a, b) => a.boundAt - b.boundAt);
  if (chain.length === 0) return null;

  let active = chain[chain.length - 1]!;
  if (at !== undefined) {
    const eligible = chain.filter((b) => b.boundAt <= at);
    // Before the first binding, the earliest one is still the best available identity.
    active = eligible.length > 0 ? eligible[eligible.length - 1]! : chain[0]!;
  }
  return { legacyAssetId: want as Hex32, instrumentId: active.instrumentId, chain, active };
}

import { z } from "zod";
import { addressSchema, hex32Schema, type Hex32 } from "./primitives";
import { artifactProvenanceSchema, caip2Schema, type InstrumentIdentity } from "./instrument";
import {
  domainId as deriveDomainId,
  evmCanonicalRef,
  facilityId as deriveFacilityId,
  nativeCanonicalRef,
} from "./ids";
import type { PassportCandidate } from "./passport";

/**
 * `spec/facility-model.md`.
 *
 * A `FacilityDescriptor` is immutable-once-active metadata. It owns no financial state — the
 * `FacilityImplementation` (today `ClearingHouse` for revolving credit) does. Home domain and
 * controller are inputs to `facilityId`, so this schema does not need — and must not have — a
 * `setHomeDomain`: a different home domain is a different facility (invariant I-75).
 */

// ---------------------------------------------------------------------------- vocabularies

export const FACILITY_TYPES = [
  "REVOLVING_CREDIT",
  "TERM_SECURED_CREDIT",
  "REPO",
  "SECURITIES_LENDING",
  "COLLATERAL_ONLY",
] as const;
export const facilityTypeSchema = z.enum(FACILITY_TYPES);
export type FacilityType = z.infer<typeof facilityTypeSchema>;

export const FACILITY_STATUSES = [
  "DRAFT",
  "PENDING_ACTIVATION",
  "ACTIVE",
  "SUSPENDED",
  "SETTLING",
  "SETTLED",
  "MIGRATED",
] as const;
export const facilityStatusSchema = z.enum(FACILITY_STATUSES);
export type FacilityStatus = z.infer<typeof facilityStatusSchema>;

/** Statuses at or past which identity-bearing fields are frozen. */
const ACTIVATED_STATUSES: ReadonlySet<FacilityStatus> = new Set([
  "ACTIVE",
  "SUSPENDED",
  "SETTLING",
  "SETTLED",
  "MIGRATED",
]);

// ---------------------------------------------------------------------------- controller reference

export const controllerRefSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("evm"), address: addressSchema }).strict(),
  z.object({ kind: z.literal("native"), nativeId: z.string().min(1) }).strict(),
]);

export function controllerRefOf(ref: z.infer<typeof controllerRefSchema>): Hex32 {
  return ref.kind === "evm" ? evmCanonicalRef(ref.address) : nativeCanonicalRef(ref.nativeId);
}

// ---------------------------------------------------------------------------- descriptor

export const capitalFacilityDescriptorSchema = z
  .object({
    facilityType: facilityTypeSchema,
    homeDomainCaip2: caip2Schema,
    controller: controllerRefSchema,
    /** Distinguishes facilities sharing (type, domain, controller). Revolving-credit: settlement assetId. */
    discriminator: hex32Schema,
    settlementAssetId: hex32Schema,
    status: facilityStatusSchema,
    /** Contracts that make up the FacilityImplementation, for the read facade. Descriptive only. */
    implementation: z.array(z.string().min(1)).default([]),
    /** Set only on a MIGRATED facility. Points at the facilityId that replaced it. */
    migratedTo: hex32Schema.nullable().default(null),
    note: z.string().default(""),
  })
  .strict()
  .superRefine((d, ctx) => {
    if (d.status === "MIGRATED" && d.migratedTo === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["migratedTo"],
        message: "a MIGRATED facility must point at the facilityId that replaced it",
      });
    }
    if (d.status !== "MIGRATED" && d.migratedTo !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["migratedTo"],
        message: "migratedTo is only meaningful on a MIGRATED facility",
      });
    }
  })
  .transform((d) => {
    const controller = controllerRefOf(d.controller);
    const homeDomainId = deriveDomainId(d.homeDomainCaip2);
    return {
      ...d,
      controllerRef: controller,
      homeDomainId,
      facilityId: deriveFacilityId({
        facilityType: d.facilityType,
        homeDomainId,
        controller,
        discriminator: d.discriminator,
      }),
    };
  });

export type CapitalFacilityDescriptor = z.infer<typeof capitalFacilityDescriptorSchema>;

// ---------------------------------------------------------------------------- transition guard

export interface FacilityTransitionResult {
  ok: boolean;
  reasons: string[];
}

/**
 * `assertValidFacilityTransition` — invariant I-75.
 *
 * Once a facility is ACTIVE (or later), its identity-bearing fields are frozen: `facilityType`,
 * `homeDomainCaip2`, `controller` and therefore `facilityId`. Moving a live facility across
 * domains is a deliberate migration (new identity, old preserved), never an edit.
 */
export function assertValidFacilityTransition(
  prev: CapitalFacilityDescriptor,
  next: CapitalFacilityDescriptor,
): FacilityTransitionResult {
  const reasons: string[] = [];
  if (ACTIVATED_STATUSES.has(prev.status)) {
    if (next.facilityType !== prev.facilityType) reasons.push("facilityType is frozen once ACTIVE");
    if (next.homeDomainCaip2 !== prev.homeDomainCaip2) {
      reasons.push("homeDomain is frozen once ACTIVE — a different home domain is a different facility");
    }
    if (next.controllerRef !== prev.controllerRef) {
      reasons.push("controller is frozen once ACTIVE — a redeployed controller is a migration");
    }
    if (next.facilityId !== prev.facilityId) reasons.push("facilityId cannot change on a live facility");
    if (prev.status === "SETTLED" && next.status !== "SETTLED") {
      reasons.push("SETTLED is terminal");
    }
    if (prev.status === "MIGRATED" && next.status !== "MIGRATED") {
      reasons.push("MIGRATED is terminal");
    }
  }
  return { ok: reasons.length === 0, reasons };
}

// ---------------------------------------------------------------------------- admission profile

export const ADMISSION_PROFILES = ["LEGACY_V1", "MULTI_DOMAIN_V2"] as const;
export const admissionProfileSchema = z.enum(ADMISSION_PROFILES);
export type AdmissionProfile = z.infer<typeof admissionProfileSchema>;

export interface IdentityCompletenessResult {
  ok: boolean;
  profile: AdmissionProfile;
  reasons: string[];
}

/**
 * `assertInstrumentIdentityComplete` — `facility-model.md §6`, invariant I-77.
 *
 * `LEGACY_V1` (the deployed X Layer path) always passes; the Passport Identity section is optional.
 * `MULTI_DOMAIN_V2` (Base / X Layer production / Hedera) requires the candidate to carry a
 * complete Identity section that agrees with the resolved `InstrumentIdentity`. Because
 * `instrument` is a parsed `InstrumentIdentity`, its underlying is already guaranteed non-ticker-only
 * and its domain / issuer / standard are real.
 *
 * Returns a decision. It grants nothing — completeness is necessary for MULTI_DOMAIN_V2 admission,
 * never sufficient (the capability decision stays with admission / RiskPolicy).
 */
export function assertInstrumentIdentityComplete(
  candidate: Pick<PassportCandidate, "identity">,
  instrument: Pick<
    InstrumentIdentity,
    "instrumentId" | "domain" | "issuer" | "standard" | "instrumentVersion" | "accountingMode"
  >,
  profile: AdmissionProfile,
): IdentityCompletenessResult {
  const reasons: string[] = [];
  if (profile === "LEGACY_V1") return { ok: true, profile, reasons };

  const id = candidate.identity;
  if (!id) {
    reasons.push("MULTI_DOMAIN_V2 requires the Passport Identity section");
    return { ok: false, profile, reasons };
  }
  if (id.instrumentId.toLowerCase() !== instrument.instrumentId.toLowerCase()) {
    reasons.push("identity section instrumentId does not match the resolved instrument");
  }
  if (id.domainId.toLowerCase() !== instrument.domain.domainId.toLowerCase()) {
    reasons.push("identity section domainId disagrees with the resolved instrument");
  }
  if (id.issuerId.toLowerCase() !== instrument.issuer.issuerId.toLowerCase()) {
    reasons.push("identity section issuerId disagrees with the resolved instrument");
  }
  if (id.instrumentStandard !== instrument.standard) {
    reasons.push("identity section instrumentStandard disagrees with the resolved instrument");
  }
  if (id.instrumentVersion !== instrument.instrumentVersion) {
    reasons.push("identity section instrumentVersion disagrees with the resolved instrument");
  }
  if (id.accountingMode !== instrument.accountingMode) {
    reasons.push("identity section accountingMode disagrees with the resolved instrument");
  }
  return { ok: reasons.length === 0, profile, reasons };
}

// ---------------------------------------------------------------------------- descriptors artifact

const facilityDescriptorRecordSchema = z
  .object({
    facilityId: hex32Schema,
    facilityType: facilityTypeSchema,
    homeDomainCaip2: caip2Schema,
    homeDomainId: hex32Schema,
    controllerRef: hex32Schema,
    controllerAddress: addressSchema.optional(),
    controllerNativeId: z.string().optional(),
    discriminator: hex32Schema,
    settlementAssetId: hex32Schema,
    status: facilityStatusSchema,
    implementation: z.array(z.string()),
    migratedTo: hex32Schema.nullable(),
    note: z.string(),
  })
  .strict();

export const facilityDescriptorsArtifactSchema = z
  .object({
    $provenance: artifactProvenanceSchema,
    domains: z.array(domainDescriptorRecordSchema()).min(1),
    facilities: z.array(facilityDescriptorRecordSchema).min(1),
  })
  .strict()
  .superRefine((a, ctx) => {
    const domainIds = new Set(a.domains.map((d) => d.domainId.toLowerCase()));
    const seenFacilityIds = new Set<string>();
    for (const [i, f] of a.facilities.entries()) {
      if (!domainIds.has(f.homeDomainId.toLowerCase())) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["facilities", i, "homeDomainId"],
          message: "facility home domain is not present in `domains`",
        });
      }
      if (seenFacilityIds.has(f.facilityId.toLowerCase())) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["facilities", i, "facilityId"],
          message: "duplicate facilityId — a descriptor is registered twice",
        });
      }
      seenFacilityIds.add(f.facilityId.toLowerCase());
    }
  });

export type FacilityDescriptorsArtifact = z.infer<typeof facilityDescriptorsArtifactSchema>;

function domainDescriptorRecordSchema() {
  return z
    .object({
      domainId: hex32Schema,
      caip2: caip2Schema,
      label: z.string().min(1),
      environment: z.enum(["PRODUCTION", "TESTNET", "LOCAL"]),
      finalityModel: z
        .object({
          kind: z.enum(["l2-sequencer", "pos", "hashgraph", "other"]),
          safeDepthBlocks: z.number().int().min(0),
          notes: z.string(),
        })
        .strict(),
      nativeAsset: z
        .object({ symbol: z.string().min(1), decimals: z.number().int().min(0).max(36) })
        .strict(),
      explorerUrl: z.string().min(1),
      adapterVersions: z.record(z.string(), z.string()),
      status: z.enum(["ACTIVE", "PAUSED", "RETIRED"]),
    })
    .strict();
}

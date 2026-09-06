import { z } from "zod";
import { caip2Schema } from "./instrument";
import { domainId as deriveDomainId } from "./ids";

/**
 * `DomainDescriptor` — `spec/facility-model.md §3`.
 *
 * Metadata about a chain/environment. Registering one grants **no** financial capability: no asset
 * admission, no collateral, no borrowing, no transport authorisation, no venue authorisation, no
 * oracle trust (invariant I-76). There is deliberately no `capabilities` / `admitted` / `trusted`
 * field on this schema — a domain descriptor answers "what is this chain and how final is it",
 * nothing more. Financial trust is a separate admission / RiskPolicy / adapter-registration
 * decision, each with its own authority.
 */

export const DOMAIN_ENVIRONMENTS = ["PRODUCTION", "TESTNET", "LOCAL"] as const;
export const domainEnvironmentSchema = z.enum(DOMAIN_ENVIRONMENTS);
export type DomainEnvironment = z.infer<typeof domainEnvironmentSchema>;

export const FINALITY_KINDS = ["l2-sequencer", "pos", "hashgraph", "other"] as const;
export const finalityModelSchema = z
  .object({
    kind: z.enum(FINALITY_KINDS),
    /** Blocks (or rounds) an observation must be buried under before the read model treats it as safe. */
    safeDepthBlocks: z.number().int().min(0),
    notes: z.string().default(""),
  })
  .strict();
export type FinalityModel = z.infer<typeof finalityModelSchema>;

export const DOMAIN_STATUSES = ["ACTIVE", "PAUSED", "RETIRED"] as const;
export const domainStatusSchema = z.enum(DOMAIN_STATUSES);
export type DomainStatus = z.infer<typeof domainStatusSchema>;

export const domainDescriptorSchema = z
  .object({
    caip2: caip2Schema,
    label: z.string().min(1),
    environment: domainEnvironmentSchema,
    finalityModel: finalityModelSchema,
    nativeAsset: z
      .object({ symbol: z.string().min(1), decimals: z.number().int().min(0).max(36) })
      .strict(),
    explorerUrl: z.string().min(1),
    /** Versions of the adapters wired for this domain. Absent = not wired; never implies trust. */
    adapterVersions: z
      .object({
        instrument: z.string().optional(),
        oracle: z.string().optional(),
        cashTransport: z.string().optional(),
        venue: z.string().optional(),
      })
      .strict()
      .default({}),
    status: domainStatusSchema,
  })
  .strict()
  .transform((d) => ({ ...d, domainId: deriveDomainId(d.caip2) }));

export type DomainDescriptor = z.infer<typeof domainDescriptorSchema>;

/**
 * The set of things a domain descriptor is NOT allowed to imply, listed so a test can assert the
 * schema never grows a field that would let registration alone confer one of them.
 */
export const DOMAIN_DESCRIPTOR_GRANTS_NOTHING = [
  "assetAdmission",
  "collateralCapability",
  "borrowingAuthority",
  "cashTransportAuthorisation",
  "venueAuthorisation",
  "oracleTrust",
] as const;

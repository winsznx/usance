import {
  instrumentBindingsArtifactSchema,
  resolveInstrument,
  type Hex32,
  type InstrumentBinding,
  type InstrumentBindingsArtifact,
} from "@usance/schemas";

/**
 * The indexer's view of instrument identity.
 *
 * The deployed contracts and every existing projection stay keyed by `assetId = H(chainId, token)`.
 * This resolves that financial key to the exact instrument it names — issuer, domain, standard,
 * version — and to the home domain a facility on that instrument would settle on. It reads the
 * generated `deployments/instrument-bindings.json` and adds nothing the artifact does not already
 * carry (spec/identity-model.md §7).
 *
 * An unknown `assetId` returns null. An id we have not bound yet is not an error.
 */

export interface InstrumentRecord {
  readonly instrumentId: Hex32;
  readonly domainId: Hex32;
  readonly caip2: string;
  readonly issuerId: Hex32;
  readonly issuerLegalName: string;
  readonly instrumentStandard: string;
  readonly instrumentVersion: number;
  readonly underlyingReferenceId: Hex32;
  readonly accountingMode: string;
}

export interface ResolvedAssetIdentity {
  readonly legacyAssetId: Hex32;
  readonly instrumentId: Hex32;
  /** The binding active for the requested point in time (or the newest). */
  readonly binding: InstrumentBinding;
  /** Oldest → newest binding chain for this legacy id. */
  readonly chain: readonly InstrumentBinding[];
  readonly instrument: InstrumentRecord;
  readonly caip2: string;
}

export class InstrumentBindings {
  private readonly bindings: readonly InstrumentBinding[];
  private readonly byInstrumentId: ReadonlyMap<string, InstrumentRecord>;

  private constructor(artifact: InstrumentBindingsArtifact) {
    this.bindings = artifact.bindings;
    this.byInstrumentId = new Map(
      artifact.instruments.map((i) => [
        i.instrumentId.toLowerCase(),
        {
          instrumentId: i.instrumentId,
          domainId: i.domainId,
          caip2: i.caip2,
          issuerId: i.issuerId,
          issuerLegalName: i.issuerLegalName,
          instrumentStandard: i.instrumentStandard,
          instrumentVersion: i.instrumentVersion,
          underlyingReferenceId: i.underlyingReferenceId,
          accountingMode: i.accountingMode,
        },
      ]),
    );
  }

  /** Parse and validate an artifact object (already read from disk by the caller). */
  static fromArtifact(raw: unknown): InstrumentBindings {
    return new InstrumentBindings(instrumentBindingsArtifactSchema.parse(raw));
  }

  /**
   * Resolve a legacy `assetId` to its instrument identity.
   *
   * `at` (unix seconds) selects the binding active then — a Passport committed under an earlier
   * identity resolves to that identity, not the current one. Returns null for an unbound id.
   */
  resolve(assetId: Hex32, at?: number): ResolvedAssetIdentity | null {
    const r = resolveInstrument(this.bindings, assetId, at);
    if (!r) return null;
    const instrument = this.byInstrumentId.get(r.instrumentId.toLowerCase());
    if (!instrument) return null; // schema guarantees this cannot happen; keep the type honest
    return {
      legacyAssetId: r.legacyAssetId,
      instrumentId: r.instrumentId,
      binding: r.active,
      chain: r.chain,
      instrument,
      caip2: instrument.caip2,
    };
  }

  /** The CAIP-2 home domain for an instrument — where a facility on it settles. */
  homeDomain(instrumentId: Hex32): string | null {
    return this.byInstrumentId.get(instrumentId.toLowerCase())?.caip2 ?? null;
  }

  instrument(instrumentId: Hex32): InstrumentRecord | null {
    return this.byInstrumentId.get(instrumentId.toLowerCase()) ?? null;
  }

  all(): readonly InstrumentRecord[] {
    return [...this.byInstrumentId.values()];
  }
}

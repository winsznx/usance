import {
  facilityDescriptorsArtifactSchema,
  facilityPositionId as deriveFacilityPositionId,
  type FacilityDescriptorsArtifact,
  type Hex32,
} from "@usance/schemas";
import { InstrumentBindings } from "./instrument";

/**
 * `FacilityReadModel` — `spec/facility-model.md §5, §8`.
 *
 * The indexer's derived view of a facility and the positions within it. It reads the generated
 * `deployments/facility-descriptors.json` and resolves account state into a shape that carries
 * provenance on every figure. It owns no financial state and is read by no contract (invariant
 * I-79): a stale or unreachable domain can only restrict a usable figure, never inflate one.
 */

export type Finality = "safe" | "stale" | "unknown";

export interface FacilityDomainView {
  caip2: string;
  label: string;
  environment: string;
  safeDepthBlocks: number;
  status: string;
}

export interface FacilityView {
  facilityId: Hex32;
  facilityType: string;
  homeDomain: string;
  controller: string | null;
  settlementAssetId: Hex32;
  status: string;
}

export interface PositionInstrument {
  legacyAssetId: Hex32;
  instrumentId: Hex32 | null;
  homeDomain: string | null;
  /** Raw usable figure the caller supplied for this holding, in usd18. Provenance travels with it. */
  recognizedUsd18: bigint;
}

export interface FacilityPositionView {
  facilityId: Hex32;
  positionId: Hex32;
  homeDomain: string;
  controller: string | null;
  instruments: PositionInstrument[];
  observedAtBlock: number;
  finality: Finality;
  /**
   * True when the position's domain state is stale/unknown, so its figures are shown but excluded
   * from any usable total. This is I-07 carried onto the cross-domain surface.
   */
  usableRestricted: boolean;
}

export class FacilityDescriptors {
  private readonly byFacilityId: ReadonlyMap<string, FacilityView & { discriminator: Hex32 }>;
  private readonly byDomain: ReadonlyMap<string, FacilityDomainView>;

  private constructor(artifact: FacilityDescriptorsArtifact) {
    this.byDomain = new Map(
      artifact.domains.map((d) => [
        d.caip2,
        {
          caip2: d.caip2,
          label: d.label,
          environment: d.environment,
          safeDepthBlocks: d.finalityModel.safeDepthBlocks,
          status: d.status,
        },
      ]),
    );
    this.byFacilityId = new Map(
      artifact.facilities.map((f) => [
        f.facilityId.toLowerCase(),
        {
          facilityId: f.facilityId,
          facilityType: f.facilityType,
          homeDomain: f.homeDomainCaip2,
          controller: f.controllerAddress ?? f.controllerNativeId ?? null,
          settlementAssetId: f.settlementAssetId,
          status: f.status,
          discriminator: f.discriminator,
        },
      ]),
    );
  }

  static fromArtifact(raw: unknown): FacilityDescriptors {
    return new FacilityDescriptors(facilityDescriptorsArtifactSchema.parse(raw));
  }

  facility(facilityId: Hex32): (FacilityView & { discriminator: Hex32 }) | null {
    return this.byFacilityId.get(facilityId.toLowerCase()) ?? null;
  }

  domain(caip2: string): FacilityDomainView | null {
    return this.byDomain.get(caip2) ?? null;
  }

  facilities(): FacilityView[] {
    return [...this.byFacilityId.values()];
  }

  /**
   * Build a position view for one account against one facility.
   *
   * `heldAssets` is the caller's read of the account's holdings and each recognised value — the
   * indexer does not recompute risk, it presents it with provenance. `observedAtBlock` and
   * `headBlock` decide finality against the domain's safe depth.
   */
  positionView(
    facilityId: Hex32,
    accountId: Hex32,
    heldAssets: ReadonlyArray<{ legacyAssetId: Hex32; recognizedUsd18: bigint }>,
    bindings: InstrumentBindings,
    ctx: { observedAtBlock: number; headBlock: number | null },
  ): FacilityPositionView | null {
    const facility = this.facility(facilityId);
    if (!facility) return null;
    const domain = this.domain(facility.homeDomain);

    let finality: Finality;
    if (ctx.headBlock === null) {
      finality = "unknown";
    } else if (ctx.headBlock - ctx.observedAtBlock >= (domain?.safeDepthBlocks ?? Infinity)) {
      finality = "safe";
    } else {
      finality = "stale";
    }

    const instruments: PositionInstrument[] = heldAssets.map((h) => {
      const r = bindings.resolve(h.legacyAssetId);
      return {
        legacyAssetId: h.legacyAssetId,
        instrumentId: r?.instrumentId ?? null,
        homeDomain: r?.caip2 ?? null,
        recognizedUsd18: h.recognizedUsd18,
      };
    });

    return {
      facilityId: facility.facilityId,
      positionId: deriveFacilityPositionId(facility.facilityId, accountId),
      homeDomain: facility.homeDomain,
      controller: facility.controller,
      instruments,
      observedAtBlock: ctx.observedAtBlock,
      finality,
      usableRestricted: finality !== "safe",
    };
  }
}

export interface PortfolioAggregate {
  /** Sum of recognised value across positions whose domain state is `safe`. usd18. */
  usableRecognizedUsd18: bigint;
  /** Positions whose figures are shown but NOT counted toward `usableRecognizedUsd18`. */
  restricted: FacilityPositionView[];
  perDomain: Array<{ homeDomain: string; finality: Finality; recognizedUsd18: bigint; counted: boolean }>;
  note: string;
}

/**
 * Aggregate positions across domains into one organisational view — `spec/facility-model.md §8`,
 * invariant I-79.
 *
 * A stale or unknown domain position is listed in `restricted` and its value is never added to
 * `usableRecognizedUsd18`. Stale state can only restrict.
 */
export function aggregatePortfolio(positions: readonly FacilityPositionView[]): PortfolioAggregate {
  let usable = 0n;
  const restricted: FacilityPositionView[] = [];
  const perDomain: PortfolioAggregate["perDomain"] = [];

  for (const p of positions) {
    const positionValue = p.instruments.reduce((s, i) => s + i.recognizedUsd18, 0n);
    const counted = p.finality === "safe";
    if (counted) usable += positionValue;
    else restricted.push(p);
    perDomain.push({
      homeDomain: p.homeDomain,
      finality: p.finality,
      recognizedUsd18: positionValue,
      counted,
    });
  }

  const staleCount = restricted.length;
  return {
    usableRecognizedUsd18: usable,
    restricted,
    perDomain,
    note:
      staleCount === 0
        ? "all domain state is confirmed"
        : `${staleCount} position(s) on stale or unreachable domains are shown but excluded from usable capital`,
  };
}

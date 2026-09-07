import bindings from "../../../deployments/instrument-bindings.json";

/**
 * The Phase 01 forward resolution: a live `assetId` used in calldata, mapped to the instrument
 * identity it was bound to.
 *
 * This is display-only. The compatibility boundary the Product Lock draws is that transactions
 * still carry the legacy `assetId` — the `instrumentId` is what the asset *is*, not what you send.
 * Nothing here is read from a contract; the binding file is a signed provenance record generated
 * by `scripts/gen-instrument-bindings.mjs`, and the digests in `$provenance` tie it to a
 * deployment.
 */

export interface InstrumentUnderlying {
  assetClass: string;
  isin: string;
  figi: string;
  ticker: string;
  name: string;
}

export interface InstrumentIdentity {
  instrumentId: string;
  domainId: string;
  caip2: string;
  canonicalRef: string;
  canonicalRefKind: string;
  token?: string;
  issuerId: string;
  issuerLegalName: string;
  issuerJurisdiction: string;
  instrumentStandard: string;
  instrumentVersion: number;
  underlying: InstrumentUnderlying;
  accountingMode: string;
}

export interface InstrumentBinding {
  bindingId: string;
  legacyAssetId: string;
  legacyAssetIdKind: string;
  instrumentId: string;
  boundAt: number;
  boundBy: string;
  boundAtDomain: string;
  supersedes: string;
  note: string;
}

export interface ResolvedInstrument {
  binding: InstrumentBinding;
  instrument: InstrumentIdentity;
  provenance: { generatedAt: string; gitCommit: string; chainId: number; deploymentDigest: string };
}

interface BindingsFile {
  $provenance: ResolvedInstrument["provenance"];
  instruments: InstrumentIdentity[];
  bindings: InstrumentBinding[];
}

const file = bindings as unknown as BindingsFile;

function normalise(id: string): string {
  return id.toLowerCase();
}

export function resolveBinding(legacyAssetId: string): ResolvedInstrument | null {
  const want = normalise(legacyAssetId);
  const binding = file.bindings.find((b) => normalise(b.legacyAssetId) === want);
  if (!binding) return null;
  const instrument = file.instruments.find((i) => normalise(i.instrumentId) === normalise(binding.instrumentId));
  if (!instrument) return null;
  return { binding, instrument, provenance: file.$provenance };
}

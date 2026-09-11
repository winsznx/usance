# Valuation readiness: two independent stale-price blockers

A collateral substitution's `releaseOld` depends on two separate oracle inputs on
`InstitutionalFacility`, and either one being stale blocks release independently of the other:

1. **Settlement price freshness** — `FacilityValuation.toUsd18` reverts `PriceUnusable` if the
   settlement asset's `HederaTestOracleAdapter` price is older than `terms.settlementMaxPriceAge`.
2. **Replacement collateral price freshness** — `RiskMath.assetGates`, called from
   `FacilityValuation.recognisedValue`, zeroes the recognised value (and therefore fails
   `CoverageFailed`) if the replacement asset's own price is older than its registered risk
   policy's `maxOracleAge` (`RiskPolicyRegistry.getParams(asset.riskPolicyId).maxOracleAge`).

These are read from the same `HederaTestOracleAdapter`, keyed by different `assetId`s, and staled
independently — refreshing one does nothing for the other.

## What happened live

The Phase 11B-D live substitution proof hit both, one after the other, in the same operation:

- First `releaseOld` attempt reverted `PriceUnusable(settlementAssetId)` — the settlement mark was
  ~377,000s old against a 172,800s max age.
- After refreshing only the settlement mark and completing a second request/commit cycle,
  `releaseOld` reverted again — this time `CoverageFailed(owedUsd18, recognisedUsd18=0)` — because
  the replacement collateral's own mark was independently stale (~380,000s old), never touched by
  the first refresh.

Existing collateral (Series A) remained fully secured through both blocks — release simply never
executed.

## Product fix

`apps/web/lib/institutional-valuation-readiness.ts` exposes both inputs separately:

```ts
type PriceInputReadiness = {
  status: "READY" | "STALE" | "UNAVAILABLE" | "UNKNOWN";
  assetId; price; updatedAt; ageSeconds; maxAgeSeconds; source; provenance;
};
type ValuationReadiness = {
  settlementPrice: PriceInputReadiness;
  replacementCollateralPrice: PriceInputReadiness;
  allInputsReady: boolean; // preparation signal only
};
```

Wired into `institutional-substitution-readiness.ts`'s `valuation` field, and folded into the
`REPLACEMENT_UNSAFE` outcome with a distinct blocking reason per stale input.

`allInputsReady` is a **preparation** signal, not a release-eligibility claim. The UI must not
present it as such — see `finalFinancialSafety.note`. `InstitutionalFacility.releaseOld`'s own
simulation remains the sole financial authority; this module only makes visible, ahead of time,
what the facility already checks, so an operator isn't surprised by a second stale-price block
right after fixing the first.

## Generalization

Any future collateral type or additional valuation input the facility gates on should get its own
named `PriceInputReadiness` entry here rather than being folded into a single generic "oracle
ready" boolean — that collapse is exactly what hid the second blocker until release time.

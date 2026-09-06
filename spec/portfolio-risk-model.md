# spec/portfolio-risk-model.md — portfolio risk

Status: **frozen**. Additive to a live deployment. Reference model and fixtures are new; the
deployed core is not touched (§9). Changing a composition rule, a dimension, or a rounding
direction here once a fixture is committed is an RFC in `spec/rfcs/`.

This document answers one narrow question: **given several exact tokenized instruments whose
individual recognised values are already known, what is the maximum portfolio collateral value
Usance may conservatively recognise after shared issuer / underlying / custody / sector / liquidity
/ market-session risk?**

The portfolio layer may **reduce or cap**. It never invents collateral value. There is **no
diversification bonus** in the launch model (`DECISIONS.md` D-024).

---

## 1. Where it sits

```
Instrument → Asset Passport → market/liquidity/redemption/evidence policy
          → SingleInstrumentRecognizedValue          (RiskMath.sol §4.5, then §4.6 concentration)
          → Portfolio Risk  (this document)
          → PortfolioRecognizedValue
```

The portfolio model **consumes** `RiskResult.cappedUsd18` per instrument — the value RiskMath
already produced after the per-instrument `maxConcentrationBps` cap (`accounting.md §4.6`). It does
**not** re-decide token price, oracle freshness, redemption eligibility, document truth, base
haircuts or the per-instrument concentration cap. It reuses the deterministic engine's output.

Corporate-action state enters through the normal path only: Phase 03 accounting produces the
effective/credited quantity → single-asset risk consumes it → portfolio risk consumes the
resulting recognised position. One chain of truth, no second corporate-action interpretation.

## 2. The hard ceiling

```
PortfolioRecognizedValue  ≤  Σ SingleInstrumentRecognizedValue      (always)
PortfolioRecognizedValue  ≥  0
```

Negative correlation may one day justify a richer model. It will not, in the launch model, recognise
**more** collateral because two assets look anti-correlated. Correlation may increase stress,
create shared-risk treatment, or reduce recognition. It cannot create value. Property-tested
(`I-86`).

## 3. Risk dimensions

Risk grouping uses the Phase 01 identity model, never a ticker. Each dimension corresponds to a
real loss/recovery mechanism.

| Dimension | Group key | Real mechanism | Unknown behaviour |
|---|---|---|---|
| **INSTRUMENT** | `instrumentId` | one exact wrapper failing | handled **upstream** by RiskMath `§4.6`; the portfolio model consumes the already-capped value and does not re-apply |
| **UNDERLYING** | `underlyingReferenceId` | the company/fund/asset itself moves or is restricted. **Two wrappers of NVIDIA are 2× NVIDIA, not diversification.** | all positions with an unresolved underlying share one `UNKNOWN_UNDERLYING` group with a stricter cap — never treated as independent (`I-89`) |
| **ISSUER** | `issuerId` | one tokenization provider fails / freezes / is sanctioned — every product it issues is affected | one `UNKNOWN_ISSUER` group, stricter cap |
| **CUSTODY** | `custodyGroupId` | the custodian holding the underlying assets fails — different issuers can share one custodian | one `UNKNOWN_CUSTODY` group, stricter cap. **Missing custodian ≠ independent custody.** |
| **SECTOR** | `sectorGroupId` | a sector shock (semiconductors, rates, a single mega-cap) hits many underlyings at once | one `UNKNOWN_SECTOR` group, stricter cap |
| **LIQUIDITY** | `liquidityGroupId` + a versioned `depthUsd18` | positions whose liquidation routes compete for the same finite depth / quote asset / market maker | missing depth → `depthUsd18 = 0` (maximally restrictive); missing group → `UNKNOWN_LIQUIDITY` |
| **SESSION** | `marketSession` per position | 24/7 token transfer ≠ 24/7 underlying liquidity | `UNKNOWN` and `CLOSED` are the most restrictive session factors |
| **STRESS** (optional) | named deterministic scenario tags | a coherent shock scenario that captures several shared risks at once | a scenario with stale/missing inputs restricts; scenarios are policy, never model output |

`DOMAIN` is a group key on every position (`homeDomain`) but is **not** a capacity dimension —
it is carried for the facility-collateral-set rule (§8) and the snapshot, not to penalise a
position for the chain it lives on.

## 4. The formula

Deterministic, fixed-point (WAD-scaled fractions, `BPS`-scaled caps), single-pass. No floating
point. No covariance matrix.

```
0. DEDUPE   positions by instrumentId — sum singleRecognized and quantities for the same
            instrumentId into one position (I-91). A duplicate cannot be counted twice.

1. base   = Σ singleRecognized_i                                        [the hard ceiling]

2. For each capacity dimension d ∈ {UNDERLYING, ISSUER, CUSTODY, SECTOR, LIQUIDITY}:
     for each group g in dimension d (including the UNKNOWN_d group):
        groupTotal_g   = Σ singleRecognized_i           for i in g
        groupAllowed_g = base × capBps[d, groupKind] / BPS
                         and, for LIQUIDITY only, min(that, depthUsd18_g)
        for each i in g:
           dimScale(i, d) = groupTotal_g == 0 ? WAD
                          : min(WAD, groupAllowed_g × WAD / groupTotal_g)      [down]

3. sessionScale(i) = policy.sessionFactorBps[ marketSession(i) ] × WAD / BPS

4. positionScale(i) = min( sessionScale(i), min over d of dimScale(i, d) )

5. working_i = mulDiv(singleRecognized_i, positionScale(i), WAD)        [down]

6. If policy defines stress scenarios S:
     for each s in S:
        stressed_s = Σ mulDiv(working_i, BPS - scenarioHaircutBps(i, s), BPS)   [down]
     PortfolioRecognizedValue = min( Σ working_i , min over s of stressed_s )
   else
     PortfolioRecognizedValue = Σ working_i
```

**Why this shape** (`constraint 7, 8` of the Phase 04 brief):

- It is the **maximum binding restriction** pattern per position: a position that shares both an
  underlying and a sector group takes the `min` of the two scales, never their product. Overlapping
  constraints do **not** stack into arbitrary over-penalisation.
- Every `groupAllowed` is computed against the **original** `base`, not a running total, so a
  shared risk counted in one dimension is not silently re-hit in another for the same value.
- Single-pass against the uncapped base — the same choice `accounting.md §4.6` already froze for
  per-instrument concentration: deterministic, cheap, errs toward recognising less. A fixed-point
  iteration would recover a little value and is explicitly not the frozen behaviour.
- All steps are sums and per-group scaling, so the result is **permutation-invariant** in the
  positions (`I-88`). The dimension order in step 2 does not affect the result because every
  `dimScale` is against the original base and step 4 takes a `min`.

`capBps[d, groupKind]` has a `groupKind` of `NAMED` or `UNKNOWN`; `capBps[d, UNKNOWN] ≤ capBps[d,
NAMED]` is enforced by the policy schema.

## 5. Explainability

The result is never one number. It carries:

```
PortfolioResult {
    portfolioMarketValueUsd18
    singleAssetRecognizedTotalUsd18          // the hard ceiling
    portfolioRecognizedValueUsd18
    positions[ { instrumentId, singleRecognizedUsd18, workingUsd18,
                 bindingDimension, bindingGroup } ]
    constraintBreakdown[ { dimension, standaloneReductionUsd18, bindingGroups[] } ]
    bindingConstraint                        // argmax standaloneReduction, or SESSION / STRESS
    riskStatusContribution                   // e.g. whether the portfolio value now sits below debt
    policyVersion
    riskEpoch
    snapshotDigest
}
```

`standaloneReductionUsd18(d)` = `base − Σ mulDiv(singleRecognized_i, min(WAD, dimScale(i,d)), WAD)`
— the reduction that dimension `d` would cause on its own. The binding constraint is the dimension
with the largest standalone reduction. It does not equal the total reduction (dimensions overlap);
it names the one a user should act on first.

## 6. Versioned policy and metadata

`PortfolioRiskPolicy` is a versioned record (`I-90`):

```
PortfolioRiskPolicy {
    policyId, version, taxonomyVersion
    capBps { UNDERLYING:{NAMED,UNKNOWN}, ISSUER:{…}, CUSTODY:{…}, SECTOR:{…}, LIQUIDITY:{…} }
    sessionFactorBps { OPEN, PRE_MARKET, POST_MARKET, CLOSED, UNKNOWN }
    stressScenarios[ { id, tag, haircutBps } ]
    maxCollateralInstruments            // §10 bound
    maxGroupMembershipsPerPosition
    maxStressScenarios
    effectiveAt, reviewBy
}
```

Every risk-group classification a position carries is a versioned `RiskGroupRef`:

```
RiskGroupRef { dimension, groupId, taxonomy, taxonomyVersion, source, effectiveAt, reviewBy? }
```

The `RiskEpoch` (`accounting.md §2`) already increments on any input change that can move a
recognised value; a portfolio-policy activation or a risk-group taxonomy change is such a change.
Changing a cap is a **new policy version and a new epoch**, never a silent recomputation of a
historical result (`I-90`, `I-92`).

## 7. Reproducible snapshot

`PortfolioRiskSnapshot` pins every input so a portfolio result is reproducible:

```
PortfolioRiskSnapshot {
    facilityId | accountId
    homeDomain
    positions[ { instrumentId, legacyAssetId?, effectiveCreditedQuantity,
                 singleRecognizedUsd18, passportVersion,
                 corporateActionSnapshotDigest, oracleRoundId, marketSession,
                 liquidityObservationVersion, riskGroupRefs[] } ]
    portfolioPolicyVersion
    sourceBlock, finality
    riskEpoch
    digest                                   // keccak over the canonical encoding of the above
}
```

No "current portfolio risk" number may depend on a mutable hidden input. A quote binds the
snapshot digest and the epoch; a decision under one snapshot cannot execute under another.

## 8. Portfolio ≠ facility collateral, and the home-domain rule holds

- The portfolio model runs over a **facility's admitted collateral set**, not every asset the
  organisation owns. An organisation-wide, multi-domain portfolio view is analytical read state
  (`facility-model.md §8`, `I-79`); it is **not** collateral for any one facility.
- One facility still has one authoritative home domain (`I-75`). A Base facility may recognise only
  collateral whose custody / remote-collateral mechanism is actually authorised for that Base
  facility. Remote collateral remains deferred. A global dashboard never turns X Layer holdings
  into Base borrowing power (`I-87`).

## 9. Bounds and on-chain placement

- **Bounded**: `maxCollateralInstruments` (policy; suggested launch value ≤ 24),
  `maxGroupMembershipsPerPosition` (one group per capacity dimension = 5, plus session), and
  `maxStressScenarios`. The formula is O(instruments × dimensions) with no nested unbounded loop.
- **On-chain placement is decided in the Phase 04 report** against EIP-170, trust boundary, gas
  and migration safety — not aesthetics. The deployed `ClearingHouse` (86 bytes of headroom) does
  **not** gain concentration tables, issuer groups, portfolio loops or risk-group metadata. The
  existing `ClearingHouse` remains the existing revolving-credit facility. A future Base or
  institutional facility consumes an **additive** portfolio-risk engine/interface; Phase 04
  freezes and proves that engine, it does not force it into the old deployment.

## 10. Debt, liquidation, Sentinels

- A worse portfolio result reduces available new credit, can move the account to `NO_NEW_RISK` /
  `MARGIN_CALL`, and can later trigger liquidation per policy. It **never** rewrites principal
  already borrowed (`I-92`, restating that recognised value is derived and debt is stored).
- Adding an otherwise-eligible position never reduces the recognised value of **unrelated** existing
  collateral (different group in every dimension); it can only affect co-members of a group whose
  cap genuinely binds, and the effect is bounded and proportional — no `$1 → $10,000` cliff
  (`I-93`). Property-tested around every threshold.
- Phase 04 does not build multi-asset liquidation. It defines enough for a later engine to select
  deterministically: `positions[].workingUsd18` and `bindingGroup` identify which positions carry
  the concentration that a liquidation must reduce, and reducing one position recomputes the
  portfolio result through the same pure function.
- Sentinel authority is unchanged. The portfolio engine emits state / binding constraints /
  required reduction / a new epoch; a Sentinel still acts only through its mandate and protocol
  policy (`I-60…I-74`). No portfolio-risk component moves money.

## 11. No AI in the money calculation

`PortfolioRecognizedValue = …` contains no model prompt. Any externally-derived classification
(sector, custody group) becomes a reviewed, versioned `RiskGroupRef` policy input before any
financial use. ChainGPT / 0G may help *propose* a classification; deterministic policy and this
pure function decide capacity (`AI_BOUNDARY.md`, `I-15`).

## 12. What does not change

- `AssetRegistry`, `CollateralVault`, `ClearingHouse`, `FinancingEngine`, `RiskPolicyRegistry`,
  `RiskMath` — no bytecode, storage or interface. Live 1952 still matches source.
- `accounting.md` valuation formulas and `§4.6` per-instrument concentration — unchanged. Portfolio
  risk is a layer *above* `RiskResult`.
- `fixtures/canonical/` and the differential property — untouched.
- Every historical `assetId`, `passportId`, `receiptId`, proof reference — valid and unedited.
- No new production claim. Phase 04 result is `UNIT_TESTED` / `INTEGRATION_TESTED` until a real
  production facility consumes it.

# spec/base-portfolio-facility-model.md — the Base portfolio-revolving-credit facility

Status: **frozen** for Phase 08. Additive to the live X Layer deployment; introduces new contracts
on a new domain (`eip155:8453` / `eip155:84532`), touches no deployed-core bytecode, storage or
interface. It consumes the frozen Phase 03 (`corporate-action-model.md`) and Phase 04
(`portfolio-risk-model.md`) models unchanged. Changing a conversion rule, a composition rule, or a
rounding direction that these two documents froze is an RFC in `spec/rfcs/`.

`system.md §1` still holds: `ClearingHouse` is the sole financial authority for the X Layer
revolving-credit facility. This document defines a **separate** `FacilityImplementation` with its
own home domain, its own authority, and its own money.

Product sentence: *turn an eligible tokenized-stock portfolio into controlled working capital on
Base, without selling the positions.*

---

## 1. Facility reuse analysis (§7 of the Phase 08 brief)

| Requirement | `ClearingHouse` (X Layer revolving credit) | `InstitutionalFacility` (Phase 06 secured term) | New facility required? |
|---|---|---|---|
| Multiple collateral instruments in one account | yes (multi-asset) | **no** — one `_collateral.adapter` | — |
| Portfolio-recognized collateral (`≤ Σ single`, shared-risk caps) | **no** — Σ single-instrument only | **no** | **yes** |
| `EXTERNALLY_SCALED` (B20) custody + pinned corporate-action snapshot | **no** — `FIXED_UNIT` only, no snapshot | **no** | **yes** |
| Revolving working-capital draw / repay / re-draw | yes | **no** — term, hero op is substitution | — |
| USDC (6dp) settlement with USD18 boundary | yes (D-009 pattern) | yes | reuse pattern |
| Corporate-action-safe custody (multiplier change during live debt) | **no** | **no** | **yes** |
| Portfolio `RiskEpoch` (bumps on any portfolio-policy / taxonomy / group change) | **no** — single-asset epoch | partial | **yes** |
| Enforceable origination fee, no bypass (D-025) | **no** — the D-025 gap | yes (`MAX_ORIGINATION_FEE_BPS`) | reuse discipline, not code |
| Deployed / immutable | yes (1952) — cannot change | not deployed | — |

**Decision D-028: a new provider-neutral `FacilityImplementation`,
`facilityType = PORTFOLIO_REVOLVING_CREDIT`.** Neither existing facility's semantics fit safely.
`ClearingHouse` is revolving but single-recognition and `FIXED_UNIT`; `InstitutionalFacility` is
portfolio-blind and term. `PORTFOLIO_REVOLVING_CREDIT` extends the `facility-model.md §4`
`facilityType` vocabulary additively (a new enum value, not a changed derivation formula). Identity
is still `H("USANCE_FACILITY_V1", facilityType, homeDomainId, controller, discriminator)`.

Base is the **deployment domain**, not a code flavour. No contract is named after Base. The
generic primitive is `PortfolioRevolvingCredit`; the Base-specific parts are the provider adapters
(`BaseB20InstrumentAdapter`, `ChainlinkTotalReturnOracleAdapter`) it is *configured* with.

## 2. Component map (all new, all additive)

```
BaseB20InstrumentAdapter   IInstrumentAdapter  — reads a B20 ASSET token: raw balanceOf, multiplier(),
                                                 isPaused, decimals; produces a pinned
                                                 CorporateActionSnapshot (Phase 03 §3). No custody.
ScaledCollateralVault      the custody + per-account entitlement ledger for EXTERNALLY_SCALED
                           instruments. Holds raw B20 units; entitlement is a raw unit count per
                           account (B20 raw balance is stable across corporate actions, so a
                           nominal ledger is safe — I-109). NOT the deployed CollateralVault.
PortfolioRiskEngine        pure fixed-point function; byte-for-byte equal to
                           packages/portfolio-risk/src/evaluate.ts (I-116). No storage, no auth.
PortfolioRiskPolicyRegistry versioned PortfolioRiskPolicy + RiskGroupRef records; bumps portfolio
                           RiskEpoch on any change (I-114).
ChainlinkTotalReturnOracleAdapter  IBaseOracleAdapter over a Chainlink AggregatorV3 proxy;
                           FACTOR_IN_PRICE; staleness + session + implied-multiplier cross-check.
TestOnlyOracleAdapter      §16 TEST_ONLY price source for the Sepolia synthetic instruments.
AerodromeLiquidityObserver a minimal ILiquidityObserver: one real Base venue, size-aware exit
                           estimate. Not a trading simulator.
UsEquitySessionOracle      IMarketSession: OPEN / PRE_MARKET / POST_MARKET / CLOSED / UNKNOWN from
                           a configured session calendar. Degradation never raises capacity (I-113).
PortfolioRevolvingCredit   THE facility. The only money authority for a Base portfolio account.
BasePortfolioLiquidation   the smallest additive unsafe-state / recovery component (§10).
```

## 3. Trust boundary

| Component | Trusted for | NOT trusted for |
|---|---|---|
| B20 token (`multiplier()`, `balanceOf`, `isPaused`) | authoritative corporate-action factor + raw quantity + token pause | price, LTV, recognition |
| Chainlink Total-Return feed | USD price of the tokenized asset (already `× multiplier`) | quantity, eligibility, freshness policy (the adapter re-checks `updatedAt`) |
| `ILiquidityObserver` | a measured size-aware exit estimate at a block | facility debt, collateral eligibility |
| `IMarketSession` | the underlying-equity session classification | a capacity increase — a worse session only caps |
| `PortfolioRiskEngine` | the deterministic recognition math | a value larger than `Σ single` (I-112) |
| `PortfolioRevolvingCredit` | debt, available credit, draw/repay, fee, safety state, receipts | — it is the authority |
| execution venue adapters | executing an exact settlement/liquidation intent | LTV, debt, eligibility, final settlement (§26) |

No AI in any number (I-15). Any externally-proposed classification becomes a reviewed, versioned
`RiskGroupRef` before financial use.

## 4. B20 accounting — consumes Phase 03, does not re-interpret

B20 is `EXTERNALLY_SCALED` (`corporate-action-model.md §2`). The three quantities:

```
stored    = B20 token balanceOf(vault)                 // raw units, STABLE across corporate actions
effective = stored × multiplier() / 1e18               // economic shares
credited  = the vault's per-account raw entitlement     // == stored share; not scaled
```

- Valuation path is `FACTOR_IN_PRICE` (`corporate-action-model.md §5`): the Chainlink Total-Return
  feed already reports `underlying × multiplier`, so
  `recognisedInputValue = rawCreditedQuantity × feedPriceUsd18` and the quantity side uses **raw**,
  never `scaledBalanceOf`. Multiplying by `multiplier()` here as well is the exact defect I-84
  exists to catch.
- The `BaseB20InstrumentAdapter` returns a `CorporateActionSnapshot` on every quote/epoch:
  `{ instrumentId, accountingMode: EXTERNALLY_SCALED, factorWad = multiplier(), pendingFactorWad,
  pendingActivationAt, sourceBlock, priceConvention: FACTOR_IN_PRICE, feedStatus, support }`.
- **Beryl has no on-chain pending multiplier.** `pendingFactorWad` / `pendingActivationAt` come
  from a `newUIMultiplier()` / `effectiveAt()` staticcall that reverts on Beryl → both `null`, and
  `feedStatus` is then derived from the oracle: `PAUSED_FOR_ACTION` when the B20 token
  `isPaused(TRANSFER)` or the Chainlink `updatedAt` is frozen beyond the configured session-aware
  bound; `STALE` when the feed is stale for a non-session reason; `LIVE` otherwise. A
  Cobalt-activated chain exposes the pending values and the adapter reads them.
- Mutable multiplier state never enters `instrumentId`, `passportId` or a legacy `assetId`
  (`corporate-action-model.md §11`, `identity-model.md §5`).

## 5. Custody — `ScaledCollateralVault`, not the deployed `CollateralVault`, not `RebasingCollateralVault`

`corporate-action-model.md §7` classifies B20 custody on the deployed core as **CONDITIONAL**:
`balanceOf(vault)` is stable across corporate actions, so a nominal per-account raw ledger keeps
`Σ credited == totalRaw` and solvency holds. What the deployed vault lacks is a pinned
`CorporateActionSnapshot` per quote/epoch and feed-pause handling — not a custody-accounting
problem, a quote-binding problem.

`ScaledCollateralVault` is the **new** custody contract for the Base facility. It is *not*
`RebasingCollateralVault` (that `SHARE_BASED_CUSTODY` design in `corporate-action-model.md §8` is
for `REBASING_BALANCE` instruments whose `balanceOf` moves — xStocks, Phase 09). For B20:

```
per account:   creditedRaw[instrumentId][account]     // raw B20 units, minted on deposit (measured delta)
pool:          totalCreditedRaw[instrumentId]          // == token.balanceOf(vault) under authorised ops
deposit(raw):  observedDelta = token.balanceOf(vault)_after - _before      // I-33 measured delta
               creditedRaw[account] += observedDelta ; totalCreditedRaw += observedDelta
withdraw(account, raw):  creditedRaw[account] -= raw ; totalCreditedRaw -= raw ; token.transfer(account, raw)
effectiveOf(account) = creditedRaw[account] × instrumentAdapter.factorWad() / 1e18     // read-time, snapshot-pinned by the caller
```

Invariant `I-109`: a corporate action changes `multiplier()` and therefore every account's
`effectiveOf`, proportionally, and **never** changes `creditedRaw`, never mints/burns a deposit,
never breaks `Σ creditedRaw == token.balanceOf(vault)` under authorised deposits, withdrawals and
liquidation transfers. An unprovenanced balance increase is unattributed surplus (`I-82`), never
credited. The deployed `CollateralVault` is never modified and never holds a B20.

## 6. Portfolio enforcement chain

```
per instrument i in the facility's ADMITTED set (not the org's whole portfolio — I-87):
  rawCredited_i     = ScaledCollateralVault.creditedRaw[i][account]
  snapshot_i        = BaseB20InstrumentAdapter.snapshot(i)              // pinned corporate-action state
  priceUsd18_i      = ChainlinkTotalReturnOracleAdapter.priceUsd18(i)   // FACTOR_IN_PRICE, staleness-checked
  marketValueUsd18_i   = rawCredited_i × priceUsd18_i / 10^decimals_i
  singleRecognizedUsd18_i = RiskMath single-instrument recognition(marketValue_i, passport_i policy)   // incl. §4.6 concentration cap
                                                                                                      // (Phase 04 model consumes the ALREADY-capped value)
→ PortfolioRiskEngine.evaluate(positions[], PortfolioRiskPolicy):
     base            = Σ singleRecognizedUsd18_i                        [hard ceiling — I-112]
     per dimension d ∈ {UNDERLYING, ISSUER, CUSTODY, SECTOR, LIQUIDITY}:
        groupAllowed = base × capBps[d, groupKind] / BPS  (LIQUIDITY: min with depthUsd18)
        dimScale_i   = min(WAD, groupAllowed × WAD / groupTotal)        [down]
     sessionScale_i  = sessionFactorBps[ marketSession_i ] × WAD / BPS
     positionScale_i = min( sessionScale_i, min over d of dimScale_i )   [max binding restriction, not product]
     working_i       = singleRecognized_i × positionScale_i / WAD       [down]
     portfolioRecognizedUsd18 = min( Σ working_i , min over stress scenarios )
→ facility credit limit = min( configured facilityLimitUsd18 , portfolioRecognizedUsd18 × maxLtvBps / BPS )
→ maxDebtUsd18          = facility credit limit
→ availableCreditUsd18  = maxDebtUsd18 − outstandingDebtUsd18 − reservationsUsd18
```

The facility **enforces** `portfolioRecognizedUsd18`: `draw` reverts when it would push
`outstandingDebt > maxDebt`; `withdraw` reverts when the post-withdraw recompute is unsafe (§9).
No portfolio number is displayed by any surface that the deployed facility does not enforce
(`portfolio-risk-model.md §10`).

## 7. Draw / repay lifecycle

`PortfolioRevolvingCredit` status: `DRAFT → PORTFOLIO_PENDING → ACTIVE → { RECALLING, MATURED } →
SETTLED`, plus `NO_NEW_RISK` and `MARGIN_CALL` as sub-flags on `ACTIVE`.

| Op | Effect | Fee | Guard |
|---|---|---|---|
| `admitCollateral(instrumentId, adapter, riskGroupRefs)` | add an instrument to the admitted set | — | policy `maxCollateralInstruments`; home-domain match (I-87); adapter `support ∈ {VERIFIED, TESTED}` |
| `commitCollateral(instrumentId, raw)` | deposit raw B20 into `ScaledCollateralVault`; credit measured delta | — | not paused; `isPaused(TRANSFER)==false` on the token |
| `activate()` | `PORTFOLIO_PENDING → ACTIVE` | — | portfolio recompute succeeds; lender funded |
| `draw(usdcAmount, quoteSnapshotDigest)` | transfer USDC to borrower; `outstandingDebt += amount + originationFee` | **origination fee, mandatory, every path (I-110 / D-025)** | `quoteSnapshotDigest == currentPortfolioSnapshotDigest` (I-115); `outstandingDebt + amount + fee ≤ maxDebt`; `feedStatus == LIVE` for every admitted instrument; RiskEpoch match |
| `repay(usdcAmount)` | `outstandingDebt -= min(amount, outstandingDebt)`; refund overpay | — | always allowed (risk-reducing) |
| `drawAgain(...)` | same as `draw` | same fee | same guards; a new quote snapshot |
| `withdrawCollateral(instrumentId, raw)` | release raw B20 to borrower | — | §9 post-withdraw safety recompute |
| `settle()` | `→ SETTLED`, release all collateral | — | `outstandingDebt == 0` |

`originationFee = mulDivUp(drawAmount, originationFeeBps, BPS)`, `borrowerProceeds = drawAmount`,
`debtAdded = drawAmount + originationFee` — the fee is added to debt, conserving
(`FacilityMath.originationSplit` pattern). `MAX_ORIGINATION_FEE_BPS` bounds it. **There is no draw
path that skips the fee** — `draw` and `drawAgain` share one internal `_draw`, and no external
function reaches `_transferOut` without it. `I-110`.

## 8. Oracle / liquidity / session per instrument

| Instrument | Oracle product | Feed / source | Quote | Freshness rule | Market status source | Access |
|---|---|---|---|---|---|---|
| Base Mainnet Coinbase B20 (canary) | Chainlink Data Feed (push, `AggregatorV3`) | proxy in `BASE_CANARY_CANDIDATES.md` | USD, 8dp | `now − updatedAt ≤ sessionAwareBound`; `OPEN` bound 90s·2 heartbeat headroom, `CLOSED` bound tolerates the last-close hold but forbids **new** risk | `UsEquitySessionOracle` from a configured US-equity calendar | none (public) |
| Base Sepolia `SYNTHETIC_TEST_B20` | `TestOnlyOracleAdapter` (**TEST_ONLY**) | governance-set price + `updatedAt` | USD18 | same staleness discipline | same | n/a |

`ILiquidityObserver` for a canary instrument returns `{ venue, pool, quotePair, depthUsd18,
sizeAwareExitUsd18(notional), observedBlock, observedAt, marketSession }`. A position with no real
`(route, positive depthUsd18)` is **not admitted** (not silently zero-capped — `portfolio-risk-model.md §3`).
An invented `liquidityScore = 8/10` is prohibited (§12). Phase 08 wires `AerodromeLiquidityObserver`
as the one real Base venue; more venues are not a requirement (§27).

## 9. Collateral withdrawal

```
withdrawCollateral(instrumentId, raw):
  simulate: creditedRaw[i][account] -= raw
  recompute single-instrument recognition for i at the current snapshot + price
  recompute PortfolioRiskEngine.evaluate over the simulated admitted set
  newMaxDebt = min(facilityLimit, portfolioRecognized' × maxLtvBps / BPS)
  require outstandingDebt ≤ newMaxDebt × safetyBufferBps / BPS      // strictly safe, not merely ≤ maxDebt
  else revert UnsafeWithdrawal
```

Never a per-asset LTV check (§24). The withdraw goes through the same pure `evaluate` as every
other recompute.

## 10. Unsafe state and recovery

Phase 08 does not build a liquidation auction. It defines deterministic unsafe-state handling:

- `unsafe` when `outstandingDebt > portfolioRecognizedUsd18 × liquidationLtvBps / BPS` at a fresh
  snapshot with `feedStatus == LIVE` for every admitted instrument.
- On `unsafe`: `NO_NEW_RISK` (no `draw`/`drawAgain`/`withdrawCollateral`; `repay`/`commitCollateral`
  still allowed).
- `liquidate(instrumentId, raw, minUsdcOut, routeIntent)` — permissionless once `unsafe`. Selects
  from the admitted set; converts the effective B20 quantity to a settlement intent handed to an
  `ILiquidationRoute` adapter (quote → reserve → submit → query → reconcile — §26); applies proceeds
  to `outstandingDebt`; recomputes the portfolio through the same pure function.
- **Stale-state protection**: `liquidate` reverts if any admitted instrument's `feedStatus != LIVE`
  or the corporate-action snapshot is older than the safe bound — you cannot liquidate against a
  frozen feed or a mid-corporate-action multiplier (`I-111`, restating I-84/I-85 for the exit).

`LiquidationManager` on X Layer cannot serve this facility (single-asset, `FIXED_UNIT`, X Layer
home domain). `BasePortfolioLiquidation` is the smallest additive component.

## 11. Policy — `BaseCanaryPortfolioRiskPolicy`, `CANARY_PROVISIONAL`

The Phase 04 reference values (`UNDERLYING 40%`, `ISSUER 60%`, …) are **test parameters**, not a
launch config (§10 of the brief). The Base facility is configured with a distinct
`BaseCanaryPortfolioRiskPolicy`, `status = CANARY_PROVISIONAL`:

```
capBps       UNDERLYING {NAMED 3500, UNKNOWN 1500}   ISSUER {NAMED 5000, UNKNOWN 2000}
             CUSTODY    {NAMED 5000, UNKNOWN 2000}    SECTOR {NAMED 4000, UNKNOWN 1500}
             LIQUIDITY  {NAMED 6000, UNKNOWN 6000}    (LIQUIDITY cap is a no-op without a declared route)
sessionFactorBps  OPEN 10000  PRE_MARKET 7500  POST_MARKET 7500  CLOSED 5000  UNKNOWN 3000
maxLtvBps          5000        // deliberately conservative — half of portfolio-recognized
liquidationLtvBps  8500
safetyBufferBps    9000        // withdraw requires 10% headroom
maxCollateralInstruments  8
facilityLimitUsd18 (Sepolia)  50_000e18
originationFeeBps  30          // 0.30%, MAX_ORIGINATION_FEE_BPS = 100
```

Calibration is explicit and marked. It is never `PRODUCTION_VALIDATED` in Phase 08. Changing a cap
is a new policy version and a new portfolio RiskEpoch (`I-114`), never a silent recompute of a
historical result.

## 12. Receipts

Base receipts bind (`spec/evidence-model.md` families, additive fields):
`facilityId`, `homeDomain = eip155:84532` (Sepolia) / `eip155:8453` (mainnet), `account`, each
`instrumentId`, the B20 `multiplier()` snapshot per instrument, single-risk results, the
`portfolioSnapshotDigest`, `portfolioPolicyVersion`, `riskEpoch`, USDC amount (6dp), origination
fee, tx/block, before/after `outstandingDebt`, before/after `portfolioRecognizedUsd18`. Mainnet
read-only artifacts carry `NO FINANCIAL ACTION`.

## 13. What does not change

- `AssetRegistry`, `CollateralVault`, `ClearingHouse`, `FinancingEngine`, `LiquidationManager`,
  `RiskPolicyRegistry`, `RiskMath` — no bytecode, storage or interface. Live 1952 still matches
  source and holds only `FIXED_UNIT` instruments.
- `spec/accounting.md`, `identity-model.md`, `corporate-action-model.md`, `portfolio-risk-model.md`
  — consumed, not edited. `fixtures/canonical/` and the differential property — untouched.
- Every historical `assetId`, `passportId`, `receiptId`, proof reference — valid and unedited.
- No new production claim. Phase 08 proves the Base facility mechanics on Sepolia with synthetic
  B20 + a test oracle, and characterizes real B20 on mainnet read-only. Real-capital Base credit
  is Phase 13.

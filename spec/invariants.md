# spec/invariants.md — protocol invariants

Status: **frozen**. An invariant without a test is a comment, and comments do not hold user funds.

The `Test` column names the enforcing test. Rows marked **✅** are implemented and passing today;
rows marked **○** are specified and not yet written. The distinction is kept visible on purpose —
a specification that lists aspirations in the same voice as facts is worse than no specification,
because it stops anyone from being able to tell which is which.

Current state: **27 of 35 enforced** (26 invariants plus the differential conformance property).
properties are covered. Mandates, crosschain collateral, liquidation and external execution are
specified but not yet implemented, so their invariants have no tests to point at.

---

## Custody and accounting

| ID | Invariant | Test |
|---|---|---|
| `I-01` | The `CollateralVault` token balance for an asset is ≥ the sum of all account balances for that asset. | ✅ `Lifecycle.t.sol::test_depositIsCreditedByMeasuredDelta` + `CollateralVault.isSolvent` |
| `I-02` | One external collateral lock creates at most one live collateral credit. | ○ planned — `Invariant_RemoteCollateral.t.sol::invariant_noDoubleCredit` |
| `I-03` | Every debt increment is matched by a settlement-asset transfer out of the liquidity vault or by a reservation. | ✅ `Regression.t.sol::test_R03_subUnitBorrowIsRejected` |
| `I-04` | Every repayment reduces debt exactly once; replaying a repay calldata cannot reduce it twice. | ✅ `Lifecycle.t.sol::test_duplicateRepayDoesNotDoubleReduce` |
| `I-05` | `Σ scaledPrincipal × index / WAD` equals total borrows tracked by the financing market, within one wei per account. | ○ planned — `Invariant_Financing.t.sol::invariant_debtAccounting` |
| `I-06` | Fees satisfy the conservation equation in `accounting.md §7`. | ✅ `Regression.t.sol::test_R01_*` — interest and principal book in token units |

## Risk and authority

| ID | Invariant | Test |
|---|---|---|
| `I-07` | Degraded inputs can only restrict. For any account state, replacing a fresh oracle with a stale one, or a current Passport with a stale one, never increases `availableBorrow` and never lowers `status`. | ✅ `RiskMath.evaluate` — status is a `max` over a total order; `Lifecycle.t.sol::test_staleOracleBlocksNewRiskButNotRepayment` |
| `I-08` | Stale evidence cannot increase capacity. A Passport older than `maxPassportAge` yields `availableBorrow == 0`. | ✅ `RiskMathConformance` S08 (stale Passport → capacity 0) |
| `I-09` | A stale or non-positive oracle answer cannot increase capacity. | ✅ `RiskMathConformance` S07, S22; `Lifecycle.t.sol::test_staleOracleBlocksNewRiskButNotRepayment` |
| `I-10` | A withdrawal cannot move an account below its maintenance requirement. | ✅ `Lifecycle.t.sol::test_withdrawBlockedBelowMaintenanceAndReportsSafeMaximum` |
| `I-11` | Liquidation cannot increase directional risk or increase debt. | ○ planned — `Invariant_Liquidation.t.sol::invariant_liquidationReducesRisk` |
| `I-12` | Every valuation references an explicit risk epoch, and a quote issued under epoch `N` cannot execute under epoch `M ≠ N`. | ✅ `Lifecycle.t.sol::test_borrowUnderStaleEpochReverts` |
| `I-13` | `initialLtv ≤ maintenanceLtv ≤ liquidationLtv < BPS` for every registered policy. | ✅ `RiskPolicyRegistry._validateParams` |
| `I-14` | The exit curve is non-increasing in recovery and strictly ascending in threshold. | ✅ `RiskPolicyRegistry._validateCurve` |

## AI and evidence boundary

| ID | Invariant | Test |
|---|---|---|
| `I-15` | No AI output reaches custody or risk authority. There exists no call path from an extractor result to a state-changing function on `CollateralVault`, `ClearingHouse`, `FinancingEngine` or `RiskPolicyRegistry`. | ○ planned — `test/adversarial/ai-authority.test.ts` + `Authority.t.sol::test_extractorHasNoRole`. True by construction today: no extractor holds any role, and no contract accepts extractor output. Untested is not the same as unenforced, but it is not the same as tested either. |
| `I-16` | Document content cannot influence control flow. An evidence document containing instruction-shaped text produces the same Passport as one with that text removed, given the same extracted claims. | ○ planned — `test/adversarial/prompt-injection.test.ts` |
| `I-17` | A Passport built from a single extraction path is capped and cannot unlock corroboration-gated capabilities. | ○ planned — `Passport_Corroboration.t.sol::test_singleSourceCapped` |
| `I-18` | A low-trust source class can never raise a limit. Observations may only trigger review or restriction. | ✅ `EvidenceRegistry.supersede` — `WeakerSource` revert |

## Distributed systems and adapters

| ID | Invariant | Test |
|---|---|---|
| `I-19` | An adapter cannot consume more capital than its reservation. | ✅ `Mandate.t.sol::test_fillCannotExceedReservation` + cumulative-cap case |
| `I-20` | A duplicate intent cannot execute twice; `intentId` is consumed exactly once. | ✅ `Mandate.t.sol::test_duplicateIntentRejected` |
| `I-21` | A duplicate or reordered crosschain message has zero incremental effect. | ○ planned — `Invariant_RemoteCollateral.t.sol::invariant_messageIdempotent` |
| `I-22` | A remote asset cannot be released while its X Layer collateral credit is live. | ○ planned — `RemoteCollateral_Release.t.sol::test_releaseBlockedWhileCredited` |
| `I-23` | Unknown external state defaults to restrictive. An `EXECUTION_UNKNOWN` result never releases a reservation and never credits a fill. | ✅ `Mandate.t.sol` — `markExecutionUnknown` releases nothing |
| `I-24` | A partial fill reconciles to exactly the filled amount and releases exactly the remainder. | ✅ `Mandate.t.sol` — 37% partial fill then timeout |

## Emergency authority

| ID | Invariant | Test |
|---|---|---|
| `I-25` | A guardian can only restrict. No guardian call increases an LTV, mints debt, moves collateral, or redirects a withdrawal. | ✅ `Lifecycle.t.sol::test_guardianCanOnlyRestrict` + `Adversarial.t.sol::testFuzz_guardianCannotIncreaseRisk` |
| `I-26` | Risk-increasing governance changes are timelocked; risk-reducing changes may be immediate. | ✅ `RiskPolicyRegistry.updatePolicy` — `_increasesRisk` routes through the timelock |
| `I-27` | Mandate revocation takes effect without delay and cannot be reversed except by a new signature. | ✅ `Mandate.t.sol::test_revokeImmediateAndIrreversible` |
| `I-28` | No mandate authorises a withdrawal under any parameterisation. | ✅ `Mandate.t.sol::testFuzz_noMandatePermitsWithdrawal` (with owner/agent controls) |

## Signature and replay

| ID | Invariant | Test |
|---|---|---|
| `I-29` | A mandate signature is valid for exactly one `(owner, nonce)` and cannot be replayed. | ✅ `Mandate.t.sol::test_signatureReplayRejected` |
| `I-30` | An expired mandate authorises nothing, regardless of remaining budget. | ✅ `Mandate.t.sol::test_expiredMandateAuthorisesNothing` |
| `I-31` | A mandate cannot be used for an asset, action or venue outside its commitment set. | ✅ `Mandate.t.sol::testFuzz_outsideCommitmentRejected` |

## Token behaviour

| ID | Invariant | Test |
|---|---|---|
| `I-32` | A reentrant ERC-20 cannot observe or exploit intermediate vault state. | ✅ `Adversarial.t.sol` — reentrant ERC-20 against vault and clearing house |
| `I-33` | A fee-on-transfer or rebasing token is accounted by measured delta, never by requested amount. | ✅ `CollateralVault.deposit` credits the measured delta |
| `I-34` | A rebasing corporate action cannot make the vault insolvent or silently move value between accounts. | ✅ `Adversarial.t.sol::test_negativeRebaseIsDetectableAndCreditsNoPhantomValue` (partial — see note) |

---

## Differential conformance

`D-01` ✅ — For every scenario in `fixtures/canonical/`, the Solidity implementation, the
TypeScript preview library and the Python spec transcription produce **bit-identical** values for:
`marketValue`, `recognisedValue`, `borrowLimit`, `maintenanceLimit`, `liquidationLimit`,
`availableBorrow`, `healthFactor` and `status`.

Enforced by `make test-differential`, currently across 22 scenarios. A mismatch of one wei is a
failure, not a rounding difference — the whole point of freezing rounding in `accounting.md` is
that there is no such thing as an acceptable one-wei disagreement between implementations.

**Deviation recorded.** `accounting.md` names Rust (`crates/risk-core`) as the third
implementation. It is not written yet; `scripts/gen_fixtures.py` currently fills that role as a
direct transcription of the spec. The differential property holds — three independent
transcriptions agree — but the language does not match the plan, and the Rust engine is still
owed.

---

## Delegated authority

| # | Invariant | Status | Proof |
|---|---|---|---|
| I-40 | `AllowedAction = ProtocolAllows ∧ MandateAllows`. Neither check can satisfy a delegated call alone. | ENFORCED | `DelegatedAuthorityTest.test_aValidMandateCannotOverrideTheProtocol`, `.test_aProtocolLegalActionStillNeedsAMandate`; mutation "mandate check skipped entirely" |
| I-41 | A mandate can narrow protocol authority and can never widen it. | ENFORCED | Delegated calls run the same internal mechanics as owner calls (`_repay`, `_addCollateral`); `.test_aValidMandateCannotOverrideTheProtocol` |
| I-42 | An agent cannot withdraw user collateral, by any route. | ENFORCED | `.test_noDelegatedPathReachesAWithdrawal`, `.test_anOverlyBroadMandateStillCannotWithdraw`; mutation "any action becomes delegable" |
| I-43 | A revoked mandate cannot execute. | ENFORCED | `.test_aRevokedMandateCannotExecute` |
| I-44 | A paused mandate cannot execute; resuming restores it. | ENFORCED | `.test_aPausedMandateCannotExecuteAndResumingRestoresIt` |
| I-45 | An expired mandate cannot execute. | ENFORCED | `.test_anExpiredMandateCannotExecute` |
| I-46 | Authorization inputs are read from live protocol state, never supplied by the agent. | ENFORCED | `.test_theAuthorizationRequestReflectsLiveState`, `.test_theDebtCeilingIsEnforcedAgainstLiveDebt`; mutations on `projectedDebtUsd18` and `grossExposureUsd18` |
| I-47 | Owner actions never require a mandate. | ENFORCED | `.test_ownerActionsDoNotRequireAMandate` |
| I-48 | An agent funds its own delegated act; the account is never charged for it. | ENFORCED | `.test_theAgentFundsTheRepaymentItself`; mutation "account pays instead of the agent" |
| I-49 | Autonomous borrowing is refused until every bound is wired end to end. | ENFORCED | `.test_autonomousBorrowIsRefusedRatherThanHalfWired`; mutation "autonomous borrow silently enabled" |
| I-50 | Delegated intent reservation and partial-fill accounting. | SPECIFIED_NOT_ACTIVE | IntentBook holds the state machine; it is not yet wired to `ClearingHouse.reserve`. No delegable action reaches a venue today. |

**Not yet enforced, and named rather than implied.** Autonomous BORROW, TRADE, HEDGE and CLOSE are
all refused at the ClearingHouse boundary. The mandate vocabulary contains them and the registry
checks their caps correctly, but no venue execution path is wired, so granting them would authorise
an act with nowhere to go. `ActionNotDelegable` is the honest answer until that changes.

---

## Sentinels — autonomy plane (I-60…I-74)

Introduced with the Sentinels integration (`docs/SENTINELS_ARCHITECTURE.md`,
`docs/SENTINELS_SECURITY.md`), continuing the ledger after the delegated-authority set. Proofs are
Forge tests in `contracts/test/Sentinel.t.sol` and Vitest in `services/sentinel/test/*` and
`packages/schemas/test/sentinel-*.test.ts`.

| # | Invariant | Status | Proof |
|---|---|---|---|
| I-60 | A Sentinel cannot expand a mandate; widening needs a fresh owner signature. | ENFORCED | By construction (registries hold no MandateRegistry role) + `Sentinel.t.sol:test_registriesHoldNoRoleOverMoney` |
| I-61 | A template authorizes no money; neither registry holds a role over, or calls, a money contract. | ENFORCED | By construction (each imports only `Authority`) + `test_registriesHoldNoRoleOverMoney` |
| I-62 | A template update cannot alter an existing instance; versions are immutable, instances pin version + manifest hash. | ENFORCED | `test_versionsAreSequentialAndImmutable`, `test_newVersionDoesNotMutateEarlierVersionOrItsInstances`, `test_registrationPinsManifestAndRefusesMissingOrDisabled` |
| I-63 | Duplicate trigger delivery cannot duplicate financial effect; runId is derived and consumed once. | ENFORCED | `run-store.test` (openRun idempotent), `engine.test` (duplicate → one effect) |
| I-64 | EXECUTION_UNKNOWN releases nothing — no reservation, no budget. | ENFORCED | `sentinel-budget.test`, `engine.test` (unknown retains the reservation) |
| I-65 | A stale snapshot cannot execute; the live epoch is re-read at authorization. | ENFORCED | `engine.test` (epoch race → BLOCKED_BY_RISK_EPOCH) |
| I-66 | An AI-only / weak-authority observation cannot increase risk. | ENFORCED | `validate.test` (weak trigger + risk-increasing → CONFIRM) + trigger-injection cases |
| I-67 | Two Sentinels cannot reserve the same unit of capacity; onchain reservation is the only capacity truth. | ENFORCED | Existing reservation tests (I-19/I-23) re-cited; runtime ordering `supervisor.test` |
| I-68 | A SECURITY_DISABLED template starts no new runs and accepts no new instances. | ENFORCED | `test_registrationPinsManifestAndRefusesMissingOrDisabled` (TemplateDisabled) |
| I-69 | A budget cannot be overspent by concurrency or retry; consumption is idempotent per runId. | ENFORCED | `sentinel-budget.test`, `engine.test` |
| I-70 | A never-executed run pays no success fee; a retry cannot pay twice. | ENFORCED | `sentinel-budget.test` (fees accrue only on CONFIRMED) |
| I-71 | An external yield adapter cannot send funds to an arbitrary recipient. | SPECIFIED | Plan schema carries no recipient field; no venue adapter wired yet |
| I-72 | A public basket cannot activate without PUBLIC_ISSUANCE; a personal basket cannot silently become transferable. | PLANNED | Basket products not built |
| I-73 | A revoked or expired mandate blocks every run at authorization, whatever state it reached. | ENFORCED | `engine.test` (revoked → BLOCKED_BY_MANDATE), `receipt.test` (REJECTED_BY_POLICY, no tx) |
| I-74 | Low-authority evidence cannot increase collateral capability (restates I-18 over the Sentinel surface). | ENFORCED | `sentinel-observation` schema (authority capped at EVIDENCE_BOUND) + `validate.test` |

I-71 and I-72 are named now and refused by absence: no venue adapter and no basket issuance path
exists, so neither capability can be exercised at all. They move to ENFORCED when those features
ship with their own tests, not before.

---

## Domains and facilities — multi-domain layer (I-75…I-79)

Introduced with the domain/facility abstractions (`spec/facility-model.md`, `DECISIONS.md` D-022).
This layer is descriptive: it adds no on-chain contract and no money role, so several invariants
hold **by construction** — nothing reads the descriptors on a financial path. Proofs are Vitest in
`packages/schemas/test/{facility,domain}.test.ts` and `services/indexer/test/facility.test.ts`.

| # | Invariant | Status | Proof |
|---|---|---|---|
| I-75 | A facility's `FacilityImplementation` has exactly one authoritative home domain, and it is immutable once the facility is `ACTIVE`. There is no `setHomeDomain`. | ENFORCED | `homeDomainId` is an input to `facilityId` (`facility-model.md §4`), so a different home domain is a different facility; `assertValidFacilityTransition` rejects a home-domain / type / controller change on an `ACTIVE`-or-later descriptor. `facility.test.ts` |
| I-76 | Registering a `DomainDescriptor` grants no financial capability — no asset admission, no collateral, no borrowing, no transport authorisation, no venue authorisation, no oracle trust. | ENFORCED (by construction) | No money contract reads a `DomainDescriptor`. `domain.test.ts` asserts the schema carries no capability field and that an `ACTIVE` domain is inert without a separate admission/policy/adapter decision. |
| I-77 | Binding an `InstrumentIdentity` grants no `COLLATERAL` capability, LTV, risk status, borrowing authority or settlement authority. Completeness is necessary for `MULTI_DOMAIN_V2` admission, never sufficient. | ENFORCED (by construction) | No money contract reads the bindings artifact (Phase 01) or a completeness check. `facility.test.ts` asserts `assertInstrumentIdentityComplete` returns only a pass/fail and no capability. |
| I-78 | `facilityId` is unique per `(facilityType, homeDomainId, controller, discriminator)`. One controller can hold many facilities without collision; two descriptors that share the full tuple derive the same id, so a duplicate registration is detectable. | ENFORCED | `facility.test.ts` — collision matrix, one-controller-two-facilities, migration (new controller → new id, old preserved). |
| I-79 | Aggregated cross-domain read-model state is never settlement truth. A stale or unreachable domain renders as stale/unknown and cannot increase any usable/available figure; it can only restrict. | ENFORCED | `services/indexer/test/facility.test.ts` — a stale domain position is excluded from usable totals and marked; `aggregatePortfolio` carries per-position provenance and never sums a stale figure into "available". Restates `I-07` on the cross-domain surface. |

`Current state:` the count line at the top of this file is regenerated from source, not maintained
here.

---

## Corporate-action accounting (I-80…I-85)

Introduced with the corporate-action reference model (`spec/corporate-action-model.md`,
`DECISIONS.md` D-023). The reference model and adversarial campaign are Vitest in
`packages/corp-actions/test/*`; the deployed core is unchanged, so the invariants that concern a
future rebasing custody vault are `SPECIFIED` until that vault ships (Phase 09).

| # | Invariant | Status | Proof |
|---|---|---|---|
| I-80 | Conservation: for a corporate-action-capable instrument, `Σ effectiveOf(account) + classified dust == economically attributable vault position`, subject only to authorised deposits, withdrawals, liquidation transfers, issuer corporate actions and modelled fees. A corporate action may change economic units; it cannot make units appear for one account disproportionately or vanish into an unowned bucket. | ENFORCED (reference model) / SPECIFIED (on-chain V2 vault) | `conservation.test` — multi-user, deposit-before/after-action, partial withdrawal, liquidation, 3+ accounts, dust accumulation |
| I-81 | A rebase is not a deposit; a negative adjustment is not a withdrawal. An externally-driven balance change is a distinct accounting/event category (`RebaseObserved`), never `CollateralDeposited` / `CollateralWithdrawn`. | ENFORCED (reference model) | `applyAction` returns a `REBASE` effect with no deposit/withdraw side; `mutation.test` (rebase-as-deposit rejected) |
| I-82 | An unsolicited token transfer into custody is not a corporate action. An unprovenanced balance increase is classified as unattributed surplus and credited to no holder and no share. Where a token cannot distinguish a rebase from a donation on-chain, the conservative default is surplus. | ENFORCED (reference model) | `mutation.test` (balance change with no corporate-action provenance → surplus, not credited) |
| I-83 | Activation windows fail closed. Between announcement and `pendingActivationAt`, and while `feedStatus == PAUSED_FOR_ACTION`, new risk is blocked or capped; risk-reducing ops remain available; a pending factor never increases collateral privilege before it is authoritative; capacity uses the more conservative of `{factor, pendingFactor}`. | ENFORCED (reference model) | `activation.test` (pending 2× factor does not raise capacity pre-activation; repay still allowed) |
| I-84 | Price × quantity applies the corporate-action factor exactly once. `priceConvention` names the side that carries it; a 2× split with a 0.5× unit-price move preserves economic value before haircuts. | ENFORCED (reference model) | `valuation.test` split / reverse-split / dividend — value conserved; `mutation.test` (factor on both sides → detected) |
| I-85 | Stale corporate-action state cannot authorise new risk. A quote/RiskEpoch binds the `CorporateActionSnapshot` it used; a decision under snapshot N cannot execute under snapshot N+1 — it refuses or recomputes. `UNKNOWN` support never unlocks new risk. Restates `I-12` over corporate-action state. | ENFORCED (reference model) / SPECIFIED (on-chain enforcement for a future rebasing asset) | `staleness.test` (snapshot mismatch → refuse), `mutation.test` (stale factor + fresh oracle, and the reverse) |

Ingestion is idempotent and the event stream is not financial truth: the factor is reconciled from
authoritative chain state at the domain's safe depth, a duplicate announcement produces one
effect, an indexer restart reproduces the snapshot, and a reorg reconciles to canonical state
(`spec/corporate-action-model.md §10`, tests in `packages/corp-actions/test/ingestion.test`).

---

## Portfolio risk (I-86…I-93)

Introduced with the portfolio-risk reference model (`spec/portfolio-risk-model.md`, `DECISIONS.md`
D-024). Pure model in `packages/portfolio-risk`; no on-chain contract, so all invariants are
`ENFORCED` at the reference-model level and `SPECIFIED` for a future on-chain facility. Proofs are
Vitest in `packages/portfolio-risk/test/*`.

| # | Invariant | Status | Proof |
|---|---|---|---|
| I-86 | `PortfolioRecognizedValue ≤ Σ SingleInstrumentRecognizedValue`, and `≥ 0`. No diversification bonus: no combination of positions or correlation metadata can make the portfolio recognise more than the sum of its parts. | ENFORCED | `properties.test` (fuzzed over random portfolios, policies and group assignments) |
| I-87 | Portfolio risk runs over a facility's admitted collateral set on its home domain; an organisation-wide multi-domain holdings view is never collateral for one facility, and a global view never converts a remote-domain position into local borrowing power. | ENFORCED (model) / SPECIFIED (facility wiring) | `scope.test` — a position outside the facility's admitted set and home domain is excluded; `facility-model.md §8`, I-75 |
| I-88 | The result is permutation-invariant in the positions. Reordering the input yields the identical `PortfolioRecognizedValue` and the identical `constraintBreakdown`. | ENFORCED | `properties.test` (shuffle) |
| I-89 | Unknown metadata cannot improve portfolio capacity. Replacing a known group with UNKNOWN, or marking a shared group independent, or dropping a `RiskGroupRef`, never increases `PortfolioRecognizedValue`. | ENFORCED | `properties.test` + `mutation.test` (remove/UNKNOWN each dimension) |
| I-90 | A stricter policy parameter cannot increase `PortfolioRecognizedValue`. Lower any cap, a worse session factor, a larger stress haircut → same or lower. A policy change is a new version and a new `RiskEpoch`. | ENFORCED | `properties.test` (monotone over cap/session/stress perturbations); `mutation.test` (policy change without epoch movement flagged) |
| I-91 | A duplicate `instrumentId` in the input cannot be counted twice; positions are deduped (summed) by `instrumentId` before the formula runs. | ENFORCED | `properties.test`, `mutation.test` (duplicate instrument / duplicated recognized amount) |
| I-92 | Portfolio risk never rewrites principal already borrowed. A worse portfolio result reduces available new credit and can move the account's safety state deterministically; stored debt is unchanged. | SPECIFIED | `debt.test` — result carries only recognised value and status contribution, no debt/rate field; `spec/portfolio-risk-model.md §10` |
| I-93 | Overlapping constraints compose without unexplained double-counting (per-position `min` across dimensions, each cap against the original base), and adding an otherwise-eligible position never reduces the recognised value of unrelated existing collateral, nor produces a discontinuous cliff. | ENFORCED | `properties.test` (add-collateral around every threshold; unrelated-collateral-unchanged); `composition.test` (same underlying + same sector → `min`, not product) |

`INSTRUMENT` concentration is not a portfolio dimension — it is applied upstream by RiskMath
`accounting.md §4.6` (`maxConcentrationBps`), and the portfolio model consumes the already-capped
value.

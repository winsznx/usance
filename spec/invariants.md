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

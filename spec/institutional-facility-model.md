# spec/institutional-facility-model.md — the institutional secured-capital facility

Status: **frozen** for Phase 06. This is a **new** `FacilityImplementation`, not a change to any
deployed contract. `ClearingHouse` and the revolving-credit facility (`spec/facility-model.md §5`)
are untouched: no bytecode, no storage layout, no interface, no role. Changing a derivation or a
safety invariant here once a facility is `ACTIVE` is an RFC in `spec/rfcs/`.

This document answers: **how Usance holds an institutional secured-term financing facility whose
hero operation is "replace eligible collateral without unwinding the active facility", built as a
provider-neutral mechanism that Phase 07 adapters (Hedera ATS, ENSv2, Privy, Chainlink CRE) plug
into rather than reshape.**

`system.md §1` holds without exception: the institutional facility's controller is the **sole**
owner of financial truth for its facility. `FacilityDescriptor`, the indexer, ENS, Privy, CRE and
any database describe, authorise or observe. They never hold the number.

---

## 1. What this facility is, and is not

| Is | Is not |
|---|---|
| one bilateral secured-term facility: one borrower, one lender, one settlement asset, one principal, a maturity, exactly one active collateral commitment, and a safe path to swap that commitment | a prettier `ClearingHouse` |
| the authoritative home-domain owner of its facility's collateral custody, debt, fee, lifecycle and settlement | a revolving line, a repo book, a securities-lending desk, a margin engine, an OTC-derivatives ledger |
| provider-neutral: collateral custody, public/organisational authority and financial-policy approval are all interface seams | a place for Hedera / ENS / Privy / CRE types |
| `facilityType = TERM_SECURED_CREDIT` in the frozen `spec/facility-model.md §4` vocabulary | a generic "any institutional facility" contract |

`COLLATERAL_MANAGED_FACILITY` was the working name in the Product Lock brief; the frozen vocabulary
term is `TERM_SECURED_CREDIT`, and that is what the descriptor and `facilityId` use.

## 2. Identity and home domain — I-75, I-94

`facilityId` is derived exactly as `spec/facility-model.md §4`:

```
facilityId = keccak256(abi.encode(
    "USANCE_FACILITY_V1",
    "TERM_SECURED_CREDIT",
    homeDomainId,                 // bytes32 — one authoritative domain, forever
    controller,                   // canonicalRef of InstitutionalFacility (EVM: left-padded addr)
    discriminator                 // bytes32 — the per-facility serial (bilateral key), see §5
))

facilityPositionId = keccak256(abi.encode(facilityId, accountId))     // borrower's position
```

- There is **no `setHomeDomain`**, no `setBorrower`, no `setLender`, no `setController`. Each is an
  input to identity (`homeDomain` structurally; borrower/lender via `discriminator`), so changing
  one is a different `facilityId` — a migration, not an edit.
- All mutable facility state (collateral commitment, debt, fee accrual, substitution state,
  settlement state) lives on the home domain only. Phase 07 may use other chains for identity,
  signatures, confidential policy and asset lifecycle. None of that splits accounting authority
  (**I-75**, `SECURITY_AND_THREAT_MODEL.md §3`).
- One `InstitutionalFacility` **contract instance is one facility** in Phase 06. The
  `discriminator` is fixed at construction. A second facility is a second deployment (new
  `controller`, new `facilityId`), which is how a duplicate is detectable rather than silent
  (**I-94**).

## 3. Financial state owner

`InstitutionalFacility` owns and is the only authoritative source of:

| Field | Type | Frozen at |
|---|---|---|
| `facilityId` | bytes32 | construction (derived) |
| `homeDomainId` | bytes32 | construction |
| `discriminator` | bytes32 | construction |
| `borrower` | address | construction |
| `lender` | address | construction |
| `settlementAsset` | IERC20 + assetId + decimals | construction |
| `principalLimit` | usd-of-settlement, token units | construction |
| `maturityAt` | uint64 | construction |
| `interestRateBps` | uint16 (fixed, linear) | construction |
| `feePolicyVersion` / `originationFeeBps` | uint16 / uint16 (≤ `MAX_ORIGINATION_FEE_BPS = 50`) | construction |
| `collateralPolicyId` | bytes32 (RiskPolicyRegistry) | construction |
| `status` | `FacilityStatus` (§6) | mutable, state machine only |
| `principalDrawn` | token units | set once at activation |
| `feeCharged` | token units | set once at activation |
| `interestAccruedAt` / `interestAccrued` | uint64 / token units | mutable |
| `repaid` | token units | mutable |
| `collateral` | `{ instrumentRef, assetId, committedUnits, adapter }` | mutable via §7 only |
| `substitution` | `SubstitutionState` (§7) | mutable, state machine only |
| `riskEpochAtActivation` | uint64 | activation |

No other system stores any of this as authority. `FacilityDescriptor` carries identity + status
for discovery; the indexer projects a read model with provenance (`spec/facility-model.md §8`).

## 4. Counterparty roles — least privilege

| Role | Held by | May |
|---|---|---|
| `borrower` | the financed party | request substitution, repay, release collateral after settlement, claim residual |
| `lender` | the capital provider | fund, initiate recall, claim settlement proceeds |
| `operator` | a facility administrator (optional; `address(0)` disables) | advance non-financial lifecycle steps (submit a commitment reconciliation, mark an adapter response) — **never** moves value, **never** releases collateral, **never** settles |
| `GUARDIAN` (shared `Authority`) | protocol guardian | restrict only (§10) — pause creation-equivalent (activation), pause new substitution, block release **only where safety requires**. Cannot seize, forgive, widen, or settle. |
| `GOVERNANCE` (shared `Authority`) | protocol governance | lift a guardian restriction; set the shared verifier addresses; nothing facility-financial |

There is no single "admin" that owns everything. Governance cannot move a facility's money;
the borrower cannot release collateral without a committed replacement; the lender cannot seize.

## 5. Creation and activation

**Creation** (`constructor`) freezes every identity-and-terms field in §3. A freshly constructed
facility is `DRAFT` and is **not financeable**: no token has moved, `principalDrawn == 0`.

**Activation** (`activate()`), callable once, requires **all** of:

1. `status == PENDING_ACTIVATION` (reached from `DRAFT` by `lender` funding — see below);
2. caller is `lender` or `operator`;
3. the settlement asset is registered and priced fresh (reuse `IOracleAdapter` + the facility's
   `settlementMaxPriceAge`);
4. initial collateral committed: `collateral.committedUnits > 0`, observed through the adapter;
5. initial collateral eligible: a fresh `PolicyDecision` (§8) binding this `facilityId`, the
   `collateral.assetId`, the current `riskEpoch` and the collateral policy version;
6. a fresh `AuthorityDecision` (§8) authorising `ACTIVATE` for this facility;
7. post-activation coverage holds: `principalLimit_usd ≤ recognisedValue(collateral) × maintenanceLtv`
   using `RiskMath.valueAsset` and the bound `collateralPolicyId`;
8. `feePolicyVersion` set and `originationFeeBps ≤ MAX_ORIGINATION_FEE_BPS`;
9. `maturityAt > block.timestamp`;
10. lender funding present: `settlementAsset.balanceOf(this) ≥ principalLimit`.

On success, atomically:

```
principalDrawn  = principalLimit
feeCharged      = mulDivUp(principalDrawn, originationFeeBps, BPS)     // rounds toward the fee
borrowerProceeds = principalDrawn - feeCharged
transfer(feeCharged)      -> treasury
transfer(borrowerProceeds)-> borrower
riskEpochAtActivation = policies.riskEpoch()
status = ACTIVE
emit FacilityActivated + a receipt (§9)
```

A `DRAFT` facility cannot reach any financial function: every one asserts `status == ACTIVE` (or
a §7/§10 state), and `principalDrawn` is only ever written here.

## 6. Facility lifecycle

```
DRAFT
  --lender funds (settlementAsset.transferFrom lender -> facility, == principalLimit)-->  PENDING_ACTIVATION
PENDING_ACTIVATION
  --activate() [all §5 preconditions]-->  ACTIVE
  --lender withdrawFunding() [before activate]-->  DRAFT
ACTIVE
  --requestSubstitution()-->  SUBSTITUTION_PENDING          (§7)
  --repay() reaches zero outstanding, at/after nothing special-->  ACTIVE            (still ACTIVE; settlement is explicit)
  --borrower settle() with outstanding == 0-->  SETTLED
  --lender initiateRecall()-->  RECALLING
  --block.timestamp >= maturityAt (observed by anyone via poke())-->  MATURED
SUBSTITUTION_PENDING
  --releaseOld() completes-->  ACTIVE                                              (§7)
  --cancelSubstitution() / rejection-->  ACTIVE
RECALLING
  --borrower repays to zero-->  SETTLED
  --recallGracePeriod elapses with outstanding > 0-->  DEFAULTED
MATURED
  --borrower repays to zero-->  SETTLED
  --maturityGracePeriod elapses with outstanding > 0-->  DEFAULTED
SETTLED  (terminal for the facility; collateral release enabled, §7)
DEFAULTED  (terminal; collateral release routes to the lender, §10)
```

There is **no generic `FAILED`**. A known failure produces a specific status (`DEFAULTED`) or a
substitution **reason code**, never a catch-all. Substitution reason codes (fields on
`SubstitutionState`, not top-level statuses):

`SUBSTITUTION_REJECTED_STALE_EPOCH`, `SUBSTITUTION_REJECTED_STALE_AUTHORITY`,
`SUBSTITUTION_REJECTED_STALE_POLICY`, `SUBSTITUTION_REJECTED_INELIGIBLE`,
`SUBSTITUTION_REJECTED_INSUFFICIENT`, `SUBSTITUTION_REJECTED_COVERAGE`,
`SUBSTITUTION_REJECTED_CANCELLED`, `COMMITMENT_UNKNOWN` (transient, not terminal).

## 7. Collateral substitution — the flagship safety property

### 7.1 The central invariant (I-95)

```
OLD COLLATERAL NEVER BECOMES RELEASABLE UNTIL
  a valid replacement has been COMMITTED
  AND the facility remains safe after the replacement.
```

Structurally: `_releaseOldCollateral()` is **internal**, has exactly two callers
(`substituteAtomic` tail and `releaseOld`), and both first pass `_assertReleasable(req)`, which
requires every one of:

1. `status == SUBSTITUTION_PENDING` and `substitution.state == REPLACEMENT_COMMITTED`;
2. `req.id == substitution.id` (request identity matches this facility's one active request);
3. `req.replacementAssetId == substitution.replacementAssetId` (exact approved instrument);
4. `req.replacementInstrumentRef == substitution.replacementInstrumentRef`;
5. eligibility fresh: `policies.riskEpoch() == substitution.pinnedEpoch` **or** the pinned
   `PolicyDecision` explicitly permits the current epoch AND the direction is risk-reducing;
6. authority fresh: `substitution.authorityExpiry > block.timestamp` and not revoked
   (`authorityVerifier.isRevoked(req.authorityDecisionHash) == false`);
7. replacement committed amount verified **now**: `adapter.committedOf(this, replacementRef) ≥
   substitution.requiredUnits`;
8. post-replacement coverage passes: `outstanding_usd ≤ recognisedValue(replacement) ×
   maintenanceLtv`, recomputed from a fresh oracle read;
9. `substitution.consumed == false`;
10. no conflicting substitution: there is exactly one `SubstitutionState` slot; a second
    `requestSubstitution` while one is live reverts `SubstitutionAlreadyActive`.

`_releaseOldCollateral` sets `substitution.consumed = true` **before** the external
`adapter.release` call (checks-effects-interactions), releases the **old** units to a **fixed
destination** (the `borrower`; there is no recipient parameter), swaps `collateral` to the
replacement, and returns the facility to `ACTIVE`.

### 7.2 Substitution state machine

```
NONE
  --requestSubstitution(old, replacement, policyDecision, authorityDecision)-->  REQUESTED
      pins: pinnedEpoch, oldPassportVersion, replacementPassportVersion,
            collateralPolicyVersion, policyDecisionHash, authorityDecisionHash,
            authorityExpiry, requiredUnits, replacementAssetId, replacementInstrumentRef
REQUESTED
  --commitReplacement()-->  REPLACEMENT_COMMITTING        (calls adapter.commit(replacementRef, requiredUnits))
  --cancelSubstitution() / any pinned check fails-->  reason code, state -> NONE, facility -> ACTIVE
REPLACEMENT_COMMITTING
  --adapter.commit returned committedUnits >= requiredUnits synchronously-->  REPLACEMENT_COMMITTED
  --adapter signalled async / commit view still short-->  stays COMMITTING
  --reconcileCommitment() -> adapter.reconcile == UNKNOWN-->  COMMITMENT_UNKNOWN
COMMITMENT_UNKNOWN
  --reconcileCommitment() -> COMMITTED (>= requiredUnits)-->  REPLACEMENT_COMMITTED
  --reconcileCommitment() -> NOT_COMMITTED-->  SUBSTITUTION_REJECTED_INSUFFICIENT, state -> NONE, facility -> ACTIVE
REPLACEMENT_COMMITTED
  --releaseOld() [_assertReleasable]-->  OLD_RELEASED (consumed), facility -> ACTIVE with new collateral
```

**Forbidden transitions, asserted by tests:**

- `REQUESTED → OLD_RELEASED` — no.
- `REPLACEMENT_COMMITTING → OLD_RELEASED` — no.
- `COMMITMENT_UNKNOWN → OLD_RELEASED` — no.
- any `→ OLD_RELEASED` that skips `_assertReleasable` — unreachable (internal fn, two callers).

While `state ∈ {REQUESTED, REPLACEMENT_COMMITTING, COMMITMENT_UNKNOWN}` the **old collateral
stays locked**. A `reconcileCommitment` that returns `UNKNOWN` releases nothing (**I-97**,
restates I-23/I-64 over collateral commitment).

### 7.3 Atomicity

`substituteAtomic(...)` runs `requestSubstitution → commitReplacement → releaseOld` in one
transaction **only** when `adapter.commit` returns `committedUnits ≥ requiredUnits` synchronously
(the home-domain, plain-ERC20 case the test adapter models). It reuses the exact same internal
functions and the exact same `_assertReleasable`. If `commit` does not synchronously satisfy the
amount, the call **stops at `REPLACEMENT_COMMITTING`** and reverts nothing already done is
irreversible — the old collateral is still locked, and the two-phase path takes over.

There is no atomic path that reaches `OLD_RELEASED` without a synchronous, verified commit.

### 7.4 Concurrency (I-96)

Exactly **one** active substitution per facility in v1. `requestSubstitution` reverts
`SubstitutionAlreadyActive` if `substitution.state != NONE`. `settle()`, `initiateRecall()` and
`poke()`-to-`MATURED` all revert `SubstitutionPending` while one is live — the facility cannot
change lifecycle out from under an in-flight swap. A duplicate `requestId`, a replayed
`commitReplacement`, a duplicate adapter response and a worker retry are all idempotent: state is
keyed by the single slot and each transition asserts its precondition state.

## 8. Authority and policy decisions — provider-neutral, no boolean

Phase 06 defines two verifier interfaces. Phase 07 adapters (ENS/Privy for authority, CRE for
confidential policy) implement them. The facility **validates the binding**; it never accepts a
boolean from a caller.

```
IAuthorityVerifier.verify(AuthorityDecision d) -> bool ok
IPolicyVerifier.verify(PolicyDecision d)       -> bool ok
IAuthorityVerifier.isRevoked(bytes32 decisionHash) -> bool
```

Every decision (both kinds) binds, and the verifier checks, **all** of:

| Field | Why |
|---|---|
| `facilityId` | a decision for facility A cannot authorise facility D |
| `operation` | enum: `ACTIVATE`, `SUBSTITUTE`, `RECALL`, `SETTLE` — a decision for one cannot authorise another |
| `subjectAssetId` + `subjectInstrumentRef` | a substitution decision for collateral B cannot authorise collateral C |
| `requestId` | ties the decision to one substitution request; replay across requests fails |
| `pinnedEpoch` | the `riskEpoch` the decision was made under |
| `collateralPolicyVersion` | the policy version the decision was made under |
| `decisionVersion` | verifier schema version |
| `expiry` | `block.timestamp` past this authorises nothing |
| `nonce` | per-(facility, operation) monotone; a stale nonce fails |
| `proofRef` | bytes32 pointer to the off-chain decision record / receipt |
| `verifierSig` or membership proof | the verifier's own attestation; shape is the verifier's concern |

`decisionHash = keccak256(abi.encode(all fields above))`. The facility stores the hash, not the
decision, and re-checks `isRevoked(hash)` at release time (**I-98**).

## 9. Receipts

Uses the existing `usanceReceiptSchema` family (`services/evidence/src/receipt.ts`). New
`receiptKind` values, added to the enum:

`FACILITY_CREATED`, `FACILITY_ACTIVATED`, `COLLATERAL_COMMITTED`, `SUBSTITUTION_REQUESTED`,
`SUBSTITUTION_REJECTED`, `REPLACEMENT_COMMITTED`, `COLLATERAL_RELEASED`, `FACILITY_REPAID`,
`FACILITY_SETTLED`, `FACILITY_DEFAULTED`.

Each consequential receipt binds: `facilityId` (as `workflowId`), `homeDomain`, the operation /
`requestId` (as `intentId` where 32 bytes), participants (`accountId` = borrower), the
`financialAssetId` (old and/or replacement), quantities, the `policyDecisionHash` /
`authorityDecisionHash` (as `claimsRoot` / `evidenceRoot` slots or new nullable fields — chosen
so `receiptId` derivation is unchanged and every existing receipt still re-derives byte-for-byte),
`riskEpoch`, tx/block, before/after `status`, and the controller implementation version.

No separate institutional audit database is authoritative. The receipt aggregates; the chain is
the source.

## 10. Emergency behaviour

The institutional facility is **not** auto-wired to the deployed `EmergencyController`. Its
guardian surface is defined here and is restriction-only:

| Guardian power | Effect | Cannot |
|---|---|---|
| `pauseActivation(reason)` | `activate()` reverts | affect an already-`ACTIVE` facility |
| `pauseSubstitution(reason)` | `requestSubstitution` / `commitReplacement` revert; an in-flight `releaseOld` after a verified commit still completes (halting it would strand the old collateral released-pending with a committed replacement) | reverse a committed replacement |
| `blockRelease(reason)` | `releaseOld` reverts **only when** post-replacement coverage would fail — a safety brake, not a seizure. If coverage passes, release proceeds. | block a release that is safe; redirect it |
| `freezeNewInterest(reason)` | interest accrual stops advancing | reduce principal or forgive debt |

Guardian **cannot**: seize collateral to any recipient, forgive or reduce debt, raise
`principalLimit`, extend `maturityAt` favourably, mark `SETTLED`, or change `originationFeeBps`.
Repay and risk-reducing substitution stay available under every guardian restriction except an
explicit unsafe-release block. `GOVERNANCE` lifts each restriction; guardian cannot.

`DEFAULTED` routes the eventual collateral release destination to the `lender` instead of the
`borrower`. It does not transfer on its own — a `DEFAULTED` release is still a call, still bounded
by the adapter, still to a fixed (now lender) destination, no recipient parameter.

## 11. Financial accounting

```
outstanding(t) = principalDrawn + interestAccrued(t) - repaid
interestAccrued(t) = interestAccruedStored
                   + mulDiv(principalDrawn - repaidPrincipalPortion, interestRateBps × (t - interestAccruedAt), BPS × SECONDS_PER_YEAR)   [down]
```

Interest is fixed-rate and linear (no index, no compounding, no keeper dependency — a `poke()` or
any state-changing call advances `interestAccruedAt`). Repayment applies to interest first, then
principal (documented, tested). `repayAll` clears `outstanding` exactly and refunds any excess.

**Fee conservation (I-99):**

```
principalDrawn = borrowerProceeds + feeCharged
```

measured in settlement-token units, asserted as a Forge invariant. `feeCharged` is charged
**once**, at activation, on the single funding route. There is no second activation path.

**Settlement conservation (I-100):**

```
Σ (lender funding in)  ==  borrowerProceeds + feeCharged                       [at activation]
Σ (borrower repayments in)  ==  Δ(lender claimable) + Δ(treasury interest share if any)   [over life]
at SETTLED: outstanding == 0  AND  substitution.state == NONE  AND  no COMMITMENT_UNKNOWN
```

`settle()` reverts `OutstandingDebt` if `outstanding > 0`, and `SubstitutionPending` /
`CommitmentUnknown` if either is live. The indexer never marks a facility `SETTLED`; only the
controller does.

## 12. Contract placement

Phase 06 authors, under `contracts/src/institutional/`:

| Contract | Responsibility |
|---|---|
| `InstitutionalFacility.sol` | the whole facility: identity, lifecycle, funding, activation, accounting, fee, substitution state machine, settlement, guardian surface. One contract unless bytecode says otherwise. |
| `interfaces/ICollateralAdapter.sol` | provider-neutral collateral custody/commitment for one instrument |
| `interfaces/IAuthorityVerifier.sol` | public/organisational authority decision verification |
| `interfaces/IPolicyVerifier.sol` | financial-policy (eligibility + risk) decision verification |
| `libraries/FacilityMath.sol` | interest, fee, coverage — pure, reuses `RiskMath.mulDiv` / `mulDivUp` |

If `InstitutionalFacility` exceeds ~21 KB runtime (meaningful EIP-170 headroom), the substitution
state machine splits into `CollateralSubstitutionModule.sol` holding the `SubstitutionState` slot
and `_assertReleasable`, with the facility delegating. The split is driven by `forge build
--sizes`, recorded in the Phase 06 report, not chosen aesthetically.

Test adapters live in `contracts/test/institutional/` and are never imported by `src/`.

## 13. What does not change

- No deployed contract. Live X Layer 1952 still matches source. `ClearingHouse`, `CollateralVault`,
  `FinancingEngine`, `LiquidityVault`, `FeeController`, `EmergencyController`, every registry —
  bytecode, storage, interface, role — untouched.
- `spec/accounting.md` id derivations, `spec/facility-model.md`, `fixtures/canonical/`, the
  differential property — untouched. The institutional facility reuses `RiskMath` as a library;
  it does not re-transcribe the risk math.
- `usanceReceiptSchema` gains enum values and (if needed) nullable, null-defaulted fields;
  `receiptId` derivation is unchanged and every existing receipt re-derives byte-for-byte.
- Phase 06 deploys nothing. Proof level: `UNIT_TESTED` + `INTEGRATION_TESTED`. Live proof is
  Phase 07's sponsor adapters and testnet lifecycle.

Recorded as `DECISIONS.md` D-026. New invariants `I-94…I-100` in `spec/invariants.md`.

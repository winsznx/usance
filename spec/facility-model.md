# spec/facility-model.md — domains and facilities

Status: **frozen**. Additive to a live deployment. It introduces no on-chain contract (§10) and
moves no trust boundary, so it is a spec extension and not an RFC — `system.md §1`. Changing a
derivation formula here once an id is in use is an RFC in `spec/rfcs/`.

This document answers: **how Usance describes more than one market domain without making any of
them company-wide canonical, and how the existing revolving-credit engine is named as a facility
without changing its bytecode or its authority.**

`system.md §1` still holds without exception: `ClearingHouse` is the only owner of financial truth
for the existing revolving-credit facility. Everything in this file is descriptive or a read
model. Where a store and `ClearingHouse` disagree, `ClearingHouse` wins.

---

## 1. Four words, kept distinct

`IMPLEMENTATION_ORDER.md` and the Product Lock use "facility" and "registry" loosely. This spec
does not.

| Term | Is | Is not | Owns financial state? |
|---|---|---|---|
| **`FacilityImplementation`** | the home-domain contract(s) that hold a facility's collateral, debt, reservations and lifecycle. Today: `ClearingHouse` (+ `CollateralVault` / `FinancingEngine` / `LiquidityVault`) for the revolving-credit facility. Later: a separate `InstitutionalFacilityController` (Phase 06). | a metadata row; a read model | **yes** |
| **`FacilityDescriptor`** | an immutable-once-active metadata record: identity, type, home domain, controller address, settlement asset, participants, status. Off-chain config today (`deployments/facility-descriptors.json`); a `FacilityRegistry` contract only if and when an on-chain consumer exists. | the thing that holds debt; permission to do anything | no |
| **`FacilityReadModel`** | the indexer's derived view of a facility or a position within it, carrying provenance (source block, finality, authoritative controller, freshness) on every figure. | authoritative; a settlement record | no |
| **`FacilityAdapter`** | a zero-authority read facade that exposes a common shape over an existing `FacilityImplementation` — e.g. reading `ClearingHouse` account state into a `FacilityPositionView`. | an inheritance parent of `ClearingHouse`; a writer of core state | no |

**`ClearingHouse` does not inherit any facility interface.** It has 86 bytes of EIP-170 headroom
and is live. A common shape, where useful, is an additive `FacilityAdapter` read facade, never a
change to the deployed core.

## 2. One facility, one home domain

Locked (`DECISIONS.md` D-104, invariant `I-75`).

A facility's **`FacilityImplementation`** has exactly one authoritative domain for collateral
custody, debt, reservations, lifecycle state and settlement finality. The home domain is an input
to the facility's identity (§4), so:

- there is no `setHomeDomain()` — changing the home domain changes the `facilityId`, which means it
  is a different facility;
- moving a live facility across domains is a deliberate sequence: settle or terminate the old
  facility, create a new facility identity on the new domain, and keep the old descriptor and every
  receipt it produced as history with `status = MIGRATED` and a `migratedTo` pointer;
- `assertValidFacilityTransition(prev, next)` rejects any transition that changes
  `facilityType`, `homeDomainId`, `controller` or `facilityId` once `prev.status` is `ACTIVE` or
  later. Tested.

Cross-domain identity, evidence, authority and cash transport may exist around a facility. They
never split its accounting authority (`SECURITY_AND_THREAT_MODEL.md §3`, invariant `I-75`).

## 3. Domains describe; they do not admit

A `DomainDescriptor` is metadata. Registering one grants **no** financial capability (invariant
`I-76`).

```
DomainDescriptor {
    domainId          keccak256(abi.encode("USANCE_DOMAIN_V1", caip2))   // == identity-model.md
    caip2             "eip155:1952" | "eip155:8453" | "hedera:testnet" | …
    label             human name
    environment       PRODUCTION | TESTNET | LOCAL
    finalityModel     { kind: "l2-sequencer" | "pos" | "hashgraph" | "other",
                        safeDepthBlocks: uint, notes: string }
    nativeAsset       { symbol, decimals }
    explorerUrl
    adapterVersions   { instrument?: string, oracle?: string, cashTransport?: string, venue?: string }
    status            ACTIVE | PAUSED | RETIRED
}
```

A `DomainDescriptor` with `status = ACTIVE` still does **not** by itself:

- admit any asset or instrument;
- enable collateral, borrowing, lending or repo;
- authorise a cash transport route;
- authorise an execution venue;
- make any oracle trusted.

Those remain separate admission / `RiskPolicy` / adapter-registration decisions, each with its own
authority (`system.md §4`). The domain descriptor is the answer to "what is this chain and how
final is it", nothing more.

## 4. Facility identity

```
facilityId = keccak256(abi.encode(
    "USANCE_FACILITY_V1",
    facilityType,     // closed vocabulary, string
    homeDomainId,     // bytes32
    controller,       // bytes32 — canonical reference of the controlling contract
                      //   EVM:    left-padded address (identity-model.md canonicalRef)
                      //   native: keccak256(abi.encode("USANCE_NATIVE_REF_V1", nativeId))
    discriminator     // bytes32 — distinguishes facilities that share the tuple above.
                      //   revolving-credit singleton: the settlement assetId.
                      //   institutional: a per-facility serial or bilateral key.
))

facilityPositionId = keccak256(abi.encode(facilityId, accountId))
```

Decisions, frozen:

| Question | Answer |
|---|---|
| What makes a facility unique | `facilityType` + `homeDomainId` + `controller` + `discriminator` |
| Does facility type participate | yes |
| Does home domain participate | yes — this is what makes §2 structural |
| Does the controller address participate | yes, as a domain-neutral canonical reference |
| Is there a separate `facilityVersion` field | no. An in-place (proxy) upgrade keeps the controller address, so `facilityId` is unchanged and identity is preserved. A redeployment to a new address changes `controller`, so it is a new `facilityId` — a migration, and the old facility is preserved historically. |
| Can one controller hold many facilities | yes — distinct `discriminator`. Two descriptors that share the full tuple derive the same `facilityId`, which is how a duplicate registration is detectable rather than silent. Tested for collision. |
| What is a per-borrower position | `facilityPositionId`. Within the revolving-credit implementation each borrower account is a position in the one facility, not a facility of its own. |

`facilityType` vocabulary: `REVOLVING_CREDIT`, `TERM_SECURED_CREDIT`, `REPO`, `SECURITIES_LENDING`,
`COLLATERAL_ONLY`.

`FacilityStatus`: `DRAFT`, `PENDING_ACTIVATION`, `ACTIVE`, `SUSPENDED`, `SETTLING`, `SETTLED`,
`MIGRATED`.

## 5. The existing revolving-credit facility

Named, not changed:

```
FacilityDescriptor {
    facilityId     = H("USANCE_FACILITY_V1", "REVOLVING_CREDIT",
                       domainId("eip155:1952"),
                       canonicalRef(ClearingHouse address),
                       ClearingHouse.settlementAssetId())
    facilityType   = REVOLVING_CREDIT
    homeDomainId   = domainId("eip155:1952")
    controller     = deployments/1952.json .contracts.clearingHouse
    settlementAssetId = deployments/1952.json .settlementAsset.assetId
    status         = ACTIVE
    implementation = { ClearingHouse, CollateralVault, FinancingEngine, LiquidityVault }
}
```

Generated into `deployments/facility-descriptors.json` from the manifest, under the artifact
freshness discipline (`_artifact.mjs`, D-015). A redeploy of `ClearingHouse` changes `controller`
and therefore `facilityId`; the check refuses a descriptor whose controller no longer matches the
live manifest.

The `FacilityAdapter` for it is a read facade: `services/indexer` reads `ClearingHouse` account
state and projects a `FacilityPositionView`. It writes nothing and holds no role.

## 6. Passport identity completeness

Phase 01 made the Passport Identity section optional so no legacy or deployed record broke. That is
a compatibility allowance, not the production rule.

```
AdmissionProfile:
  LEGACY_V1      — the deployed X Layer testnet path. `identity` may be absent. Unchanged.
  MULTI_DOMAIN_V2 — any instrument admitted under the multi-domain architecture (Base, X Layer
                    production, Hedera). `identity` MUST be present and MUST resolve to a complete
                    InstrumentIdentity: a real DomainId, IssuerIdentity and instrument standard,
                    and an UnderlyingReference that is not ticker-only.
```

`assertInstrumentIdentityComplete(candidate, "MULTI_DOMAIN_V2")` is the enforcement point, used by
the admission-validation layer and by the domain adapters (Phase 08/09). It does **not** touch the
deployed `PassportRegistry.commitPassport` ABI — completeness is checked before a governance signer
is handed calldata, the same place `passportCandidateSchema` is checked today.

A Base or X Layer production canary asset cannot be admitted with a ticker-only or
identity-incomplete Passport. Invariant `I-77` restates that binding an identity still grants no
capability — completeness is necessary, never sufficient.

## 7. Corporate-action state is still not identity

Unchanged from `identity-model.md §5`. `instrumentId` and `facilityId` never contain a multiplier,
rebasing factor, market-session state, price, pause state or current eligibility. Phase 03 builds
the accounting around those mutable states; they live in adapter/vault state, keyed by the stable
ids, never in an id.

## 8. Global read model is not global settlement

The indexer may aggregate positions across Base, X Layer, Hedera and future domains into one
organisational portfolio view. That view is a **read model** (invariant `I-79`).

Every position in it retains:

- `instrumentId` and its `homeDomain`;
- the source block and that domain's finality state for the figure;
- the authoritative controller / custody source;
- freshness (when the figure was observed, against that domain's safe depth).

Rules:

- A domain whose state is stale or unreachable renders as **stale / unknown**, never as zero and
  never as a last-known value presented as current.
- Stale or unknown domain state **cannot increase** any "usable" or "available" figure. It can only
  restrict (this is `I-07` — degraded inputs can only restrict — carried onto the cross-domain
  surface).
- No financial contract ever reads the aggregate. It is a display and monitoring artifact. A
  facility's controller finalises that facility's state and nothing else does.

## 9. Adapter interfaces express semantics, not vendors

The generic interfaces are frozen around Usance's requirements. Vendor packages adapt **into**
them; no vendor type appears in a generic signature (`interfaces.md §1`).

| Interface | Status | Where |
|---|---|---|
| `IOracleAdapter` / `OracleProvider` | built / frozen | `interfaces.md §4`, `§7.5` |
| `LiquidityObservationProvider` | frozen | `interfaces.md §7.6` |
| `VenueAdapter` / `IVenueAdapter` | frozen; `reserve()` deliberately absent (would hold accounting) | `interfaces.md §7.7`, `§5` |
| `CashTransport` / `ICashTransport` | frozen | `interfaces.md §7.8`, `§5` |
| `IInstrumentAdapter` | **added here**, spec-only until a consumer (Phase 08) | `interfaces.md §5` |

`IInstrumentAdapter` — the shape a domain adapter presents for one instrument:

```
canonicalIdentity()      -> the InstrumentIdentity fields (domain-neutral)
accountingMode()         -> InstrumentAccountingMode
decimals()               -> uint8
effectiveBalanceOf(acct) -> the balance that matters NOW, after any multiplier/rebase
transferable()           -> bool + reason        (pause / freeze / compliance window)
corporateActionState()   -> { pending: bool, kind, windowEndsAt }
lock(acct, amount) / release(acct, amount)   -> custody ops, home-domain only
```

Obligations (same as every adapter, `system.md §1`): no per-account accounting storage; a failure
degrades to a restrictive reading, never a revert that bricks a holder; it translates, it never
decides.

`IExecutionVenue` preserves the IntentBook sequence without exception: `quote → reserve → submit →
query → reconcile`, and `EXECUTION_UNKNOWN` releases nothing (`I-23`, `I-64`). Any Phase 02
interface work that would let a venue bypass that sequence or make `EXECUTION_UNKNOWN` releasable
is rejected.

`ICashTransport` is transport, not settlement authority. A CCTP / bridge receipt proves cash moved.
It does **not** prove debt was repaid, collateral released or a facility settled — only the
home-domain `FacilityImplementation` finalises those. The interface returns a transport ticket; a
facility state change is a separate call to the controller.

## 10. No on-chain contract in Phase 02, and why

Phase 02 adds spec, schemas, a generated descriptor artifact and indexer read models. It adds **no
Solidity**.

`MIGRATION_PLAN.md §2–3` scopes this phase as "domain registry/config **packages**" and
"`CapitalFacilityDescriptor` in **schemas / read models**". An on-chain `DomainRegistry`,
`InstrumentRegistry` or `FacilityRegistry` has no consumer until:

- Phase 06 — the `InstitutionalFacilityController`, which needs a real on-chain facility record;
- Phase 08 — the Base domain adapter and its deployment;
- Phase 09 — the X Layer production adapter and its deployment.

Each of those is a deliberate deployment with its own manifest, role plan, bytecode verification
and proof. Authoring undeployed registry contracts now would be dead code that the consuming phase
would reshape once it has a real caller, and it would add EIP-170 and audit surface for no current
benefit.

The invariants that matter are enforced where they matter: the one-home-domain rule is structural
in the `facilityId` derivation and checked in `assertValidFacilityTransition`; "a domain grants no
trust" and "an instrument binding grants no capability" are true by construction because no money
contract reads any of this (`I-76`, `I-77`); and the existing facility's authority is `ClearingHouse`,
unchanged.

This changes no locked decision (D-104, D-106, D-107, D-021 are all "additive / no mega-contract /
no bytecode change"), so it is not an RFC. Recorded as `DECISIONS.md` D-022.

## 11. What does not change

- No deployed contract: no bytecode, storage layout or interface. Live X Layer 1952 still matches
  source.
- `accounting.md §2` id derivations, `identity-model.md`, `fixtures/canonical/`, the differential
  property — untouched.
- Every historical `assetId`, `passportId`, `receiptId`, `evidenceId` and proof reference — valid,
  unedited, and now additionally resolvable to a domain and a facility.
- `usanceReceiptSchema` gains two optional, null-defaulted fields (`homeDomain`, `instrumentId`);
  `receiptId` derivation is unchanged and every existing receipt still parses and re-derives
  byte-for-byte (tested in `services/evidence/test`).

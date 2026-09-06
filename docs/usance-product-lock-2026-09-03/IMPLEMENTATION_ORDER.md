# IMPLEMENTATION_ORDER.md

This is the dependency-driven order for Claude/Codex **after Product Lock approval**.

## Phase 00 — repo truth and baseline

- [ ] Verify actual HEAD and dirty tree.
- [ ] Re-run all current gates.
- [ ] Regenerate test counts.
- [ ] Regenerate master checklist.
- [ ] Regenerate proof ledger counts.
- [ ] Verify current X Layer manifests/bytecode/transactions.
- [ ] Freeze ETHOnline Continuity baseline at official kickoff.
- [ ] Record all doc/code conflicts.

**Exit:** one current source of truth.

## Phase 01 — identity migration

- [ ] Define `DomainId`.
- [ ] Define `UnderlyingReference`.
- [ ] Define `IssuerIdentity`.
- [ ] Define `InstrumentIdentity`.
- [ ] Define `InstrumentAccountingMode`.
- [ ] Extend Passport schema.
- [ ] Migration mapping for current assets.
- [ ] Prevent ticker-only identity.
- [ ] Preserve historical proof ids.

**Why first:** every domain adapter depends on correct identity.

## Phase 02 — domain/facility abstractions

- [ ] Define `CapitalFacilityDescriptor`.
- [ ] Freeze one-home-domain invariant.
- [ ] Add DomainRegistry/read config outside money contracts.
- [ ] Map existing ClearingHouse as revolving-credit implementation.
- [ ] Define institutional facility interfaces.
- [ ] Define adapter interfaces.
- [ ] Add cross-domain ids to receipts/indexer.

**Exit:** no chain-specific branching needed in core.

## Phase 03 — corporate-action accounting

- [ ] xStocks multiplier harness.
- [ ] B20 multiplier harness.
- [ ] multi-user conservation.
- [ ] split/reverse-split/dividend.
- [ ] activation window gates.
- [ ] deposit/withdraw/borrow/liquidation around action.
- [ ] mutation tests.

**Exit:** selected stock asset cannot silently corrupt books.

## Phase 04 — portfolio risk

- [ ] Reference model.
- [ ] issuer/underlying/custodian concentration.
- [ ] sector/correlation stress.
- [ ] liquidity-depth aggregation.
- [ ] market-session restrictions.
- [ ] mixed-instrument scenarios.
- [ ] Solidity/reference differential tests.

**Exit:** Base portfolio credit has a real risk model.

## Phase 05 — finish existing P0 product gaps

- [ ] LP wallet deposit/withdraw.
- [ ] capital-user asset detail.
- [ ] mandate pause/resume.
- [ ] Sentinel authenticated arming/live proof if still open.
- [ ] current explorer verification.
- [ ] origination fee gap.

**Exit:** old Usance core isn't left half-finished while new domains grow.

## Phase 06 — institutional facility core

- [ ] InstitutionalFacilityController.
- [ ] pledge.
- [ ] facility activation.
- [ ] substitution request.
- [ ] replacement commitment.
- [ ] old release.
- [ ] recall/settle.
- [ ] atomicity/failure tests.
- [ ] receipt model.

**Exit:** works locally with deterministic mock adapters before sponsors.

## Phase 07 — ETHOnline sponsor adapters

Parallelizable only after Phase 06 interface freeze:

### ENSv2
- [ ] current capability probe;
- [ ] canonical hierarchy authority read;
- [ ] facility/name records;
- [ ] revocation test.

### Privy
- [ ] org wallet;
- [ ] quorum/policy;
- [ ] real signing;
- [ ] negative approval test.

### Chainlink CRE
- [ ] re-read final sponsor rules;
- [ ] confidential policy workflow;
- [ ] decision binding/expiry/replay tests.

### Hedera ATS
- [ ] issue Treasury A/B/C;
- [ ] compliance/lock state;
- [ ] substitution settlement;
- [ ] HashScan receipts.

**Exit:** full positive + negative ETHOnline path.

## Phase 08 — Base domain

- [ ] B20 official registry ingestion.
- [ ] Base oracle/session mapping.
- [ ] USDC.
- [ ] liquidity observer.
- [ ] liquidation route.
- [ ] Base deploy config.
- [ ] Base UI onboarding.
- [ ] low-cap canary proof on testnet/fork before mainnet.

## Phase 09 — X Layer production domain

- [ ] xStocks exact-address adapter.
- [ ] corporate-action-safe custody.
- [ ] X Layer oracle/session.
- [ ] native USDC/CCTP.
- [ ] OKX DEX adapter/handoff.
- [ ] Builder Code current proof.
- [ ] Exchange OS only if access.
- [ ] OKX Dev Day new-work evidence.

## Phase 10 — 0G evidence intelligence

- [ ] refresh 0G provider catalogue.
- [ ] `@usance/zerog`.
- [ ] Direct provider route.
- [ ] attestation/provenance schema.
- [ ] Evidence Vault.
- [ ] compute extractor.
- [ ] Ask Usance.
- [ ] prompt-injection/verification failure tests.

## Phase 11 — institutional UI/API + developer product

- [ ] Facility workspace.
- [ ] substitution UI.
- [ ] approval/policy timeline.
- [ ] issuer/readiness.
- [ ] broad API.
- [ ] webhooks.
- [ ] global search/toasts.
- [ ] accessibility/mobile.

## Phase 12 — production operations

- [ ] structured logs;
- [ ] metrics;
- [ ] alerting;
- [ ] production stores;
- [ ] KMS/quorum;
- [ ] runbooks;
- [ ] incident drills;
- [ ] external audit;
- [ ] canary caps;
- [ ] bug bounty/monitoring plan.

## Phase 13 — first real-capital Base canary

Only after all gates PASS.

- [ ] deploy;
- [ ] verify;
- [ ] seed bounded liquidity;
- [ ] admit exact assets;
- [ ] live borrow/repay/withdraw;
- [ ] live liquidation rehearsal/cap;
- [ ] public proof;
- [ ] daily monitoring;
- [ ] no cap raise without data + governance.

## Parallel-agent rule

Parallelize implementation units only when shared schemas/invariants are frozen.

One orchestrator owns:

- domain model;
- accounting semantics;
- invariant numbering;
- migrations;
- proof schema.

Workers may own adapters/UI/tests, never independently redefine the financial model.

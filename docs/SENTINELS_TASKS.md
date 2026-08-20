# Usance Sentinels — task ledger

The authoritative census of Sentinel work. A box is ticked only when the thing is implemented
**and** tested **and** reachable where a user surface is required — the same rule as
`docs/MASTER_COMPLETION_CHECKLIST.md`, which mirrors these under section AN.

Priorities: **P0** blocks the Sentinel lifecycle end to end. **P1** required for product,
security or operational completeness. **P2** polish or breadth. **BLOCKED** names a real external
dependency, never "hard".

---

## 1. Domain schemas (`packages/schemas/src/sentinel-*.ts`, `mandate-actions.ts`)

Split across focused modules rather than one file: `sentinel-triggers`, `sentinel-run`,
`sentinel-template`, `sentinel-instance`, `sentinel-budget`, `sentinel-draft`,
`sentinel-observation`, `sentinel-market`, `mandate-actions`. 124 unit tests green, package
typecheck clean, whole-workspace typecheck clean.

- [x] **P0** Define `SentinelTemplateManifest` schema (identity, riskClass, requiredActions, requiredTriggerClasses, config/trigger/plan schema hashes, feePolicy, compilerVersion, promptVersion, minimumProtocolVersion)
- [x] **P0** Define `SentinelTemplateVersion` + canonical manifest hashing (keccak256 over canonical JSON)
- [x] **P0** Define `SentinelInstance` schema (owner, account, template pin, mandateId, agentExecutor, config, triggerPolicy, budgetPolicy, priorityClass, confirmationPolicy, lifecycle, validity window)
- [x] **P0** Define instance lifecycle enum `DRAFT / AWAITING_MANDATE / ARMED / PAUSED / BLOCKED / EXPIRED / REVOKED` with legal-transition table
- [x] **P0** Define `TriggerSpec` discriminated union (ONCHAIN_STATE, RISK_STATE, PASSPORT_STATE, ORACLE_STATE, MARKET_STATE, TIME, CORPORATE_ACTION, EVIDENCE_OBSERVATION, AI_OBSERVATION, MANUAL, COMPOSITE)
- [x] **P0** Define `TriggerAuthorityClass` ordering (DETERMINISTIC_ONCHAIN … LOW_TRUST_OBSERVATION) and per-class identity derivation `triggerIdFor`
- [x] **P0** Define `SentinelSnapshot` schema (block pin, RiskResult figures, epoch, passports, mandate state + remaining budgets, config hash, session state, oracle rounds)
- [x] **P0** Define `SentinelPlan` schema per action class, with **no free-form recipient field on any action**
- [x] **P0** Define `SentinelRun` record + run state enum + legal-transition table (no generic FAILED state)
- [x] **P0** Define `runIdFor(instanceId, triggerId, triggerVersion)` derivation
- [x] **P0** Define `SentinelBudget` (per-run, rolling day/window, total, run-rate, fee, slippage, cooldown, max outstanding reservation) + `BudgetLedgerEntry` keyed by runId
- [x] **P0** Define `SentinelPriority` enum P0_EMERGENCY_RISK_REDUCTION … P4_YIELD_OPPORTUNISTIC
- [x] **P0** Define `SentinelDraft` schema, `.strict()`, every §11 field, parse-don't-repair
- [x] **P0** Define `ConfirmationPolicy` union (AUTO_WITHIN_MANDATE, CONFIRM_EVERY_ACTION, CONFIRM_RISK_INCREASING, CONFIRM_ABOVE_AMOUNT, CONFIRM_WEAK_TRIGGER)
- [x] **P1** Define `SentinelObservation` (provenance-stamped, low-trust source classes only)
- [x] **P1** Define `MarketSession` model (OPEN/PRE_MARKET/POST_MARKET/CLOSED/UNKNOWN; UNKNOWN restrictive)
- [x] **P1** Define `SentinelTemplateStats` (receipt-derived marketplace statistics)
- [x] **P1** Define Sentinel receipt kinds in the existing `UsanceReceipt` family (SENTINEL_RUN_EXECUTED / _BLOCKED / _NO_ACTION added to `services/evidence/src/receipt.ts`; projection in `services/sentinel/src/receipt.ts`)
- [x] **P0** Unit tests: every schema rejects unknown fields; ids are stable across key order; transition tables refuse illegal edges

## 2. Contracts

Both registries compile (solc 0.8.28), deploy at 4.4KB / 4.6KB — far under EIP-170 — and hold no
role over any money contract. 12 dedicated Forge tests plus the extended deployment guard; the full
Forge suite is 244 passing.

- [x] **P0** `SentinelTemplateRegistry.sol`: `commitTemplate` with strictly sequential versions, immutable once committed
- [x] **P0** `SentinelTemplateRegistry`: requiredActions bitmask validated against the mandate vocabulary size (bits above it rejected; `MANDATE_ACTION_COUNT` mirrors `MandateRegistry.ACTION_COUNT`, asserted equal by test)
- [x] **P0** `SentinelTemplateRegistry`: fee policy bounded by contract constants at commit
- [x] **P0** `SentinelTemplateRegistry`: status ladder ACTIVE→DEPRECATED→SECURITY_DISABLED, publisher may deprecate own, GUARDIAN may restrict anything, only GOVERNANCE lifts, ordinal-only-increases guard
- [x] **P0** `SentinelInstanceRegistry.sol`: `registerInstance` binding owner/account/template-pin/mandateId/agentExecutor/configHash, refusing missing or SECURITY_DISABLED template versions
- [x] **P0** `SentinelInstanceRegistry`: pause/resume by owner, pause by GUARDIAN (owner cannot lift a guardian pause), terminal `revoke`
- [x] **P0** Neither registry holds or requires any role over money contracts — by construction (each imports only `Authority` and, for the instance registry, the template registry; never ClearingHouse/vaults/MandateRegistry) and asserted by `test_registriesHoldNoRoleOverMoney`
- [x] **P0** Forge tests: version immutability, pin integrity, status ordinal guards, instance-over-disabled-template refusal, guardian/owner pause asymmetry
- [x] **P0** Extend `Deployment.t.sol` size guard to both new contracts (bytecode headroom test)
- [x] **P1** Additive deploy script (`script/DeploySentinels.s.sol`) — core untouched, manifest gains two entries
- [x] **Deployed both registries to X Layer testnet (1952) additively; `deployments/1952.json` updated. Live-exercised: committed T1, registered a pinned instance, and a mined `ManifestMismatch` revert (I-62). Full record in `docs/SENTINELS_DEMO.md`.**
- [ ] **P2** Slither run over new contracts; triage any findings into the baseline with reasons

## 3. Runtime — `services/sentinel`

Package `@usance/sentinel` built on the evidence seams (RunStore mirrors WorkflowStore; ChainView is
a narrow, mockable interface). 31 tests green, typecheck clean, whole-workspace typecheck clean. The
`SentinelEngine` drives one trigger through open → gate → snapshot → compile → validate → reserve →
authorize → execute → reconcile, proven end to end against a mock chain that a repay actually makes
safer; terminal runs project to `UsanceReceipt`s and a supervisor drains work in priority order and
recovers after a crash. The IntentBook venue path remains open (no venue action exists yet).

- [x] **P0** Package scaffold `@usance/sentinel` (vitest, typecheck, zero vendor types in exported signatures)
- [x] **P0** Run state machine as data (`TRANSITIONS` table) + pure `advance()` in the workflow.ts idiom (reused from `@usance/schemas`)
- [x] **P0** `RunStore` implementing the `WorkflowStore` seam (file-backed adapter + in-memory adapter), optimistic concurrency
- [x] **P0** `openRun` idempotency: duplicate trigger delivery returns the existing record, terminal runs never resurrect
- [x] **P0** Trigger ingestion: `TriggerIngestor` normalising onchain events / schedule ticks / observations into `TriggerEvent`s with derived ids
- [x] **P0** Trigger deduplication test: same delivery twice → one run
- [x] **P0** `TriggerEvaluator`: match events against ARMED instances' TriggerSpecs, stamp authority class
- [x] **P0** RiskEpoch trigger (account + epoch identity)
- [x] **P0** Account-safety trigger (health/status change)
- [x] **P0** PassportChanged trigger (assetId + version identity)
- [x] **P0** Scheduled trigger with time-bucket dedup identity (interval; calendar window P1)
- [x] **P1** Observation trigger (AI_OBSERVATION, content-hash identity)
- [x] **P1** MANUAL trigger (owner-nonce identity)
- [ ] **P2** COMPOSITE trigger evaluation — matcher handles COMPOSITE by member class; full conjunction-over-window evaluation pending
- [x] **P0** `SnapshotBuilder` over a `ChainView` (block pin, accountHealth, epoch, mandate liveness + remaining budgets, passport versions)
- [x] **P0** `PlanCompiler` dispatch: template id → deterministic compiler; unknown template → PLAN_REJECTED (BLOCKED_BY_POLICY is unreachable from PLANNING in the state machine)
- [x] **P0** `PlanValidator`: strict plan schema, risk-class rules, budget check, session policy (explicit plan-schema-hash match deferred; strict `sentinelPlanSchema` parse enforced)
- [x] **P0** Weak-trigger asymmetry enforced: AI/weak trigger + risk-increasing plan → WAITING_USER_CONFIRMATION, never AUTHORIZED; risk-reducing-only template refuses outright (I-66)
- [x] **P0** `AuthorizationChecker`: preview + live epoch + mandate liveness/expiry re-read before submit (I-65, I-73)
- [x] **P0** Budget ledger: idempotent consumption keyed by runId; retry cannot double-consume; EXECUTION_UNKNOWN holds consumption (I-64, I-69)
- [x] **P0** Cooldown enforcement between financially-effective runs
- [x] **P0** `SignerProvider` interface + `LocalTestSigner` (test-chain-only) + `EnvKeySigner` (testnet ops, redacting)
- [x] **P1** `KmsSignerProvider` shape with ACCESS_REQUIRED status (not faked)
- [x] **P0** `ExecutionCoordinator`: DelegationGateway path for REPAY/ADD_COLLATERAL, idempotent on runId
- [ ] **P1** `ReservationCoordinator`: IntentBook path (create/validate/reserve/submit) for venue actions — specified, not built (T1 uses no venue)
- [x] **P0** `Reconciler`: unknown execution resolved by chain lookup; EXECUTION_UNKNOWN releases nothing; success confirms, revert releases
- [x] **P0** `ReceiptWriter`: terminal runs → `UsanceReceipt`; CONFIRMED refused without a success tx (enforced by the receipt schema); NO_ACTION writes no receipt
- [x] **P0** `SentinelSupervisor`: priority-ordered drain (a yield instance yields to safety on the same account) + `recover()` reconciling every resumable run after a crash (tested)
- [x] **P0** Priority arbitration seam: P4 plan refused while same-account higher-priority work pending (`higherPriorityPending` gate)
- [ ] **P1** Preemption of un-executed lower-priority reservations through IntentBook legal edges only, evented + receipted
- [x] **P0** Instance lifecycle gate: ARMED + inside validity window + subscribed-trigger match (mandate liveness/expiry enforced at the authorization step)
- [ ] **P1** Template-disable propagation at run start (I-68 enforced at registration onchain; runtime re-check pending)
- [ ] **P1** Mandate expiry horizon surfaced (instance becomes EXPIRED, no run attempts after)
- [ ] **P1** Structured logging with runId/instanceId correlation; metric counters for the §6 SENTINELS_SECURITY set
- [ ] **P2** Postgres store adapters matching the documented DDL (queue + run store)

## 4. Flagship template T1 — Safety Buffer

- [x] **P0** Template manifest (RISK_REDUCING_ONLY; REPAY + ADD_COLLATERAL only; trigger classes RISK_STATE/ONCHAIN_STATE/PASSPORT_STATE/TIME)
- [x] **P0** Config schema: target buffer, warning threshold, action threshold, max repay per run, daily cap, cooldown (explicit funding-source field deferred with the ADD_COLLATERAL path)
- [x] **P0** Deterministic plan compiler: shortfall → repay clamped by the per-run cap; NO_ACTION_REQUIRED when the buffer holds (agent-balance / mandate-remainder clamps deferred to live wiring)
- [ ] **P0** Compiler unit tests incl. boundary: exactly-at-threshold, cap-clamped, cooldown-suppressed, zero-debt — end-to-end covers the primary + no-action paths; dedicated boundary units pending
- [x] **P0** End-to-end runtime test: deteriorate a fixture account → trigger → snapshot → plan → authorize → execute (mock chain) → reconcile (through COMPLETE; ReceiptWriter pending)
- [x] **P0** Negative runtime tests: revoked mandate blocks, budget exhausted blocks, duplicate trigger single-effect (plus epoch-race and unknown-execution crash-resume)
- [ ] **P1** ADD_COLLATERAL action path with explicitly authorized funding source
- [ ] **P2** Oracle/risk recovery trigger (act when a gate clears)

## 5. Flagship template T2 — Event Guard

- [ ] **P1** Template manifest (MARKET_NEUTRAL; event window config: asset, exposure %, max cost, max notional, hedge instruments, venues, confirmation policy)
- [ ] **P1** Corporate-action/event trigger requiring VERIFIED_EXTERNAL authority for unattended action
- [ ] **P1** Weak-trigger path: AI-interpreted event → WAITING_USER_CONFIRMATION for risk-increasing legs
- [ ] **P1** Venue-unavailable honesty: X Layer has no DEX today → BLOCKED_BY_VENUE state, shown, not faked
- [ ] **P2** Market-session policy wiring (refuse / reduce size / widen slippage / confirm when CLOSED)

## 6. Flagship template T3 — Treasury Recycle

- [ ] **P1** Template manifest (idle threshold ∧ health floor ∧ no higher-priority obligation ∧ venue available)
- [ ] **P1** Supply-into-LiquidityVault action path (the one venue that exists), safety floor enforced in the validator
- [ ] **P1** Yield-never-consumes tests: buffer floor, outstanding reservations, withdrawal liabilities respected
- [ ] **P2** External supply-only venue path behind `ExternalYieldVenueAdapter` (see §8)

## 7. Template T4 — Basket Rebalancer (optional tier)

- [ ] **P2** Manifest + weight-deviation/suspension/scheduled triggers
- [ ] **P2** Rebalance plan compiler with simulation preview
- [ ] **P2** Personal Basket product surface wiring (admitted assets only)

## 8. External venues, verified honestly

- [ ] **P1** `ExternalYieldVenueAdapter` interface with supply lifecycle states (SUPPLY_QUOTED…SUPPLIED, WITHDRAW_*, UNKNOWN, RECONCILING) and **no recipient parameter** (I-71)
- [ ] **P1** Deterministic labelled test venue implementing it (fixture, duplicate/partial/unknown cases)
- [ ] **P1** Verify against current official sources whether an Aave V3 market exists on X Layer; record the finding in docs/INTEGRATIONS.md with date + transcript
- [ ] BLOCKED **Aave live wiring** — only if a current official X Layer market is verified (addresses, caps, pause state, withdrawal liquidity); otherwise adapter stays NOT_AVAILABLE
- [ ] **P1** Verify current xStocks X Layer token addresses from issuer primary data; never infer from symbols; record findings
- [ ] BLOCKED **xStocks admission** — issuer confirmation of X Layer deployment (existing blocker, unchanged)
- [ ] **P1** OKX venue identity enum (WALLET / DEX_INTERFACE / DEX_TRADE_API / TRADE_ZONE) with per-venue availability states; no attribution claims without current official grant rules
- [ ] **P2** `INTERFACE_EXECUTION_REQUIRED` handoff mode: prepare + reserve + hand off + reconcile, UI copy "user confirmation required on OKX DEX"
- [ ] BLOCKED **Trade Zone / Exchange OS adapter** — ACCESS_REQUIRED (existing blocker, unchanged)

## 9. Natural-language creation

`services/sentinel/src/nl.ts`, 10 tests. Model drafter over a structural `DraftModel` seam (ChainGPT
adapter provided), deterministic fallback that needs no key, draft→config mapping, and a
template-bounded permission preview. Injection corpus proves hostile text cannot smuggle a field or
widen the mandate.

- [x] **P0** `SentinelDraft` drafter over the ChainGPT client (general model), strict-schema parse, reject-don't-repair
- [x] **P0** Deterministic fallback drafter (keyword/rule-based) so the flow works without a model key
- [x] **P0** Draft → typed configuration mapping (`draftToSafetyBufferConfig`, the same editor state a template install uses)
- [x] **P0** Permission computation: draft → required actions/assets/venues/caps → mandate preview, intersected with the chosen template so it cannot widen past it
- [x] **P0** Injection tests: hostile goal text cannot produce out-of-schema fields (strict parse), cannot introduce a risk-increasing action via the deterministic path, and a model-proposed BORROW is stripped by the template bound
- [ ] **P1** Plan explanation surface (ChainGPT explains a compiled plan; explanation is presentation only)

## 10. Web — marketplace and instance surfaces

Public surfaces plus the authenticated write-flow, all typecheck-clean and passing a production
`next build`. The auth-gated pages use `AccountShell`; writes go through the app's shared
`sendTransaction`; the creation flow signs an EIP-712 mandate and registers an instance. `e2e/
sentinels.spec.ts` (18 tests) is written and discovered but not executed here — it needs a running
server, and the wallet harness refuses `eth_sendTransaction` by design (no test can assert a mined
write). The live autonomous run is now surfaced on the public `/proof` explorer. The `/developers`
publish write-UI remains.

- [x] **P0** `/sentinels` — template catalogue from the committed manifest; honest stats (no fake ROI)
- [x] **P0** `/sentinels/[templateId]` — publisher, version, risk class, required permissions/venues/trigger classes, fee model, audit status, compatibility (manifest hash, compiler + protocol version), receipt-derived stats shown as zero until real
- [x] **P0** `/app/sentinels` — instance list (`AccountShell`-gated), reads the owner's instances via `/api/sentinels`, status cards
- [x] **P0** `/app/sentinels/new` — permission preview (every action + the "cannot" list before the wallet opens) → configure agent/cap/duration
- [x] **P0** Mandate signing flow wired (EIP-712 `signMandate`) → `registerMandate` → `registerInstance` → ARMED, driven through `sendTransaction` + `TxTimeline`
- [x] **P0** `/app/sentinels/[instanceId]` — instance detail with **wired** pause/resume/revoke (the app's first real contract writes; guardian-pause asymmetry surfaced)
- [x] **P0** Auditable run timeline — delivered as the public run-proof timeline `/sentinels/runs/[runId]` rendering a real engine-produced run
- [x] **P1** `/developers/sentinels` + `/[templateId]` — publisher pages (publishing contract + committed-manifest view); the publish *write* UI (commitTemplate) remains, done via script today
- [x] **P0** No AI theatre: no pulsing orbs, no fake reasoning streams; real system state only
- [x] **P1** `/proof/[receiptId]` extended to Sentinel run receipts — the live autonomous run projects to a `SENTINEL_RUN_EXECUTED` receipt in the shared `/proof` loader, gets its own static page (`/proof/sentinel-run-executed-1952-b037f143ffe9b39f`), and renders a Sentinel-shaped explainer (observe → plan → authority → debt delta) instead of the Passport ladder; regression-tested in `apps/web/test/receipts.test.ts`
- [ ] **P1** Budget display + weak-trigger confirmation queue in `/app/sentinels`
- [ ] **P2** Alerts integration (weak-trigger confirmations, blocked instances, mandate expiry horizon)

## 11. Playwright (desktop + Pixel 7)

`e2e/sentinels.spec.ts` — 18 tests (9 × desktop + mobile), discovered by `playwright test --list`.
Written to match `mandates.spec.ts`: disclosure/boundary assertions and gating, driven up to the
wallet prompt via `wallet-harness` (which refuses `eth_sendTransaction`, so no mined-write assertion).

- [x] **P1** Marketplace renders; template detail shows permissions and fee model
- [x] **P1** Creation flow reaches the permission preview; boundary stated before the signing control
- [x] **P1** Gating: `/app/sentinels` redirects to onboarding without a session, renders when signed in; pause/resume/revoke controls present on the detail page
- [~] **P1** Run detail timeline renders from fixture run records (public timeline covered; per-instance run page pending)
- [ ] **P1** Safety Buffer scenario fixtures: weak-trigger confirmation, RiskEpoch invalidation, execution-unknown, mandate expiry (offline engine tests cover these; browser fixtures pending)
- [ ] **P2** Security-disabled template state; Event Guard blocked venue; Treasury Recycle no-valid-route; budget display
- [ ] **P2** Basket creation + rebalance preview; issuer readiness report; missing evidence states

## 12. Live X Layer proof

- [ ] **P0** `scripts/live-sentinel.mjs`: isolated account, distinct agent executor, bounded mandate signed, instance registered onchain, ARMED
- [ ] **P0** Induce a legitimate trigger condition; runtime observes **without user action**, pins snapshot, compiles, checks both authorities, executes REPAY, confirms, reconciles, writes receipt with pre/post debt + epoch + block
- [ ] **P0** Negative proof mined: agent attempts unauthorized outflow → reverted in a block; or revoked mandate → next run blocked; or budget exhausted → BLOCKED_BY_BUDGET
- [ ] **P0** `proof/live-sentinel.json` + receipt rendered at `/proof/[receiptId]`; `make check-proof-currency` green
- [ ] **P0** New claims in `proof/claims.json` at the proof level actually reached, no higher

## 13. Security campaign

- [ ] **P0** Adversarial suite: template-rug attempt, disabled-template run attempt, draft-injection corpus, budget race, duplicate trigger storm
- [ ] **P1** Mutation campaign from SENTINELS_SECURITY §4 — each mutation applied, suite fails, reverted, recorded
- [ ] **P1** Prompt-injection fixtures extended to Sentinel triggers (malicious article corpus)
- [ ] **P2** ChainGPT auditor run over new contracts (`make audit-contracts`), oversized-file caveat recorded
- [ ] **P2** Slither over new contracts, triaged

## 14. Documentation and ledger

- [ ] **P0** `docs/SENTINELS_ARCHITECTURE.md` (this build's spine)
- [ ] **P0** `docs/SENTINELS_SECURITY.md`
- [ ] **P0** This ledger merged into `docs/MASTER_COMPLETION_CHECKLIST.md` §AN
- [ ] **P1** `docs/SENTINELS_DEMO.md` — the honest demo sequence incl. the negative beat
- [ ] **P1** README, ARCHITECTURE, SECURITY, LIMITATIONS, DECISIONS updated (incl. a DECISIONS entry for the signer boundary crossing)
- [ ] **P1** RUNBOOKS extended with the 17 Sentinel scenarios
- [ ] **P1** AUDIT_HANDOFF updated with the new trust boundary
- [ ] **P1** spec/threat-model.md + spec/invariants.md extended by RFC-style addition (I-60…I-74)
- [ ] **P1** IMPLEMENTATION_STATUS reconciled (it predates the deployment; fix while touching)
- [ ] **P2** Issuer acceleration: `IssuanceReadinessReport` schema + generator over the evidence pipeline
- [ ] **P2** Basket accounting spec (NAV, executable redemption value, tracking error, cash buffer) — fixed-point, spec-first
- [ ] **P2** CompositePassport spec with recursion protection

## 15. Gates

- [ ] **P0** `make test` green including new suites
- [ ] **P0** `make test-differential` untouched and green
- [ ] **P0** `make lint` green
- [ ] **P0** Bytecode size guard green with new contracts
- [ ] **P1** `make test-e2e` green with new specs
- [ ] **P1** Artifact freshness + proof currency green with Sentinel artifacts
- [ ] **P2** Clean-room pass

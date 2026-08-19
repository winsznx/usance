# Master completion checklist

Generated from the repository at `252d7aa`, not from a wish list. A box is ticked only when the
thing is implemented **and** tested **and** reachable by a user where a user surface is required.
Code existing is not completion.

`BLOCKED` marks a genuine external dependency, named exactly. It is not a synonym for "hard".

Current: **16/34 canonical routes**,
39 proof claims (1 EXTERNAL_INTEGRATION, 4 INTEGRATION_TESTED, 18 LIVE_TESTNET, 7 NOT_YET_PROVEN, 9 UNIT_TESTED).

---

## A. Protocol contracts

- [x] Authority, roles, guardian/governance separation
- [x] AssetRegistry, capabilities, status
- [x] EvidenceRegistry, evidence-before-Passport ordering
- [x] PassportRegistry, versioned commitments, Merkle roots
- [x] RiskPolicyRegistry, exit curves, epoch, named epoch-bump capability
- [x] ClearingHouse, collateral, borrow, repay, withdraw
- [x] CollateralVault, payer/beneficiary authorization
- [x] LiquidityVault, shares, queue, bad-debt waterfall
- [x] FinancingEngine, index accrual, rate curve
- [x] FeeController, bounded economics, epoch semantics
- [x] LiquidationManager, routed, progressive
- [x] DirectSettlementRoute (labelled testnet route)
- [x] MandateRegistry, EIP-712, lifecycle
- [x] IntentBook, execution state machine
- [x] DelegationGateway, conjunctive authority
- [x] EmergencyController
- [x] EIP-170 size guard asserted in CI
- [ ] RemoteCollateralAdapter (LayerZero) — see L
- [ ] InsurancePool / backstop capital as a distinct contract

## B. Accounting

- [x] Fixed-point scales, rounding direction per quantity
- [x] Four-implementation differential conformance (Solidity/Rust/TS/Python)
- [x] 28 canonical scenarios, mixed decimals
- [x] Liquidation settlement conservation equation
- [x] repairPerDollar identity documented
- [x] usd18 never enters a token-denominated book
- [ ] Origination fee wired into borrow (FeeController exposes it; ClearingHouse ignores it)
- [ ] Interest split verified end-to-end against vault NAV in a property test

## C. Risk

- [x] Recognised value = min(haircutMark, stressedExit[, redemptionFloor])
- [x] Sequential haircut order frozen and tested
- [x] Account status ladder, recomputed on every read
- [x] Oracle freshness measured, fail-closed when unconfigured
- [x] Sequencer uptime gate
- [x] Epoch-stamped quotes
- [ ] Concentration limits per asset/issuer
- [ ] Correlation/portfolio-level haircut

## D. Liquidation

- [x] MARGIN_CALL eligibility, not NO_NEW_RISK
- [x] Partial deleveraging with close factor
- [x] Route ranked on expected recovery, not gross proceeds
- [x] Keeper incentive + protocol fee split, value conserved
- [x] Bad debt explicit
- [x] Live testnet proof, third-party keeper
- [ ] Multi-asset liquidation selection (single asset today)
- [ ] Keeper bot / automation reference implementation

## E. Liquidity providers

- [x] Supply, shares, NAV
- [x] Withdrawal queue, FIFO, partial funding
- [x] Bad-debt waterfall spends reserves first
- [x] `/earn`, `/earn/positions`
- [ ] `/earn/[vaultId]`
- [ ] LP deposit/withdraw wired to wallet (read-only today)
- [ ] Live LP deposit + queued withdrawal proof

## F. Evidence / Passport

- [x] Ingestion, canonicalisation, content/source hashing
- [x] Source-class hierarchy, low-trust rejection
- [x] Corroboration by independence group
- [x] CLAIM_CONFLICT as a type error, not a runtime check
- [x] Durable workflow, 29 states, reconciliation
- [x] Franklin 2024/2025/2026 semantic diff with honest coverage
- [x] Live Passport commit on X Layer
- [ ] Passport supersession / re-read triggered by a news-class source

## G. ChainGPT

- [x] Client, retry, queue, chunking
- [x] Quote verification against canonical text
- [x] Prompt-injection fixture, live model, no risk fields
- [x] Auditor with vulnerable positive control
- [ ] Semantic field-group extraction (IDENTITY / LEGAL_RIGHTS / BACKING_AND_CUSTODY /
      REDEMPTION / TRANSFER_AND_ELIGIBILITY / CORPORATE_ACTIONS)
- [ ] Provider-run cache keyed by content+group+schema+prompt+model
- [ ] Bounded live re-run reporting calls/claims/abstentions/conflicts

## H. Mandate authorization

- [x] EIP-712 domain, typehash, digest
- [x] Lifecycle ACTIVE/PAUSED/REVOKED/EXPIRED, no silent revival
- [x] Replay, nonce, wrong-agent, wrong-asset, wrong-venue refusals
- [x] AllowedAction = ProtocolAllows AND MandateAllows
- [x] Agent cannot withdraw collateral, enforced twice
- [x] Live delegated repay, distinct owner/agent
- [x] Live unauthorized outflow mined and reverted
- [x] `/app/mandates`, `/app/mandates/new`
- [ ] `/app/mandates/[mandateId]` — needs M
- [ ] Signing wired to the deployed registry from the browser
- [ ] Live revocation proof
- [ ] Pause/resume from the UI

## I. Intent engine

- [x] IntentBook state machine, deployed
- [x] Reservation wired to ClearingHouse capacity
- [x] Partial fills consume proportionally
- [x] EXECUTION_UNKNOWN releases nothing
- [ ] `/app/intent/new`
- [ ] `/app/intents/[intentId]`
- [ ] Plan compiler (goal -> strict schema -> deterministic risk check)
- [ ] Reservation surfaced in account/activity/proof
- [ ] Live intent reservation proof

## J. Venue adapters

- [x] ILiquidationRoute (quote/execute) with expected-recovery decomposition
- [ ] IExecutionVenue (quote/reserve/submit/query/cancel/reconcile)
- [ ] Deterministic labelled test venue
- [ ] Venue-unavailable product state

## K. OKX integrations

- [x] OKX Wallet connect, network add/switch
- [x] ERC-8021 builder-code attribution on every submitted transaction
- [ ] OKX DEX quote/route/slippage/submission — BLOCKED: no DEX deployment on X Layer testnet
- [ ] Exchange OS adapter — BLOCKED: ACCESS_REQUIRED, no credentials

## L. LayerZero / cross-chain

- [ ] RemoteCollateralAdapter, lock-on-source, non-transferable credit on X Layer
- [ ] Lifecycle REMOTE_DEPOSIT_INITIATED..CREDIT_ACTIVE and the exit path
- [ ] Duplicate/out-of-order/replay/reorg tests
- [ ] BLOCKED for live proof: needs a funded source-chain endpoint and DVN config

## M. Indexer

- [ ] Event ingestion for all 16 deployed contracts
- [ ] Projections: accounts, assets, vaults, mandates, intents, liquidations, receipts
- [ ] Cursor/checkpoint persistence
- [ ] Idempotent replay, duplicate-event handling
- [ ] Restart recovery
- [ ] Reorg handling appropriate to X Layer finality
- [ ] Backfill from deployment block
- [ ] Startup refuses a retired deployment (chainId + manifest digest + bytecode)
- [ ] `make test-indexer`

## N. Backend / API

- [x] `/api/earn/position`
- [ ] assets, passports, evidence, accounts, risk, vaults, mandates, intents, activity, proof, status
- [ ] Auth scoping: read without a wallet, writes scoped
- [ ] No SSRF-capable evidence fetch endpoint
- [ ] `/api/health`, `/api/ready` with real dependency checks

## O. Frontend public

- [x] `/`, `/assets`, `/assets/[assetId]`, `/status`, `/proof/[receiptId]`, `/simulate`
- [ ] `/developers` landing

## P. Frontend capital user

- [x] `/app`
- [ ] `/app/onboarding`
- [ ] `/app/assets/[assetId]`
- [x] `/app/collateral/add`
- [x] `/app/borrow`
- [x] `/app/repay`
- [x] `/app/withdraw`
- [ ] `/app/intent/new`
- [ ] `/app/intents/[intentId]`
- [ ] `/app/positions`
- [x] `/app/mandates`
- [x] `/app/mandates/new`
- [ ] `/app/mandates/[mandateId]`
- [x] `/app/activity`
- [ ] `/app/activity/[receiptId]`
- [ ] `/app/alerts`
- [ ] `/app/settings`
- [ ] `/app/settings/security`

## Q. LP product

- [x] `/earn`
- [ ] `/earn/[vaultId]`
- [x] `/earn/positions`

## R. Issuer product

- [ ] `/institutional/assets`
- [ ] `/institutional/assets/new`
- [ ] `/institutional/assets/[applicationId]`

- [ ] Application lifecycle with visible statuses

## S. Developer product

- [ ] `/developers`
- [ ] `/developers/keys`
- [ ] `/developers/webhooks`
- [ ] `/developers/activity`

- [ ] Scoped API keys, secret shown once, rotate, revoke
- [ ] Webhooks: create, test, delivery history, retry, signatures, disable
- [ ] Idempotent delivery

## T. Wallet / session

- [x] Connect, wrong network, add/switch chain, session signature, read-only fallback
- [x] Account/chain change invalidates the session
- [ ] Session expiry surfaced
- [ ] Wallet locked / reconnect / disconnect states
- [ ] Insufficient gas state

## U. Receipts / proof

- [x] Canonical receipt model, CONFIRMED schema-refused without a tx
- [x] Public `/proof/[receiptId]`, no wallet
- [x] Superseded records archived, never rewritten
- [x] Artifact provenance and freshness gate
- [ ] `/app/activity/[receiptId]`
- [ ] Mandate and intent receipts in the same family

## V. Observability

- [ ] Structured logs with request/workflow ids
- [ ] Metrics: latency, error rate, RPC failures, indexer lag, stuck workflows,
      confirmation-unknown count, provider failures, webhook delivery failure
- [ ] `/api/health`, `/api/ready`

## W. Operational tooling

- [x] Deploy, manifest generation, drift detection
- [x] Live scenario, liquidation, delegated-authority scripts
- [x] Feed characterisation
- [ ] Runbooks (RPC degraded, indexer stalled, ChainGPT unavailable, workflow stuck,
      confirmation-unknown accumulation, deployment drift, oracle stale/unconfigured,
      vault stressed, withdrawal backlog, bad debt, keeper inactivity, webhook backlog, reorg)

## X. Security

- [x] Slither, triaged baseline, fails on new findings
- [x] ChainGPT auditor strict, vulnerable positive control
- [x] 48+ mutations verified across accounting, authority, vault, liquidation
- [x] Fuzz and invariant runs
- [ ] Dependency audit in CI
- [ ] Manual review pass over indexer/webhook/SSRF once those exist

## Y. Tests

- [x] 231 Forge, 272 TypeScript, 102 Rust, 126 Playwright
- [x] Differential conformance
- [x] Clean-room reproduction
- [ ] Indexer tests
- [ ] Webhook delivery tests
- [ ] Cross-chain tests

## Z. Accessibility

- [x] Mobile viewport checks, no hover-only critical info
- [ ] Keyboard navigation audit across all routes
- [ ] Focus visibility and dialog focus management
- [ ] Form label/error association
- [ ] Contrast audit
- [ ] Automated a11y checks in Playwright

## AA. Responsive

- [x] Pixel-class viewport on public, earn, mandate routes
- [ ] Every remaining route
- [ ] Responsive table behaviour

## AB. Design system

- [x] Primitives: Notice, Steps, Stat, RiskBadge, AmountField, PreviewRow, TxTimeline
- [ ] Tables, dialogs, drawers, toasts, tabs, breadcrumbs, pagination
- [ ] Consolidated empty/skeleton/error states

## AC. Icons

- [ ] Single coherent icon system
- [ ] No emoji or Unicode arrows as interface icons
- [ ] aria-hidden on decorative, labels on meaningful

## AD. Performance

- [ ] Bundle audit
- [ ] Server/client boundary audit
- [ ] RPC fanout and duplicate query audit

## AE. Deployment

- [x] Deterministic deploy, role handover, ADMISSION surrendered
- [x] Mainnet guards (fixtures, freshness, treasury)
- [x] Bytecode drift gate
- [x] Manifest digest in artifacts

## AF. Explorer verification

- [ ] Standard-JSON verification for the current deployment
- [ ] `verified: true` only after explorer read-back
- [ ] `make verify-explorer`

## AG. Clean room

- [x] Fresh-clone bootstrap and deterministic gates
- [x] No developer paths, keys, truncated hashes

## AH. Documentation

- [x] README, ARCHITECTURE, SECURITY, SETUP, LIMITATIONS, DECISIONS
- [x] IMPLEMENTATION_STATUS, INTEGRATIONS
- [ ] CONTRIBUTIONS.md
- [ ] Docs reconciled against the post-DelegationGateway architecture

## AI. Judge demo

- [ ] `docs/demo-script.md`, 2-3 minutes, no terminal rescue

## AJ. Submission

- [ ] Every submission claim maps to `proof/claims.json`

## AK. Audit handoff

- [ ] `docs/AUDIT_HANDOFF.md`

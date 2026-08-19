# Master completion checklist

Generated from the repository at `252d7aa`, not from a wish list. A box is ticked only when the
thing is implemented **and** tested **and** reachable by a user where a user surface is required.
Code existing is not completion.

`BLOCKED` marks a genuine external dependency, named exactly. It is not a synonym for "hard".

> **Total** 234 · **Complete** 143 · **P0 open** 3 · **P1 open** 39 · **P2 open** 46 · **Externally blocked** 3
>
> P0 blocks a fresh user or operator from completing a core lifecycle. P1 is required for product,
> security or operational completeness. P2 is polish. BLOCKED names a real external dependency and
> is never used for work that is merely hard.

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
- [ ] **P1** RemoteCollateralAdapter (LayerZero) — see L
- [ ] **P2** InsurancePool / backstop capital as a distinct contract

## B. Accounting

- [x] Fixed-point scales, rounding direction per quantity
- [x] Four-implementation differential conformance (Solidity/Rust/TS/Python)
- [x] 28 canonical scenarios, mixed decimals
- [x] Liquidation settlement conservation equation
- [x] repairPerDollar identity documented
- [x] usd18 never enters a token-denominated book
- [ ] **P1** Origination fee wired into borrow (FeeController exposes it; ClearingHouse ignores it)
- [ ] **P2** Interest split verified end-to-end against vault NAV in a property test

## C. Risk

- [x] Recognised value = min(haircutMark, stressedExit[, redemptionFloor])
- [x] Sequential haircut order frozen and tested
- [x] Account status ladder, recomputed on every read
- [x] Oracle freshness measured, fail-closed when unconfigured
- [x] Sequencer uptime gate
- [x] Epoch-stamped quotes
- [ ] **P2** Concentration limits per asset/issuer
- [ ] **P2** Correlation/portfolio-level haircut

## D. Liquidation

- [x] MARGIN_CALL eligibility, not NO_NEW_RISK
- [x] Partial deleveraging with close factor
- [x] Route ranked on expected recovery, not gross proceeds
- [x] Keeper incentive + protocol fee split, value conserved
- [x] Bad debt explicit
- [x] Live testnet proof, third-party keeper
- [ ] **P2** Multi-asset liquidation selection (single asset today)
- [ ] **P2** Keeper bot / automation reference implementation

## E. Liquidity providers

- [x] Supply, shares, NAV
- [x] Withdrawal queue, FIFO, partial funding
- [x] Bad-debt waterfall spends reserves first
- [x] `/earn`, `/earn/positions`
- [ ] **P1** `/earn/[vaultId]`
- [ ] **P0** LP deposit/withdraw wired to wallet (read-only today)
- [ ] **P2** Live LP deposit + queued withdrawal proof

## F. Evidence / Passport

- [x] Ingestion, canonicalisation, content/source hashing
- [x] Source-class hierarchy, low-trust rejection
- [x] Corroboration by independence group
- [x] CLAIM_CONFLICT as a type error, not a runtime check
- [x] Durable workflow, 29 states, reconciliation
- [x] Franklin 2024/2025/2026 semantic diff with honest coverage
- [x] Live Passport commit on X Layer
- [ ] **P2** Passport supersession / re-read triggered by a news-class source

## G. ChainGPT

- [x] Client, retry, queue, chunking
- [x] Quote verification against canonical text
- [x] Prompt-injection fixture, live model, no risk fields
- [x] Auditor with vulnerable positive control
- [ ] **P1** Semantic field-group extraction (IDENTITY / LEGAL_RIGHTS / BACKING_AND_CUSTODY /
      REDEMPTION / TRANSFER_AND_ELIGIBILITY / CORPORATE_ACTIONS)
- [ ] **P1** Provider-run cache keyed by content+group+schema+prompt+model
- [ ] **P2** Bounded live re-run reporting calls/claims/abstentions/conflicts

## H. Mandate authorization

- [x] EIP-712 domain, typehash, digest
- [x] Lifecycle ACTIVE/PAUSED/REVOKED/EXPIRED, no silent revival
- [x] Replay, nonce, wrong-agent, wrong-asset, wrong-venue refusals
- [x] AllowedAction = ProtocolAllows AND MandateAllows
- [x] Agent cannot withdraw collateral, enforced twice
- [x] Live delegated repay, distinct owner/agent
- [x] Live unauthorized outflow mined and reverted
- [x] `/app/mandates`, `/app/mandates/new`
- [x] `/app/mandates/[mandateId]`
- [~] Signing wired to the deployed registry from the browser — typed-data signer, draft builder and write ABI done and pinned to the contract typehash; submit flow not wired
- [x] Live revocation proof
- [ ] **P0** Pause/resume from the UI

## I. Intent engine

- [x] IntentBook state machine, deployed
- [x] Reservation wired to ClearingHouse capacity
- [x] Partial fills consume proportionally
- [x] EXECUTION_UNKNOWN releases nothing
- [ ] **P1** `/app/intent/new`
- [ ] **P1** `/app/intents/[intentId]`
- [ ] **P1** Plan compiler (goal -> strict schema -> deterministic risk check)
- [ ] **P1** Reservation surfaced in account/activity/proof
- [ ] **P2** Live intent reservation proof

## J. Venue adapters

- [x] ILiquidationRoute (quote/execute) with expected-recovery decomposition
- [ ] **P1** IExecutionVenue (quote/reserve/submit/query/cancel/reconcile)
- [ ] **P1** Deterministic labelled test venue
- [ ] **P1** Venue-unavailable product state

## K. OKX integrations

- [x] OKX Wallet connect, network add/switch
- [x] ERC-8021 builder-code attribution on every submitted transaction
- [ ] OKX DEX quote/route/slippage/submission — BLOCKED: no DEX deployment on X Layer testnet
- [ ] Exchange OS adapter — BLOCKED: ACCESS_REQUIRED, no credentials

## L. LayerZero / cross-chain

- [ ] **P1** RemoteCollateralAdapter, lock-on-source, non-transferable credit on X Layer
- [ ] **P1** Lifecycle REMOTE_DEPOSIT_INITIATED..CREDIT_ACTIVE and the exit path
- [ ] **P2** Duplicate/out-of-order/replay/reorg tests
- [ ] BLOCKED for live proof: needs a funded source-chain endpoint and DVN config

## M. Indexer

- [ ] **P2** Event ingestion for all 16 deployed contracts
- [ ] **P2** Projections: mandates and account activity done; assets, vaults, intents, liquidations open
- [x] Cursor/checkpoint persistence
- [x] Idempotent replay, duplicate-event handling
- [x] Restart recovery
- [x] Reorg handling appropriate to X Layer finality
- [ ] **P2** Backfill from deployment block
- [x] Startup refuses a retired deployment (chainId + manifest digest + bytecode)
- [x] `make test-indexer`

## N. Backend / API

- [x] `/api/earn/position`
- [ ] **P1** assets, passports, evidence, accounts, risk, vaults, mandates, intents, activity, proof, status
- [ ] **P2** Auth scoping: read without a wallet, writes scoped
- [ ] **P2** No SSRF-capable evidence fetch endpoint
- [x] `/api/health`, `/api/ready` with real dependency checks

## O. Frontend public

- [x] `/`, `/assets`, `/assets/[assetId]`, `/status`, `/proof/[receiptId]`, `/simulate`
- [ ] **P1** `/developers` landing

## P. Frontend capital user

- [x] `/app`
- [x] `/app/onboarding`
- [ ] **P0** `/app/assets/[assetId]`
- [x] `/app/collateral/add`
- [x] `/app/borrow`
- [x] `/app/repay`
- [x] `/app/withdraw`
- [ ] **P1** `/app/intent/new`
- [ ] **P1** `/app/intents/[intentId]`
- [x] `/app/positions`
- [x] `/app/mandates`
- [x] `/app/mandates/new`
- [x] `/app/mandates/[mandateId]`
- [x] `/app/activity`
- [x] `/app/activity/[receiptId]`
- [x] `/app/alerts`
- [x] `/app/settings`
- [x] `/app/settings/security`

## Q. LP product

- [x] `/earn`
- [ ] **P1** `/earn/[vaultId]`
- [x] `/earn/positions`

## R. Issuer product

- [ ] **P1** `/institutional/assets`
- [ ] **P1** `/institutional/assets/new`
- [ ] **P1** `/institutional/assets/[applicationId]`

- [ ] **P2** Application lifecycle with visible statuses

## S. Developer product

- [ ] **P1** `/developers`
- [ ] **P1** `/developers/keys`
- [ ] **P1** `/developers/webhooks`
- [ ] **P1** `/developers/activity`

- [ ] **P1** Scoped API keys, secret shown once, rotate, revoke
- [ ] **P1** Webhooks: create, test, delivery history, retry, signatures, disable
- [ ] **P1** Idempotent delivery

## T. Wallet / session

- [x] Connect, wrong network, add/switch chain, session signature, read-only fallback
- [x] Account/chain change invalidates the session
- [ ] **P2** Session expiry surfaced
- [ ] **P2** Wallet locked / reconnect / disconnect states
- [ ] **P2** Insufficient gas state

## U. Receipts / proof

- [x] Canonical receipt model, CONFIRMED schema-refused without a tx
- [x] Public `/proof/[receiptId]`, no wallet
- [x] Superseded records archived, never rewritten
- [x] Artifact provenance and freshness gate
- [x] `/app/activity/[receiptId]`
- [ ] **P2** Mandate and intent receipts in the same family

## V. Observability

- [ ] **P1** Structured logs with request/workflow ids
- [ ] **P1** Metrics: latency, error rate, RPC failures, indexer lag, stuck workflows,
      confirmation-unknown count, provider failures, webhook delivery failure
- [ ] **P2** `/api/health`, `/api/ready`

## W. Operational tooling

- [x] Deploy, manifest generation, drift detection
- [x] Live scenario, liquidation, delegated-authority scripts
- [x] Feed characterisation
- [x] Runbooks — docs/RUNBOOKS.md (10 scenarios; webhook backlog pending S)

## X. Security

- [x] Slither, triaged baseline, fails on new findings
- [x] ChainGPT auditor strict, vulnerable positive control
- [x] 48+ mutations verified across accounting, authority, vault, liquidation
- [x] Fuzz and invariant runs
- [ ] **P2** Dependency audit in CI
- [ ] **P2** Manual review pass over indexer/webhook/SSRF once those exist

## Y. Tests

- [x] 231 Forge, 272 TypeScript, 102 Rust, 126 Playwright
- [x] Differential conformance
- [x] Clean-room reproduction
- [ ] **P2** Indexer tests
- [ ] **P2** Webhook delivery tests
- [ ] **P2** Cross-chain tests

## Z. Accessibility

- [x] Mobile viewport checks, no hover-only critical info
- [ ] **P2** Keyboard navigation audit across all routes
- [ ] **P2** Focus visibility and dialog focus management
- [ ] **P2** Form label/error association
- [ ] **P2** Contrast audit
- [ ] **P2** Automated a11y checks in Playwright

## AA. Responsive

- [x] Pixel-class viewport on public, earn, mandate routes
- [ ] **P2** Every remaining route
- [ ] **P2** Responsive table behaviour

## AB. Design system

- [x] Primitives: Notice, Steps, Stat, RiskBadge, AmountField, PreviewRow, TxTimeline
- [x] Drawer, tab bar, collapsible rail, icon set — tables, dialogs, toasts still open
- [ ] **P2** Consolidated empty/skeleton/error states

## AC. Icons

- [x] Single coherent icon system
- [x] No emoji or Unicode arrows as interface icons
- [x] aria-hidden on decorative, labels on meaningful

## AD. Performance

- [ ] **P2** Bundle audit
- [ ] **P2** Server/client boundary audit
- [ ] **P2** RPC fanout and duplicate query audit

## AE. Deployment

- [x] Deterministic deploy, role handover, ADMISSION surrendered
- [x] Mainnet guards (fixtures, freshness, treasury)
- [x] Bytecode drift gate
- [x] Manifest digest in artifacts

## AF. Explorer verification

- [ ] **P1** Standard-JSON verification for the current deployment
- [ ] **P1** `verified: true` only after explorer read-back
- [ ] **P2** `make verify-explorer`

## AG. Clean room

- [x] Fresh-clone bootstrap and deterministic gates
- [x] No developer paths, keys, truncated hashes

## AH. Documentation

- [x] README, ARCHITECTURE, SECURITY, SETUP, LIMITATIONS, DECISIONS
- [x] IMPLEMENTATION_STATUS, INTEGRATIONS
- [ ] **P2** CONTRIBUTIONS.md
- [ ] **P2** Docs reconciled against the post-DelegationGateway architecture

## AI. Judge demo

- [ ] **P2** `docs/demo-script.md`, 2-3 minutes, no terminal rescue

## AJ. Submission

- [ ] **P2** Every submission claim maps to `proof/claims.json`

## AK. Audit handoff

- [x] `docs/AUDIT_HANDOFF.md`

## AM. Design kit and onboarding

- [x] `usance-design-assets-v3` installed at `public/assets/` — kit icons, illustrations, brand
- [x] Capacity Cut lockup and mark used, never redrawn (`BRAND_LOCK.md` copied to `docs/`)
- [x] Split-screen onboarding: connect on the right, a four-point brief on the left
- [x] One screen owns the connect question; account routes redirect to it
- [x] Transaction history on the overview, from real receipts, empty state when there are none
- [ ] **P1** Deterministic test-wallet provider for E2E. The app frame is now behind
      authentication, so 30 shell assertions (rail, drawer, tab bar, mode toggle, degraded banner,
      keyboard nav) are skipped with a stated reason rather than mocked. Mocking a wallet to claim
      the rail works would assert against a harness, not the app.
- [ ] **P1** The security explainer (session vs allowance vs mandate) is now behind the wallet
      gate. It is reference material that was useful *before* connecting and should move to a
      public route or into the onboarding brief.
- [ ] **P1** Landing page rebuild against the kit: hero watercolor with grain, six feature
      illustrations, kit favicon and OG, footer columns
- [ ] **P2** Replace remaining inline nav glyphs with the kit's `assets/icons/` set throughout

## AL. Terminal-grade dashboard (from the second review)

- [x] Persistent collapsible rail, drawer and bottom tabs from one component
- [x] Contextual action row, disabled with a stated reason rather than hidden
- [x] Capacity derivation with the binding constraint named
- [x] Status ladder showing what the next rung costs
- [x] Safety buffer against real thresholds, with the borrow limit marked inside it
- [x] Simple / Advanced, sticky, asserted never to hide risk
- [x] Copy-to-clipboard on ids and hashes, with a keyboard-reachable fallback
- [x] Degraded banner driven by /api/ready, forced in a test
- [x] Unread alert count on the rail and the tab bar
- [x] Keyboard navigation, `g` then a letter, ignored while typing
- [x] Skeletons matching the final layout rather than a spinner
- [ ] **P1** Toast system, non-blocking and stackable
- [ ] **P1** Global search
- [ ] **P1** Dark theme
- [ ] **P2** Virtualised activity list
- [ ] **P2** Pin / hide on metric cards

### Rejected, with reasons rather than silence

- **Dual-line "usable collateral vs capacity, last 7/30 days".** No time series exists. Drawing one
  means inventing the past, which is the one thing a risk interface must never do. The derivation
  replaces it and is more specific to Usance than any chart would be.
- **Sparklines and "% change vs previous risk epoch" on metric cards.** Same reason. Nothing records
  a per-epoch history of these figures.
- **Safety buffer over time.** Same reason.
- **Three-dot overflow on every card.** The reference's own slop. Pin and hide are real features and
  are listed above as P2; a menu that only contains "view detail" is a second way to click the card.
- **Real-time WebSocket with optimistic UI.** There is no service to push from. Optimistic financial
  state that later reconciles away is worse than a value that arrives a second later.
- **Live PnL on positions.** Usance has collateral and debt, not trading positions with a cost basis.
- **"Good morning, [Name]".** Usance knows an address, not a name, and a greeting is not information.

# CURRENT_STATE_AUDIT.md

**Date:** 2026-09-03  
**Decision status:** Product Lock input, not implementation authorization.

## 1. Audit scope and confidence

The current source set contains a repository-generated `MASTER_COMPLETION_CHECKLIST.md` at commit `252d7aa`, the canonical/older PRDs, the current AI boundary, 0G plan, Sentinel architecture/security/task ledgers, deployment/proof history from prior sessions, and the new cross-domain strategy material.

**Important limitation:** the raw Usance git worktree itself is not mounted in this chat and the connected GitHub search did not expose a Usance repository. Therefore this audit can reconstruct the **documented repository state**, but it cannot independently re-run the code or prove the current HEAD. Before implementation, the first agent action is a fresh repo census and diff against this audit.

The repository-generated checklist remains stronger than chat recollection because it states that a task is complete only when implemented, tested, and user-reachable where relevant. However, later Sentinel documents already supersede some counts in that checklist. This is treated as a conflict, not silently merged.

## 2. Current build: what is materially real

### Core financial protocol — BUILT / tested

Documented as implemented:

- role/authority separation and restrict-only guardian behavior;
- `AssetRegistry`;
- `EvidenceRegistry`;
- `PassportRegistry`;
- `RiskPolicyRegistry`;
- `CollateralVault`;
- `ClearingHouse`;
- `LiquidityVault`;
- `FinancingEngine`;
- `FeeController`;
- `LiquidationManager`;
- `MandateRegistry`;
- `IntentBook`;
- `DelegationGateway`;
- `EmergencyController`;
- deterministic deployment, role handover and EIP-170 size guard.

The financial core already supports the fundamental lifecycle:

`admit → recognize → deposit → borrow → refuse excess → repay → withdraw`

The documented accounting system has four independent implementations — Solidity, Rust, TypeScript and Python — over 28 canonical scenarios.

### Risk — BUILT / tested

Implemented:

- recognized value from conservative haircut-mark / stressed-exit / eligible-redemption logic;
- deterministic sequential haircut order;
- account state ladder;
- measured oracle freshness with fail-closed behavior when unconfigured;
- sequencer uptime gate;
- epoch-stamped quotes;
- progressive liquidation based on expected recovery;
- live testnet liquidation proof in the current claim ledger.

Still missing for the new Base thesis:

- issuer/asset concentration limits;
- portfolio/correlation haircuts;
- multi-asset liquidation selection.

These were previously P2. They are **promoted to pre-mainnet requirements** because portfolio-backed stock credit makes them load-bearing.

### Evidence and Asset Passport — BUILT / materially proven

Implemented:

- ingestion, canonicalization and content/source hashing;
- source-class hierarchy;
- independent corroboration groups;
- structural `CLAIM_CONFLICT`;
- durable evidence workflow;
- Franklin multi-year semantic comparison;
- live Passport commit documented on X Layer.

The AI security boundary is unusually strong: the extraction surface has no reachable function for LTV, haircut, collateral movement, RiskEpoch mutation or Passport commit.

### Delegated authority — BUILT / live-tested

Implemented:

- EIP-712 mandates;
- lifecycle and replay controls;
- `ProtocolAllows ∧ MandateAllows`;
- no agent withdrawal path;
- live delegated repay;
- live mined unauthorized outflow refusal;
- live revocation proof.

Remaining P0 in the repo-generated checklist:

- browser pause/resume flow.

### Liquidity and lender side — contract built, product incomplete

Implemented:

- vault shares/NAV;
- withdrawal queue;
- FIFO/partial funding;
- reserve-first bad-debt waterfall;
- read surfaces `/earn` and `/earn/positions`.

Current P0:

- LP deposit/withdraw is not wired to a real wallet journey.

A real-capital launch cannot call itself economically ready until an actual lender can supply and exit under the same proof discipline as a borrower.

### Intent and external execution — partial

Implemented:

- `IntentBook`;
- reservation state;
- proportional partial-fill consumption;
- `EXECUTION_UNKNOWN` releases nothing.

Missing:

- user intent routes;
- strict plan compiler;
- general `IExecutionVenue`;
- test venue;
- real production venue adapters.

OKX DEX and Exchange OS remain separate surfaces. Exchange OS staged access must stay `ACCESS_REQUIRED` until granted.

### Indexer/API/operations — foundation built, incomplete

Built:

- durable cursor;
- duplicate/replay protection;
- restart recovery;
- reorg handling;
- retired-deployment startup guard;
- `/api/health`;
- `/api/ready`.

Incomplete:

- all-contract event ingestion;
- broad projections;
- public API families;
- structured logs and production metrics;
- complete webhook/developer product.

### UI — serious but incomplete

Current documented route coverage: 16/34 canonical routes at the checklist snapshot.

Built surfaces include public asset Passport/proof/status views and most capital-user actions.

Still load-bearing:

- `/app/assets/[assetId]`;
- intent routes;
- issuer/institutional routes;
- developer routes;
- `/earn/[vaultId]`;
- real LP writes.

### Sentinels — strong local architecture, incomplete deployment/product

Current Sentinel architecture is not a sketch. It contains:

- strict schemas;
- immutable template versions;
- instance pins;
- additive registries that hold no money roles;
- runtime run-state machine;
- trigger dedup;
- snapshots;
- deterministic plan compilation/validation;
- budgets;
- authorization preview;
- execution/reconciliation;
- receipt writer;
- supervisor;
- Safety Buffer template;
- weak-trigger asymmetry;
- natural-language draft-to-typed-config path;
- public marketplace/run proof pages.

Not complete:

- current repo documents disagree on whether the new Sentinel registries are deployed;
- no authoritative fresh live autonomous Sentinel proof is available in the source set;
- authenticated Sentinel instance creation/arming is incomplete;
- Event Guard/Treasury Recycle are incomplete;
- external venue verification, Sentinel Playwright, mutation campaign and runbooks remain.

Treat the autonomy plane as **built locally/tested, deployment status unresolved until repo/manifest re-read**.

## 3. Current documented proof level

The repo-generated checklist records:

- 39 proof claims;
- 18 `LIVE_TESTNET`;
- 4 `INTEGRATION_TESTED`;
- 9 `UNIT_TESTED`;
- 1 `EXTERNAL_INTEGRATION`;
- 7 `NOT_YET_PROVEN`.

These counts are **not carried into future marketing automatically**. Before any new public claim:

1. load the current `proof/claims.json`;
2. verify every `LIVE_TESTNET` tx against the current deployment manifest;
3. run bytecode-drift checks;
4. archive superseded proofs rather than rewriting them;
5. regenerate the counts.

## 4. Current deployment truth

Usance has a documented X Layer testnet history with live Passport, RiskEpoch, borrowing/delegation and liquidation evidence. Multiple coherent redeployments occurred as bytecode changed.

Because exact current addresses are not present in the current source package and prior deployments have been intentionally retired, **this Product Lock does not repeat an address from chat history**.

The only acceptable source for current addresses is the current generated deployment manifest.

## 5. Mainnet-readiness assessment

Usance is **not yet mainnet-ready**.

It is best described as:

> **Core protocol substantially built; now moving through integration, economic and institutional mainnet-readiness gates.**

### Technical mainnet-ready

Requires:

- current code/tests clean;
- current deployment fully verified;
- no stale proof;
- explorer verification;
- complete borrower + LP write journeys;
- production observability;
- production key/governance setup;
- exact asset/oracle/venue adapters;
- external review/audit.

### Economic mainnet-ready

Requires:

- real settlement liquidity;
- conservative caps;
- verified liquidation depth;
- real oracle/session behavior;
- realistic withdrawal capacity;
- backstop/insurance policy;
- rate/fee economics;
- portfolio concentration risk.

### Institutional mainnet-ready

Requires:

- asset-specific legal/economic review;
- custody/redemption evidence;
- issuer/corporate-action procedures;
- production signers/quorums;
- incident response;
- monitoring;
- external audit;
- compliance/eligibility treatment;
- counterparty/LP operating agreements where applicable.

## 6. Implementation status classification

| Area | Status |
|---|---|
| Core risk/accounting | BUILT + tested |
| X Layer testnet core | DEPLOYED historically; current manifest must be re-read |
| Evidence/Passport | BUILT + live testnet proof documented |
| ChainGPT extraction | BUILT, with P1 field-group/cache work |
| 0G | PROPOSED only |
| Sentinels core/runtime | BUILT locally/tested |
| Sentinels live autonomous proof | UNRESOLVED / not safe to claim |
| Base | STRATEGY / not implemented |
| B20 adapter | NOT BUILT |
| X Layer xStocks production adapter | NOT BUILT |
| Hedera ATS adapter | NOT BUILT |
| Institutional Facility / Collateral Switch | NOT BUILT |
| ENSv2 | RESEARCH / not integrated |
| Privy institutional control | RESEARCH / not integrated |
| Chainlink CRE confidential facility policy | RESEARCH / exact ETHOnline rules pending |
| Circle CCTP | architecture seam exists; current Base/X Layer production support must be implemented |
| Remote collateral | specified, not built |
| Full developer/issuer product | incomplete |
| Production audit | not complete |

## 7. Current P0s before adding new scope

From the repo-generated checklist:

- LP wallet deposit/withdraw;
- mandate pause/resume;
- `/app/assets/[assetId]`;
- Sentinel live proof / authenticated arming depending on the latest repo state.

For the new Product Lock, promote these additional items to pre-mainnet P0/P1:

- rebase/corporate-action-safe xStocks accounting;
- B20 corporate-action-aware accounting;
- exact instrument identity migration;
- issuer/asset concentration;
- portfolio risk;
- production oracle/session mapping;
- current explorer verification;
- full metrics/logging;
- first external security review;
- liquidity + liquidation canary proof.

## 8. What is obsolete

The following statements in older Usance material are no longer company-level truth:

- “X Layer is the canonical home/settlement chain of Usance.”
- “Usance remains an X Layer protocol.”
- “Circle CCTP is not available on X Layer.”
- any global claim that Usance uses either Chainlink Data Feeds or Data Streams everywhere;
- any model where `AAPL` or `NVDA` alone identifies a tokenized instrument;
- any architecture that puts mutable facility debt/collateral state across two chains;
- any narrative that defines Usance by a hackathon sponsor stack;
- any claim that generic stock-backed borrowing itself is novel.

## 9. What survives unchanged

These are constitutional:

1. AI interprets; deterministic systems control money.
2. Weak evidence cannot increase financial privilege.
3. Every important action produces a receipt/proof trail.
4. Unknown settlement is not failure and is not success; it reconciles.
5. Protocol policy and user mandate are conjunctive.
6. Emergency authority may restrict; lifting risk requires governance.
7. Asset identity preserves issuer/legal/economic differences.
8. Market price is not automatically collateral value.
9. Financial state has one authoritative owner.
10. Current evidence/claim artifacts must be fresh, generated and reproducible.

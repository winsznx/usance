# USANCE PRODUCT LOCK — COMBINED REVIEW

---

<!-- CONFLICTS_AND_LOCK_REPORT.md -->

# CONFLICTS_AND_LOCK_REPORT.md

## Major conflicts found

### 1. X Layer canonical state vs multi-domain company

**Old:** X Layer is canonical clearing/settlement for Usance.

**New evidence/strategy:** Base Batches requires Base-first/default network; Base has native programmable equities; X Layer has a distinct xStocks market.

**Resolution:** no company-wide canonical chain. Each facility has one authoritative home domain. Base becomes default public production; X Layer remains its own market domain.

**Expensive to reverse:** yes.

### 2. Ticker-centric asset idea vs instrument identity

**Old risk:** “AAPL”/“NVDA” could be treated as the asset.

**Current reality:** Coinbase B20 and xStocks can reference the same company while carrying different issuer/legal/custody/corporate-action rights.

**Resolution:** separate `UnderlyingReference` from exact `InstrumentIdentity`.

**Expensive to reverse:** yes; do before mainnet data grows.

### 3. 0G plan says “Usance remains an X Layer protocol”

**Resolution:** obsolete wording. 0G is a cross-domain evidence/intelligence provider.

### 4. Chainlink Feeds vs Streams

**Old build finding:** the X Layer environment inspected during Phase 0 exposed Data Feeds, and the old PRD's Data Streams assumption was corrected.

**Current public ecosystem:** Chainlink now publicly describes broader X Layer RWA adoption and U.S.-equity Data Streams availability across supported networks.

**Resolution:** stop treating oracle product as a global architecture decision. Exact `OracleProvider` is instrument+domain+environment configuration.

### 5. Circle unavailable on X Layer

**Old:** CCTP treated as not supported.

**Current official Circle:** native USDC and CCTP are live on X Layer as of 2026-08-06.

**Resolution:** X Layer can use native USDC/CCTP production transport. Re-probe testnet separately.

### 6. Privy as “custody”

**Risk:** “Privy is institutional custody” can overstate the product/legal role.

**Resolution:** call it institutional wallet control, signing, policies and quorum. Only call a specific deployment custodial if the specific configuration/legal model supports that.

### 7. ENS as financial authority vs beta dependency

**New ETHOnline design:** ENS role is load-bearing public authority.

**Official docs:** ENSv2 interfaces are not final.

**Resolution:** load-bearing for the ETHOnline operation and public authority decision, but isolated behind adapter; executed facility state stores the historical authority proof and does not depend on future resolver liveness.

### 8. CRE qualification assumed final

**Old planning:** exact confidential handler requirement treated as fixed.

**Current ETHOnline page:** qualification requirements “Coming soon.”

**Resolution:** confidential-policy architecture stays; exact sponsor implementation contract is unresolved until kickoff.

### 9. Portfolio risk was P2

**New Base product:** portfolio-backed credit is the wedge.

**Resolution:** concentration/correlation/shared-risk become pre-mainnet.

### 10. Remote collateral was a major architectural headline

**New multi-domain rule:** asset stays native; facility stays on one domain.

**Resolution:** remote collateral becomes optional later transport/credit primitive, not launch architecture.

### 11. Sentinels X-Layer-specific

**Old:** Sentinel live proof tied to X Layer.

**Resolution:** Sentinel runtime is domain-neutral; deployment/executor adapters are per domain. X Layer remains one proof deployment.

### 12. Current implementation counts disagree

**Checklist:** 231 Forge at snapshot.

**Later Sentinel docs:** full Forge suite 244.

**Resolution:** documented state has advanced past the checklist's test-count line. Do not publish counts until fresh repo run.

### 13. Sentinel deployment status conflicts with prior chat reports

**Current Sentinel task file:** additive deployment still blocked/unresolved.

**Prior conversation:** deployer had funds and earlier core deployments were live.

**Resolution:** only current `deployments/*` and live read-back can resolve. Product Lock labels Sentinel live deployment/proof unresolved.

## Unresolved assumptions that must be verified before implementation lock

- actual git HEAD and dirty tree;
- current deployment addresses and proof ledger;
- current ETHOnline sponsor qualification switches;
- exact CRE confidential API/receipt shape;
- ENSv2 write interface/library version at build time;
- exact Base B20 ABI/corporate-action semantics for selected assets;
- exact xStocks X Layer addresses;
- exact oracle product/id per selected instrument/domain;
- real liquidation depth and market-maker routes;
- first lender/LP capital source;
- production KMS/quorum setup;
- legal/compliance posture for real credit;
- 0G provider/model/TEE route and cost;
- CCTP testnet availability for each planned test environment.

## Decisions that should be treated as RFC-level after lock

- facility home-domain invariant;
- InstrumentIdentity schema;
- facility accounting model;
- core authority split;
- upgrade/governance model;
- corporate-action accounting;
- AI trust boundary;
- proof/receipt immutability;
- cross-domain transport model.

---

<!-- CURRENT_STATE_AUDIT.md -->

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

---

<!-- PRODUCT_LOCK.md -->

# PRODUCT_LOCK.md

**Status:** LOCK CANDIDATE — architecture/product decision before implementation.

## 1. Company thesis

### Public sentence

> **Usance turns tokenized assets into usable capital.**

### Company/category sentence

> **Usance is the capital operating system for programmable real-world assets.**

### Technical sentence

> Usance identifies what a tokenized instrument actually represents, binds that understanding to evidence, computes what capital operations it can safely support, and clears financing and collateral operations on the instrument's authoritative market domain.

The three sentences serve different audiences. Do not force users to learn “operating system” language before understanding the outcome.

## 2. What Usance is not

Usance is not:

- a new tokenization wrapper for assets that already exist;
- a generic lending market with a new UI;
- an AI score that says an RWA is safe;
- a cross-chain bridge;
- a brokerage pretending different issuers' products are the same stock;
- an autonomous-agent wallet with unlimited signing authority;
- a hackathon brand that changes home chain every month.

## 3. The permanent company architecture

Usance owns five universal concepts:

1. **Instrument + Asset Passport** — what exactly is this tokenized instrument?
2. **Risk Engine + RiskEpoch** — what capital operations are allowed now?
3. **Capital Facility** — what financing/collateral relationship exists?
4. **Clearing + Reconciliation** — what is authorized, reserved, executed and finally settled?
5. **Autonomy Plane** — what may bounded agents observe/propose/execute under existing authority?

No one chain owns those concepts.

## 4. Market domains

A market domain is a chain/environment where a specific Usance facility's authoritative financial state lives.

### Base — default production domain

Primary wedge:

> **Portfolio-backed credit for programmable tokenized equities.**

Base is the default public production network because:

- Coinbase tokenized stocks are native B20 assets there;
- Base explicitly requests builders in credit, productive assets, personalized portfolios and agent-managed markets;
- the ecosystem already contains liquidity/lending venues;
- Base Batches requires Base-first/default-network commitment while allowing a multichain company.

Usance's differentiation is **not** “borrow against a stock.” Existing protocols already do that.

Usance adds:

- instrument-specific Passports;
- cross-issuer legal/economic normalization without fungibility;
- portfolio concentration/recovery-aware risk;
- corporate-action-aware capital capacity;
- facility-level clearing;
- collateral substitution;
- auditable bounded automation.

### X Layer — xStocks / OKX market domain

Primary wedge:

> **Capital markets infrastructure for xStocks and other tokenized RWA instruments distributed through OKX.**

X Layer remains important because:

- xStocks are live;
- OKX Wallet/DEX is a distribution and execution environment;
- native USDC/CCTP are now available on X Layer;
- Exchange OS provides a future market-adapter path;
- OKX Dev Day specifically solicits Tokenized Stocks and RWA products.

Usance should not redeploy a Base demo and call it X Layer innovation. The X Layer-specific delta is:

- exact xStocks instrument admission;
- multiplier/corporate-action-safe custody;
- xStocks collateral portfolios;
- X Layer financing facilities;
- native USDC cash path;
- OKX execution/distribution adapter;
- current Builder Code attribution;
- optional Exchange OS integration when access is real.

### Hedera — issuer/lifecycle and institutional collateral domain

Primary wedge:

> **Programmable collateral operations over issuer-managed tokenized securities.**

Hedera's role is not “the new home of Usance.”

ATS is the issuer/asset-lifecycle rail for the ETHOnline subsystem:

`ATS issue → pledge → finance → substitute → release/recall → settle`

### Ethereum / ENSv2 — cross-domain institutional namespace

ENSv2 does not own financial settlement.

It answers:

- which institution is this?
- which role/operator is being presented?
- which facility is being referenced?
- what public delegation currently exists?
- where is the authoritative facility contract?

It is a portable public descriptor/authority layer over market domains.

## 5. One facility = one authoritative domain

This is locked.

A facility has exactly one authoritative chain/domain for:

- collateral custody/commitment;
- debt;
- reservations;
- facility state;
- settlement finality.

Example:

- `BASE-1042` → Base;
- `XL-882` → X Layer;
- `HBAR-401` → Hedera.

Do not build a “global loan” whose mutable debt is half on Base and half on X Layer.

Cross-domain identity, evidence and cash transport can exist around a facility. They do not split its accounting authority.

## 6. Instrument identity: ticker is not identity

Locked identity principle:

`underlying reference != instrument`

Examples:

`Apple / Coinbase B20 / Base`

is not

`Apple / xStocks tracker certificate / X Layer`.

The Asset Passport must preserve:

- domain;
- contract/canonical instrument address;
- issuer;
- instrument type/version;
- underlying reference;
- custody model;
- beneficial/economic/ownership rights;
- voting rights;
- dividend model;
- corporate-action model;
- redemption/mint mechanics;
- transfer/jurisdiction restrictions;
- oracle/valuation route;
- liquidity route;
- collateral adapter;
- execution adapter.

Usance may normalize **capital semantics**. It may never erase legal/economic differences.

## 7. Product family

The company remains one brand.

### Usance Capital

For capital users, treasuries and market participants.

Outcomes:

- understand an admitted instrument;
- use it as collateral;
- borrow;
- repay;
- withdraw;
- monitor risk;
- manage a portfolio;
- authorize a Sentinel.

### Usance Collateral

Institutional facility operations.

Outcomes:

- create facility;
- pledge collateral;
- verify authority/policy;
- replace collateral without unwinding financing;
- recall/release;
- settle;
- produce a complete institutional receipt.

### Usance Sentinels

Bounded autonomous capital management.

A Sentinel is a user of existing delegated authority, not a protocol authority.

### Asset Passports

Public evidence + instrument semantics + current capability, not an AI “risk badge.”

### Usance Liquidity

Lender/vault interface. Capital supply must remain a real product, not hidden protocol plumbing.

## 8. Mainnet launch policy

Usance does not launch “all RWAs.”

Each new production domain begins with a **canary facility**:

- one or very few exact instruments;
- one settlement asset;
- one oracle policy;
- one liquidation/recovery route;
- conservative caps;
- no risk-increasing autonomous strategy at first;
- explicit shutdown/recovery playbook;
- complete proof ledger.

Base is the intended first production canary.

X Layer follows/continues as a production market domain after xStocks corporate-action, liquidity and exact-address admission are complete.

## 9. AI architecture

Locked invariant:

> **AI may produce intelligence. It may not produce financial authority.**

The AI plane is provider-neutral.

Interfaces should support multiple bounded providers:

- deterministic parser;
- ChainGPT;
- 0G Compute;
- future approved provider.

### 0G role

Use 0G where it gives a concrete trust property:

- Evidence Vault: archive approved public evidence and verify retrieved bytes against Usance hashes.
- Evidence extractor: use a pinned 0G provider/model route and record actual TEE mode/attestation.
- Ask Usance: contextual read-only explanation.

Prefer 0G **Direct** for evidence workflows where exact provider identity and attestation matter. Router may be used for non-authoritative explanation if provenance is still surfaced honestly.

Never say “verified AI” without naming the actual mode:

- TeeML;
- TeeTLS;
- or no verified mode.

Inference attestation does not prove the content is true.

## 10. Institutional authority stack

Permanent separation:

- **ENSv2:** public namespace/delegation/discovery.
- **Privy:** wallet/signing/quorum/policy control.
- **Chainlink CRE:** confidential policy/workflow where supported.
- **Market-domain contracts:** consequential financial state and settlement.

A sponsor can disappear without erasing the company. But a sponsor-specific demonstrated capability must genuinely regress when that sponsor is removed.

## 11. Cash and transport

`CashTransport` remains an adapter.

- Base: native USDC/CCTP can be a production path.
- X Layer: native USDC/CCTP is now a production path.
- Hedera: do not assume CCTP; use a domain-valid settlement asset and explicit adapter.
- Cross-domain cash movement must never turn one facility into split state.

## 12. Liquidity venues

Venues answer:

> **Where can an authorized action execute?**

Usance answers:

> **What is allowed to happen?**

Never reverse those authorities.

## 13. Business model

Long-term monetization:

- financing/origination spread;
- institutional facility fee;
- repo/securities-lending fee;
- liquidation/recovery fee;
- bounded Sentinel successful-run/platform fee;
- execution/venue fee where lawful/appropriate;
- premium Passport/risk API;
- issuer/integration fee;
- institutional data/workflow plans.

No governance token is required for the business to work.

## 14. Core metrics

Primary:

- recognized collateral;
- active financed notional;
- originations;
- repeat financing cycles;
- capital velocity;
- lender utilization;
- available exit coverage;
- liquidation recovery;
- bad debt / financed notional;
- Passport freshness/conflicts;
- facility settlement time;
- reconciliation latency;
- autonomous actions safely executed/refused;
- attributed users/transactions per market domain.

Do not optimize for wash volume.

## 15. Expensive-to-reverse decisions

Treat these as RFC-level:

1. one facility, one authoritative domain;
2. instrument identity separate from underlying ticker;
3. AI cannot authorize money;
4. ClearingHouse remains closed to feature creep;
5. venues remain adapters;
6. evidence/proof artifacts are generated, content-addressed and never rewritten;
7. unknown external execution reconciles instead of retrying blindly;
8. emergency authority restricts only;
9. no forced cross-chain wrapping for market-domain optics;
10. user mandates and protocol policy remain conjunctive.

---

<!-- USANCE_MASTER_PRD.md -->

# USANCE_MASTER_PRD.md

## 1. Product

### Name

Usance

### Promise

> **Make tokenized assets usable as capital.**

### Company category

Multi-domain capital, collateral and clearing infrastructure for programmable real-world assets.

### Problem

Tokenization solves representation. It does not solve capital use.

A token can transfer normally while:

- issuer terms change;
- custody changes;
- redemption becomes slower;
- corporate actions alter balances/economics;
- liquidity disappears;
- market hours change price reliability;
- eligibility changes;
- a wrapper diverges from another wrapper of the same underlying.

Once an instrument becomes collateral, those differences become balance-sheet risk.

Usance gives the financial system an enforceable path:

`Evidence → Instrument Passport → Risk → Facility → Authorized Action → Settlement → Receipt`

## 2. Target users

### A. Tokenized-asset holders

Jobs:

- get liquidity without selling;
- understand how much of a portfolio is actually financeable;
- stay safe as evidence/markets change;
- automate bounded risk management.

### B. Lenders / LPs / credit providers

Jobs:

- fund facilities with explicit asset/risk policy;
- know what collateral is legally/economically present;
- exit/withdraw predictably;
- recover value during stress.

### C. Institutions / treasury operators

Jobs:

- pledge assets;
- run repo/secured facilities;
- replace collateral without breaking financing;
- enforce approval/risk policy;
- prove who authorized and what settled.

### D. Issuers / asset platforms

Jobs:

- make instruments understandable/integrable;
- expose legal/corporate-action metadata;
- qualify for more financial use cases;
- receive an explicit readiness report rather than opaque listing decisions.

### E. Developers / agents / venues

Jobs:

- query Passport/risk/capability state;
- request authorized actions;
- consume proof receipts;
- integrate without becoming protocol authority.

## 3. Jobs-to-be-done

### Base launch JTBD

> I hold eligible Coinbase tokenized equities. Let me borrow conservatively against the portfolio without selling it, and explain exactly what constrains my capacity.

### X Layer JTBD

> I hold xStocks on X Layer. Let me turn them into financeable inventory while correctly handling xStocks' legal structure, multiplier/corporate actions and OKX execution surfaces.

### Institutional JTBD

> I have an active financing facility. Let me replace eligible collateral without unwinding it, while institutional authority and private lender policy remain enforced.

## 4. Domain model

### `UnderlyingReference`

Economic reference only:

- issuer/company/fund;
- ISIN/CUSIP/etc where lawful and available;
- public ticker;
- asset class.

It is not a token identity.

### `InstrumentIdentity`

Canonical Usance identity:

- `domainId`;
- chain/network;
- contract/native instrument identifier;
- issuer;
- instrument standard;
- instrument version;
- issuance/legal document set hash.

### `AssetPassport`

Versioned facts:

- identity;
- legal/economic rights;
- custody/backing;
- mint/redemption;
- transfer/eligibility;
- dividend/coupon;
- corporate actions;
- pricing/market session;
- liquidity/recovery paths;
- evidence roots;
- source confidence classes;
- expiry;
- capability recommendations.

### `RiskEpoch`

Immutable decision context:

- Passport versions;
- risk policy version;
- oracle/market snapshot;
- liquidity/exit curve;
- concentration state;
- settlement/cross-domain gates;
- account/facility state.

### `CapitalFacility`

Shared product abstraction, not necessarily one giant contract.

Fields:

- facility id;
- facility type;
- home domain;
- controller;
- borrower/account;
- lender/vault;
- settlement asset;
- collateral set;
- policy commitment;
- outstanding principal/debt;
- reservations;
- lifecycle state;
- current RiskEpoch;
- authority requirements;
- receipts.

Types may include:

- revolving collateralized credit;
- term secured credit;
- repo;
- securities lending;
- collateral-only/OTC facility.

### `CollateralPosition`

- exact instrument;
- quantity/accounting mode;
- recognized amount;
- eligibility;
- custody/lock reference;
- release conditions.

### `SubstitutionRequest`

- facility;
- old collateral;
- proposed replacement;
- proposer;
- public authority proof;
- private policy result;
- approval;
- replacement commitment;
- release receipt.

## 5. Core protocol layers

### 5.1 Instrument/Evidence layer

Responsibilities:

- canonical evidence ingestion;
- immutable raw/canonical hashes;
- source class;
- provider provenance;
- Passport versioning;
- conflict handling;
- eligibility metadata.

### 5.2 Risk layer

Responsibilities:

- fixed-point valuation;
- mark haircut;
- stressed exit;
- valid redemption floor only when legally/operationally executable;
- issuer/asset/sector concentration;
- portfolio correlation/stress;
- market-session constraints;
- corporate-action gates;
- freshness;
- maintenance and new-risk thresholds.

### 5.3 Facility layer

Responsibilities:

- facility lifecycle;
- participant authority;
- collateral commitment;
- debt/principal;
- interest/fees;
- substitution;
- recall/release;
- settlement.

The existing consumer `ClearingHouse` remains the current revolving-credit implementation. Do not force repo/substitution logic into it.

### 5.4 Clearing/reconciliation

Responsibilities:

- authorize;
- reserve;
- submit;
- observe;
- reconcile;
- final receipt.

External venues never own Usance debt/collateral accounting.

### 5.5 Autonomy plane

Sentinels:

- observe;
- trigger;
- pin snapshot;
- compile;
- validate;
- check live authority;
- reserve;
- execute;
- reconcile.

`AllowedAction = ProtocolAllows ∧ MandateAllows`

No Sentinel withdrawal path.

## 6. Corporate-action accounting

This becomes a first-class product requirement.

### xStocks adapter

Must model:

- multiplier activation;
- EVM balance semantics;
- pause-sensitive windows;
- dividend/split/reverse-split behavior;
- exact issuer instrument metadata.

Do not store “deposited amount” as a permanently immutable economic quantity if the token's protocol semantics change the effective balance.

### B20 adapter

Must read the current official B20 asset variant and multiplier/corporate-action semantics.

Do not assume xStocks and B20 implement multiplier accounting the same way.

Every adapter owns its exact `quantityAccountingMode`.

## 7. Portfolio-backed risk

Base launch promotes portfolio risk to load-bearing.

Required:

- per-instrument cap;
- issuer cap;
- underlying/company concentration;
- sector concentration;
- shared-custodian/shared-issuer correlation;
- market-session state;
- liquidation depth;
- stress correlation;
- haircuts that can only become more restrictive under missing data.

A portfolio's capacity is not the sum of independent per-asset LTVs.

## 8. Base product

### Product surface

**Usance Stock Credit**

Outcome:

> Borrow USDC against an eligible portfolio of Coinbase tokenized stocks without selling it.

First production version:

- 1–3 exact Coinbase instruments chosen by liquidity/oracle/corporate-action readiness;
- USDC settlement;
- conservative portfolio limits;
- one liquid recovery route;
- lender vault with real deposit/withdraw;
- Safety Buffer Sentinel risk-reduction only.

Usance may later add:

- revolving portfolio credit;
- collateral substitution;
- concentrated-position credit;
- productive/yield-aware structures only where instrument economics support it;
- Personal Baskets as managed portfolios, not automatically new public securities.

## 9. X Layer product

### Product surface

**Usance X / X Layer market domain**

Outcome:

> Use xStocks as programmable collateral and financing inventory on X Layer.

Required domain-specific work:

- exact xStocks registry ingestion;
- legal/product Passport;
- multiplier-safe vault accounting;
- Chainlink per-instrument oracle/session adapter;
- native USDC/CCTP settlement where appropriate;
- OKX Wallet support;
- Builder Code attribution;
- OKX DEX execution adapter/handoff;
- Exchange OS adapter only with real access.

## 10. Usance Collateral

### Institutional facility product

Outcome:

> Replace eligible collateral without unwinding an active financing facility.

State:

`DRAFT → APPROVAL_PENDING → ACTIVE → SUBSTITUTION_PENDING → ACTIVE / REJECTED → SETTLING → SETTLED`

A substitution request never makes old collateral releasable until replacement is committed under the facility's atomicity model.

Preferred same-domain atomic path:

1. verify facility active;
2. verify proposer authority;
3. verify replacement eligibility result fresh;
4. verify required institutional approvals;
5. transfer/lock replacement;
6. verify post-transfer committed balance;
7. release old collateral;
8. emit one settlement receipt.

If the asset rail makes single-transaction atomicity impossible, use an escrowed two-phase protocol where step 7 is structurally unreachable before step 6 is finalized.

## 11. ETHOnline sponsor responsibilities

### ENSv2

Purpose:

- public institution/facility namespace;
- delegated role discovery;
- authoritative routing to facility contract;
- revocation/expiry check at operation time.

For sensitive checks, use canonical hierarchy verification rather than a stale resolver cache.

ENS outage:

- no new authority-sensitive substitution;
- existing facility remains safe;
- risk-reducing/emergency operations follow a separate onchain authority path where designed.

### Privy

Purpose:

- organization wallet;
- signers;
- quorum;
- policies;
- action authorization.

Privy outage:

- no new Privy-required high-risk operation;
- no silent fallback signer;
- current collateral remains locked.

### Chainlink CRE

Purpose:

- confidential lender policy evaluation;
- produce a decision receipt/commitment suitable for facility gating.

Exact confidential primitive and ETHOnline qualification are re-verified at kickoff because current prize requirements are not final.

CRE outage:

- no new substitution that requires confidential policy;
- old collateral remains.

### Hedera ATS

Purpose:

- actual digital-security asset lifecycle;
- transfer restrictions/lock/pause semantics;
- consequential collateral movement.

Hedera/ATS transfer failure:

- old collateral remains;
- replacement not marked committed;
- workflow reconciles exact state.

## 12. 0G intelligence layer

### `EvidenceIntelligenceProvider`

Provider-neutral interface.

Outputs:

- strict structured claims;
- quote offsets;
- source/provenance;
- provider/model/version;
- request/response digests;
- attestation mode/status.

### 0G Evidence Vault

Archive approved public evidence.

The archive root is not legal truth.

### 0G Direct evidence extractor

Preferred when Usance wants:

- known provider;
- exact model route;
- TEE mode;
- response integrity/attestation.

Store:

- provider address;
- service/model id;
- TeeML/TeeTLS/none;
- provider verification result;
- request digest;
- response digest;
- proof/attestation references.

### Ask Usance

Read-only explanation plane.

May explain:

- why capacity is lower;
- what evidence changed;
- why a substitution was denied;
- which deterministic constraint binds;
- what safe repair routes exist.

No state-changing tools.

## 13. Security model

Financial invariants remain deterministic.

AI, ENS, Privy, CRE, 0G, Circle and venues are all external trust boundaries with explicit failure states.

Critical principles:

- missing external data reduces capability;
- stale decisions cannot authorize new risk;
- retries do not duplicate money effects;
- proof artifacts are immutable/superseded;
- no arbitrary recipient in delegated/yield paths;
- no bridge creates synthetic collateral credit without locked/source proof;
- mainnet upgrades cannot silently widen risk.

## 14. Governance and upgradeability

Production roles:

- `GUARDIAN`: restrict/pause only;
- `GOVERNANCE`: delayed widening/upgrade;
- `ADMISSION`: commit approved Passport/instrument versions;
- `RISK`: activate versioned risk policy;
- `OPERATOR/EXECUTOR`: bounded workflows;
- `KEEPER`: liquidation/reconciliation according to contracts.

Production recommendations:

- role separation;
- hardware/managed key or institutional signer;
- timelocks for privilege increases;
- emergency pause for new risk;
- repayment/recovery paths stay open wherever safe;
- mainnet deployment manifests immutable and content-addressed.

## 15. Economics

Borrower economics:

- origination fee;
- interest/spread;
- optional facility fee.

Lender economics:

- interest;
- explicit reserve contribution;
- explicit loss waterfall;
- withdrawal queue.

Keeper economics:

- recoverable liquidation incentive.

Sentinel economics:

- bounded successful-run fee, never fee on unexecuted/duplicate run.

Institutional:

- facility/platform fee;
- premium risk/evidence/data APIs.

## 16. Mainnet canary acceptance

Before first Base mainnet capital:

- exact instrument addresses verified from issuer source;
- exact legal/eligibility Passport;
- corporate-action tests;
- portfolio risk;
- oracle/session/freshness test;
- liquidation depth measured;
- LP deposit/withdraw live;
- low caps;
- production roles/signers;
- explorer verification;
- structured logs/metrics;
- clean-room;
- independent security review;
- runbooks;
- public limitations;
- no unresolved high/critical findings.

## 17. Expansion

After Base canary:

- X Layer xStocks production facility;
- institutional Hedera facility;
- more issuers/instruments;
- richer facility types;
- Sentinel Event Guard/Treasury Recycle;
- issuer readiness;
- cross-domain cash transport;
- remote collateral only when economically justified.

Usance does not expand by adding chains to a logo row. It expands by adding a real market domain with a distinct instrument set, liquidity and product capability.

---

<!-- ARCHITECTURE.md -->

# ARCHITECTURE.md

## 1. Architectural model

```text
                         USANCE CONTROL / INTELLIGENCE PLANE

          ENSv2              Privy               0G / evidence providers
      public identity     signing/quorum        interpretation + provenance
             \                 |                         /
              \                |                        /
               +---------- policy / authority --------+
                                |
                           Chainlink / market
                        truth + confidential policy
                                |
                                v
+-----------------------------------------------------------------------+
|                         USANCE PROTOCOL                               |
|                                                                       |
| Instrument Identity -> Passport -> RiskEpoch -> Capital Facility      |
|                                      |                                |
|                               Clearing / Reservations                 |
|                                      |                                |
|                               Reconciliation / Receipt                |
+-----------------------------------------------------------------------+
              |                    |                     |
              v                    v                     v
          BASE DOMAIN          X LAYER DOMAIN        HEDERA DOMAIN
          B20 assets           xStocks / OKX          ATS securities
          USDC                 USDC/CCTP              domain cash
          Base venues          OKX/venues             ATS lifecycle
```

The top plane does not own facility debt/collateral state.

## 2. One facility, one home domain

`FacilityDescriptor.homeDomain` is immutable after activation.

All mutable facility financial state is owned by one domain controller.

Cross-domain systems may:

- resolve identity;
- supply evidence;
- approve/sign;
- supply market data;
- transport cash before/after a facility operation.

They may not create two canonical copies of debt.

## 3. Existing core and new modules

### Existing, preserved

- `AssetRegistry`;
- `EvidenceRegistry`;
- `PassportRegistry`;
- `RiskPolicyRegistry`;
- `ClearingHouse`;
- `CollateralVault`;
- `LiquidityVault`;
- `FinancingEngine`;
- `FeeController`;
- `LiquidationManager`;
- `MandateRegistry`;
- `IntentBook`;
- `DelegationGateway`;
- `EmergencyController`.

### Add outside ClearingHouse

`ClearingHouse` is already code-size constrained and is treated as closed.

Add:

- `DomainRegistry` — metadata/config only, no money authority;
- richer `InstrumentRegistry` or AssetRegistry v2 migration layer;
- `FacilityRegistry` — facility descriptors, not debt duplication;
- `InstitutionalFacilityController` — repo/collateral-substitution facility implementation;
- `CollateralSubstitutionModule`;
- domain adapters;
- oracle/session adapters;
- cash transport adapters;
- issuer/corporate-action adapters;
- production signer/provider interfaces.

## 4. Instrument identity

Recommended canonical id:

```text
InstrumentId = H(
  domainId,
  canonicalInstrumentAddressOrNativeId,
  issuerId,
  instrumentStandard,
  instrumentVersion
)
```

`UnderlyingReferenceId` is separate.

Never derive InstrumentId from ticker alone.

## 5. Passport composition

Passport sections:

```text
Identity
LegalRights
BackingAndCustody
RedemptionAndPrimaryMarket
TransferAndEligibility
IncomeAndCorporateActions
MarketAndValuation
LiquidityAndRecovery
DomainAndAdapters
EvidenceAndProvenance
StatusAndExpiry
```

A Passport version is immutable.

New facts create a new version.

Conflicts restrict.

## 6. Risk engine

### Single instrument

```text
recognized =
min(
  haircutAdjustedMark,
  stressedExecutableExit,
  validExecutableRedemptionFloor
)
```

subject to:

- evidence;
- eligibility;
- oracle freshness;
- market session;
- concentration;
- settlement;
- issuer/custodian;
- corporate-action;
- domain gates.

### Portfolio

Add deterministic stress model:

```text
PortfolioRecognized
= sum(singleInstrumentRecognized)
- concentrationPenalty
- correlationStress
- sharedIssuerPenalty
- sharedCustodyPenalty
- liquidationDepthPenalty
```

Exact formula and monotonicity must be reference-modelled before Solidity.

Missing data cannot improve recognition.

## 7. Facility architecture

### Consumer/revolving credit

Use existing ClearingHouse/FinancingEngine.

### Institutional facility

Separate controller.

Do not turn ClearingHouse into a universal mega-contract.

Interface concept:

```text
interface ICapitalFacility {
  function facilityId() external view returns (bytes32);
  function homeDomain() external view returns (bytes32);
  function status() external view returns (FacilityStatus);
  function currentRiskEpoch() external view returns (uint64);
  function settlementAsset() external view returns (address);
}
```

Facility-specific modules expose additional operations.

### Collateral substitution

Key invariant:

```text
release(oldCollateral)
requires
replacementCommitted == true
AND eligibilityDecisionFresh == true
AND authorityFresh == true
AND facilityAfterReplacementSafe == true
```

Prefer one transaction on the home domain.

## 8. Domain adapter interfaces

### `IInstrumentAdapter`

- canonical identity;
- decimals/accounting mode;
- current effective balance semantics;
- transfer/lock capability;
- pause/freeze state;
- corporate-action state.

### `IOracleProvider`

- quote;
- timestamp;
- session/market metadata where available;
- source version;
- freshness;
- failure reason.

Do not have a global “ChainlinkDataStreamsAdapter” assumption.

### `ILiquidityObserver`

- executable exit curve by size;
- venue;
- timestamp;
- failure probability;
- fees/latency.

### `IExecutionVenue`

- quote;
- reserve;
- submit;
- query;
- cancel;
- reconcile.

### `ICashTransport`

- supported source/destination;
- initiate;
- observe;
- reconcile.

Transport is not facility state.

### `IInstitutionalAuthorityProvider`

- resolve entity/role;
- verify freshness;
- return proof reference.

ENS and Privy implement different sub-roles; they are not interchangeable.

### `IConfidentialPolicyProvider`

- policy commitment;
- decision inputs digest;
- allow/deny/terms;
- proof/receipt;
- expiry.

## 9. Base adapter

`BaseB20Adapter`

Responsibilities:

- official contract allowlist;
- B20 variant;
- multiplier/corporate-action semantics;
- eligibility metadata;
- authoritative prospectus links.

No address inferred from ticker.

## 10. X Layer adapter

`XStocksAdapter`

Responsibilities:

- exact issuer address;
- multiplier/rebase semantics;
- corporate-action windows;
- legal/product identity;
- redemption/primary market;
- current transfer state.

Cash:

- native USDC/CCTP where current support is valid.

Execution:

- OKX Wallet;
- DEX Interface;
- DEX API;
- Exchange OS;
- Uniswap/other venues;

each as distinct types.

## 11. Hedera ATS adapter

Responsibilities:

- issued security identity;
- partitions/compliance state where applicable;
- pause/lock/approval state;
- transfer validation;
- lifecycle operations;
- HashScan proof.

Do not model ATS asset state as a generic ERC-20 if the relevant compliance/partition semantics matter.

## 12. ENSv2 adapter

ENS is public authority/discovery.

For each operation store:

- name;
- canonical registry/resolver proof;
- resource/role checked;
- block;
- expiry;
- result.

Never trust a long-lived cached resolver for a security-sensitive write.

Because ENSv2 interfaces are beta:

- capability probe;
- pin supported library/version;
- isolate writes behind adapter;
- do not put ENS-specific storage layout into financial contracts.

## 13. Privy adapter

Privy answers signing/control.

Store:

- wallet id/address;
- quorum/policy reference;
- request/approval id;
- signed tx digest;
- approver metadata allowed by privacy policy.

Never store raw key material.

## 14. Chainlink architecture

### Market truth

Per instrument/environment choose:

- Data Feed;
- Data Stream;
- DataLink/custom feed;
- or unavailable.

The choice is configuration, not protocol identity.

### CRE confidential policy

For institutional substitution, the confidential workflow receives:

- proposed replacement descriptor;
- public facility snapshot;
- private lender policy;
- market/risk inputs;

and returns a bounded decision receipt.

The chain never receives the private policy book.

The current ETHOnline qualification rules are not final, so exact sponsor-specific handler requirements are deferred until kickoff re-check.

## 15. 0G architecture

### Evidence

Use `EvidenceIntelligenceProvider`.

0G Direct path is preferred for an auditable extractor because it exposes provider identity and TEE verification metadata.

### Storage

`ZeroGEvidenceArchiveAdapter` is optional.

Financial logic continues to use Usance evidence hashes, not storage availability.

### Ask Usance

Read-only.

No signing/writes.

## 16. Circle architecture

`CircleCctpTransport` may be enabled only on officially supported domains.

Current product-lock knowledge:

- Base: yes;
- X Layer: yes;
- Hedera: not assumed.

Cross-domain CCTP receipts are transport receipts, not proof that a facility changed state.

## 17. Data/indexing

Each market domain has:

- block cursor;
- deployment digest;
- finality/reorg model;
- event projections.

Global read model aggregates domain projections but does not become money authority.

Recommended ids always include `homeDomain`.

## 18. Failure model

### External authority unavailable

New high-risk action blocked.

Existing facility stays safe.

### Confidential policy unavailable

Substitution cannot proceed.

Old collateral remains.

### Market data stale

New risk blocked.

Repay/reduce-risk remains open where safe.

### Venue unknown

Reservation remains until reconciliation.

### Corporate action pending

Asset may enter `NO_NEW_RISK` / restricted transfer window.

### Domain outage

No cross-domain controller guesses state.

Read model shows stale/unknown.

## 19. Repo target

```text
usance/
├── protocol/
│   ├── instrument/
│   ├── evidence/
│   ├── risk/
│   ├── facilities/
│   ├── clearing/
│   ├── mandates/
│   └── sentinels/
├── adapters/
│   ├── base-b20/
│   ├── xlayer-xstocks/
│   ├── hedera-ats/
│   ├── ensv2/
│   ├── privy/
│   ├── chainlink/
│   ├── zerog/
│   ├── circle/
│   └── venues/
├── services/
│   ├── evidence/
│   ├── indexer/
│   ├── api/
│   ├── workflow/
│   └── sentinel/
├── apps/web/
├── deployments/
│   ├── base/
│   ├── xlayer/
│   └── hedera/
├── proof/
├── competitions/
│   ├── ethonline-2026/
│   └── okx-devday-2026/
└── docs/
```

---

<!-- MIGRATION_PLAN.md -->

# MIGRATION_PLAN.md

## Goal

Move from “X Layer-centric Usance with new modules” to the locked multi-domain company architecture without rewriting working financial logic.

## Phase 0 — freeze source truth

Before any migration:

- capture actual HEAD;
- regenerate test counts;
- regenerate master checklist;
- regenerate proof claim counts;
- load exact deployment manifests;
- list dirty/uncommitted work;
- hash Product Lock documents.

This resolves the current documentation-count drift.

## Phase 1 — identity model before chain ports

### Reuse

- Evidence IDs/hashing;
- Passport versioning;
- source class;
- claim conflict;
- RiskEpoch concept.

### Refactor

Current asset identity must become explicit instrument identity.

Introduce:

- `UnderlyingReference`;
- `InstrumentIdentity`;
- `IssuerIdentity`;
- `DomainId`;
- `InstrumentAccountingMode`.

Add migration mapping for existing X Layer test instruments.

Do **not** silently reinterpret old ids.

Existing proofs keep their historical id/version semantics.

## Phase 2 — domain-neutral configuration

Extract X Layer constants from:

- wallet/network config;
- manifests;
- oracle setup;
- proof links;
- builder-code logic;
- deployment scripts.

Create domain registry/config packages.

Do not add `if (chainId == ...)` branches throughout core money contracts.

## Phase 3 — preserve existing ClearingHouse

No rewrite.

Existing consumer/revolving credit becomes one facility implementation.

Add a higher-level `CapitalFacilityDescriptor` in schemas/read models.

Do not add institutional substitution logic to the near-EIP-170 ClearingHouse.

## Phase 4 — corporate-action accounting

Before either stock domain goes mainnet:

- xStocks multiplier/rebase harness;
- B20 multiplier/corporate-action harness;
- deposit/withdraw conservation;
- two-user proportionality;
- split/reverse-split/dividend;
- activation-window restriction;
- liquidation during/around action;
- share/NAV impact where instrument enters vault.

These tests must run against instrument-specific adapters.

## Phase 5 — portfolio risk

Promote current concentration/correlation work.

Reference model first.

Then Solidity/TS/Rust conformance where the financial path needs it.

Do not deploy Base stock credit using only isolated per-asset LTV.

## Phase 6 — Base domain

Create:

- Base deployment config;
- B20 adapter;
- issuer directory ingestion;
- oracle/session adapter;
- USDC settlement;
- liquidity observer;
- liquidation route;
- Base UI/domain state;
- Base proof ledger.

Launch only canary assets.

## Phase 7 — X Layer domain upgrade

Preserve existing X Layer proofs/history.

Add:

- production xStocks adapter;
- multiplier-safe accounting;
- native USDC/CCTP adapter;
- exact OKX execution surfaces;
- updated oracle/session policy;
- Dev Day module/evidence.

No destructive overwrite of historic deployment records.

## Phase 8 — institutional facility

Build a new facility implementation:

- facility registry/descriptor;
- institutional participants;
- pledged collateral;
- substitution request;
- policy receipt;
- approval receipt;
- atomic replacement/release;
- settlement receipt.

Reuse Passport/Risk/receipt semantics.

## Phase 9 — sponsor adapters

Implement independently:

- ENSv2;
- Privy;
- Chainlink CRE;
- Hedera ATS.

Then compose the ETHOnline critical path.

This makes sponsor-removal testing possible.

## Phase 10 — 0G

Replace old X-Layer-specific wording in 0G plan.

Implement provider-neutral evidence intelligence.

Then:

- 0G Storage archive;
- 0G Direct extraction;
- provenance UI;
- Ask Usance.

Do not remove the deterministic parser.

## Phase 11 — product IA migration

Keep existing working routes where they map cleanly.

Add distinct Institutional workspace.

Do not turn every personal page into an institutional terminal.

## Phase 12 — operational/mainnet hardening

- explorer verification;
- logs/metrics;
- production database/store;
- key management;
- external audit;
- caps;
- incident exercises;
- canary launch;
- post-launch monitoring.

## Code likely reusable

High confidence:

- risk math;
- fixed-point libraries;
- evidence hashing/canonicalization;
- Passport registry logic;
- mandate/delegation;
- IntentBook;
- liquidation mechanics/patterns;
- proof receipts;
- artifact freshness;
- Sentinel runtime;
- UI design system.

## Code likely refactored

- AssetRegistry identity/schema;
- chain config;
- oracle adapters;
- asset accounting adapters;
- indexer keys/projections;
- deployment manifest schema;
- public asset routes;
- risk model for portfolios;
- settlement-asset configuration.

## Code to add

- domain registry/config;
- B20 adapter;
- xStocks production adapter;
- institutional facility controller;
- substitution module;
- ENSv2 adapter;
- Privy adapter;
- CRE adapter;
- Hedera ATS adapter;
- 0G package;
- Circle transport adapter;
- institutional UI/API.

## Code to retire/mark historical

- global assertions that X Layer is canonical company state;
- old Data Streams/Feeds hardcoding;
- old Circle-unavailable-on-X-Layer assumption;
- any ticker-only instrument mapping;
- competition-specific constants inside core modules.

---

<!-- COMPETITION_MATRIX.md -->

# COMPETITION_MATRIX.md

## Rule

The company does not change identity for competitions. Each program funds a distinct Usance market/module.

| Program | Company story | New judged delta | Existing work shown only as context | Critical external dependencies |
|---|---|---|---|---|
| Base Batches 004 | Usance company | Base default production, portfolio-backed programmable-equity credit | X Layer proof/history, generic core | Coinbase B20 assets, Base liquidity/oracles |
| ETHOnline 2026 | Usance Collateral | institutional facility + collateral substitution | existing Passport/risk/receipts/authority patterns | Hedera ATS, ENSv2, Privy, Chainlink CRE |
| OKX Dev Day 2026 | Usance X | xStocks capital market domain + OKX/X Layer production delta | existing X Layer testnet core | xStocks, USDC/CCTP, OKX surfaces, possible Exchange OS access |

## Base Batches 004

- Application deadline: 2026-09-09.
- Base allows multichain companies but explicitly expects Base to be the default network.
- Application is **Usance**, not a hackathon fork.
- Pitch:
  > Usance turns programmable real-world assets into usable capital, starting with portfolio-backed credit against tokenized stocks on Base.
- Do not claim exclusivity.
- Do not claim Usance invented stock lending; differentiate on instrument normalization, recovery-aware portfolio risk, facilities, collateral operations and bounded automation.

## ETHOnline 2026

At kickoff:

- freeze `baseline_commit`;
- capture current clean/dirty state;
- create `PREEXISTING.md`;
- create new-work manifest;
- verify Continuity eligibility and sponsor toggles in the actual dashboard.

Judging story:

> **Keep the financing open. Replace the collateral.**

Do not show Base/X Layer in the main sponsor diagram.

### Target integrations

- Hedera ATS — asset/lifecycle state;
- ENSv2 — public institution/facility authority/discovery;
- Privy — actual organizational signing/quorum;
- Chainlink CRE — confidential lender policy.

Current caution:

- Chainlink Confidential Workflow qualification requirements are not finalized on the current ETHOnline prize page.
- ENSv2 is beta/Sepolia.
- Hedera Continuity-specific prizes may have separate prior-Hedera requirements; do not assume eligibility.

## OKX Dev Day 2026

User-supplied program dates:

- applications close 2026-09-11 23:59 UTC;
- build 2026-09-17 to 2026-09-25;
- finalist selection 2026-09-28 to 2026-09-30;
- Singapore finale 2026-10-06.

Primary track:

**X Layer: Tokenized stocks and RWA**

New delta:

- production xStocks adapter;
- rebasing/corporate-action-safe collateral;
- xStocks portfolio capacity;
- native USDC financing;
- OKX Wallet/distribution;
- OKX DEX route/handoff;
- Builder Code proof;
- Exchange OS only if actual access is provided;
- Sentinel or collateral-substitution flow only if it compounds the above and is genuinely new work.

Pitch:

> OKX is bringing tokenized markets to X Layer. Usance makes those instruments reusable capital.

## Evidence isolation

`competitions/<event>/` must contain:

- baseline;
- commit range;
- sponsor dependencies;
- testnet/mainnet addresses;
- proof ids;
- demo path;
- claims safe to make;
- claims not safe to make;
- known limitations.

No competition-specific lie survives outside its folder.

---

<!-- ETHONLINE_2026_PLAN.md -->

# ETHONLINE_2026_PLAN.md

## Product

### Usance Collateral

> **Programmable collateral operations for tokenized real-world assets.**

Hero mechanism:

> **Replace eligible collateral without unwinding an active financing facility.**

## Why it belongs in Usance

Tokenized assets become useful when they can support financing. Real financing needs mid-life collateral operations, not just “deposit once and wait.”

Collateral substitution is a recognized institutional operation: a borrower needs an asset back but the financing should remain open.

## Golden facility

```text
Facility F-1042
Borrower: Acme Treasury
Lender: Northstar Capital
Settlement: test facility currency
Collateral: ATS Treasury A
Status: ACTIVE
```

Borrower proposes ATS Treasury B.

## Critical path

### 1. ENSv2 — public institutional authority

Resolve:

- institution;
- facility descriptor;
- operator role;
- expiry/revocation;
- home-domain contract.

For sensitive role checks use current canonical hierarchy functions rather than stale cached resolution.

Output: `NamespaceAuthorityReceipt`.

### 2. Privy — organizational signing/quorum

The operation must be authorized by the configured organization wallet/quorum/policy.

Output: `InstitutionalApprovalReceipt`.

### 3. Chainlink CRE — confidential lender policy

Inputs:

- proposed replacement;
- facility snapshot;
- public authority context;
- market/risk inputs;
- private lender policy.

Output:

- allow/deny;
- public decision code;
- policy commitment;
- input digest;
- decision expiry;
- proof/receipt supported by the final current CRE primitive.

**Do not hard-code an ETHOnline-specific TEE API until the current qualification requirements are published.**

### 4. Hedera ATS — consequential asset lifecycle

ATS Treasury B is committed.

Only then may ATS Treasury A be released.

Facility remains ACTIVE.

Output: onchain settlement tx + HashScan proof.

## Atomicity invariant

Old collateral is not releasable unless:

- replacement identity is exact;
- transfer restrictions pass;
- replacement is committed/locked;
- policy decision is fresh and matches the facility;
- required organizational approval is fresh;
- post-switch coverage is valid.

### Best path

One Hedera transaction executes replacement-lock + old-release under a facility contract/module.

### Acceptable fallback

Two-phase escrow:

`REPLACEMENT_PENDING → REPLACEMENT_COMMITTED → OLD_RELEASED`

`OLD_RELEASED` has no transition from `REPLACEMENT_PENDING`.

## Negative twin

Treasury C fails confidential lender policy.

Expected:

- decision `REJECTED`;
- old collateral unchanged;
- facility remains ACTIVE;
- no release transaction;
- receipt shows exact failing policy class without revealing private policy.

## Sponsor-removal regressions

### Remove ENS

Usance cannot prove the presented operator still has the institution's public delegated authority.

### Remove Privy

Usance lacks the required controlled organization authorization/quorum.

### Remove Chainlink CRE

Either private lender policy must be revealed or Usance must trust a private server assertion. Demonstrated confidential-policy guarantee disappears.

### Remove Hedera ATS

The actual tokenized-security lifecycle and consequential settlement disappear.

## Adversarial cases

- revoked ENS role after proposal;
- Privy quorum not met;
- stale CRE result;
- CRE result replayed for another facility;
- replacement transfer fails;
- ATS asset paused;
- ATS asset frozen/restricted;
- insufficient replacement value;
- policy version changes;
- duplicate request;
- two substitutions race;
- worker crashes after replacement lock but before receipt;
- RPC returns stale state;
- authority service outage;
- facility settles while substitution pending;
- old collateral release attempted directly.

## Proof campaign

Positive, negative, boundary and incomplete-information cases.

Repeat each end-to-end run from a clean state.

Every sponsor gets a raw receipt.

## UI

Institutional workspace:

- Facilities;
- Facility detail;
- Collateral;
- Substitute;
- Approvals;
- Policy result;
- Settlement timeline;
- Proof.

Hero flow should be understandable without explaining every sponsor first.

## Continuity hygiene

Before hack starts:

- exact baseline commit;
- tests;
- deployment/proof digest;
- `PREEXISTING.md`.

During event:

- all ETHOnline work tagged/manifested;
- sponsor-specific proofs;
- no preexisting core work presented as new.

## Success definition

A judge can see:

1. active facility;
2. current collateral;
3. proposed replacement;
4. real ENS role;
5. real Privy approval;
6. real confidential policy decision;
7. real ATS settlement;
8. same financing still ACTIVE;
9. negative replacement refused without releasing old collateral.

---

<!-- OKX_DEV_DAY_2026_PLAN.md -->

# OKX_DEV_DAY_2026_PLAN.md

## Primary track

**X Layer: Tokenized stocks and RWA**

## Product delta

Usance should not submit the old X Layer build unchanged.

Build the first production-shaped **xStocks market domain**.

## One-line product

> **Use xStocks as programmable collateral and financing inventory on X Layer.**

## Why OKX/X Layer should care

Trading creates one capital event.

Financing lets the same RWA position create:

- collateral demand;
- stablecoin borrowing;
- lender demand;
- trading/hedging;
- repayment;
- liquidation/keeper flow;
- repeated capital turns.

Usance should measure:

`capital velocity = financed activity / average recognized collateral`

not manufactured volume.

## Required new work

### Instrument admission

- xStocks exact issuer/address registry;
- legal/product Passport;
- issuer/custody/redemption;
- corporate action/multiplier;
- transfer restrictions.

### Accounting

- rebase-aware custody;
- share of multiplier changes;
- no orphan balance;
- no user over/under-credit after corporate action.

### Market risk

- market-session state;
- exact Chainlink product per xStock;
- price + freshness + context;
- executable liquidity curve.

### Cash

Native USDC on X Layer.

CCTP only for transport, not split facility state.

### OKX surfaces

Keep types separate:

- Wallet;
- DEX Interface;
- DEX API;
- Exchange OS/TradeZone;
- Builder Codes.

No claim that API volume is Interface volume unless the current program says so.

### Sentinels

Strong optional/live demo:

Safety Buffer observes a real X Layer account deterioration and repays within mandate.

Event Guard becomes useful only after a real execution venue exists.

## Main demo

```text
Exact xStock
  ↓
Asset Passport
  ↓
recognized portfolio capacity
  ↓
deposit
  ↓
borrow native USDC
  ↓
Safety Buffer / collateral management
  ↓
repay / execute / reconcile
  ↓
public receipt
```

## Partner alignment

- xStocks: additional utility and financing demand;
- OKX Wallet: more useful asset holdings;
- X Layer: capital velocity and settlement;
- Circle: native settlement liquidity;
- market makers/LPs: financing and liquidation flow;
- Exchange OS: later authorized execution.

## What not to claim

- that xStock is the underlying share itself;
- that stock-backed borrowing is novel;
- that Exchange OS access exists before granted;
- that every OKX stock token is the same issuer/structure;
- that CCTP makes facility state cross-chain;
- that agent execution is autonomous if user Interface confirmation is required.

---

<!-- BASE_STRATEGY.md -->

# BASE_STRATEGY.md

## Company position

Base is Usance's default public production network.

This satisfies Base Batches' Base-first requirement without making Usance chain-exclusive.

## Initial market

### Usance Stock Credit

> **Borrow USDC against an eligible portfolio of programmable tokenized equities without selling it.**

## Why this is not “another Aave”

Base already has stock lending/borrowing venues.

Usance's product is the capital facility and risk layer around heterogeneous programmable assets:

- Passport;
- legal/economic identity;
- corporate-action awareness;
- portfolio concentration;
- recovery-aware capacity;
- collateral substitution;
- bounded automation;
- unified receipt.

Usance can source liquidity from its own vault and later integrate external capital/venue adapters where doing so does not bypass its risk model.

## First ICPs

### 1. Eligible non-US sophisticated tokenized-stock holders

Need:

- liquidity without sale;
- portfolio-backed rather than isolated position credit;
- explainable risk;
- self-custody-aware UX.

### 2. Market makers / active tokenized-stock users

Need:

- inventory financing;
- capital efficiency;
- substitution;
- reliable liquidation/recovery.

### 3. Asset managers / portfolio products

Need:

- financing around model portfolios;
- concentration and constituent risk;
- agent/rebalancer integration.

## Canary

Do not choose a ticker by brand recognition.

Choose 1–3 Coinbase B20 instruments after scoring:

- official address;
- legal eligibility;
- oracle support;
- DEX depth;
- liquidation route;
- corporate-action complexity;
- concentration;
- borrow demand.

Settlement: native USDC.

## Base-specific architecture

- `BaseB20Adapter`;
- official issuer directory ingestion;
- Base oracle/session config;
- Base liquidity observer;
- Base liquidation route;
- Base USDC;
- Base domain manifests/proof.

## Portfolio risk is P0

Required before production:

- per-instrument cap;
- issuer concentration;
- underlying concentration;
- sector stress;
- shared custody;
- correlation;
- market closed/unknown;
- liquidation depth.

## Agent layer

First production Sentinel:

**Safety Buffer**

Only risk-reducing unattended actions.

Do not launch risk-increasing autonomous trading with initial real capital.

## GTM

### Ecosystem

- Base Batches 004;
- Base Ecosystem Fund;
- Coinbase tokenized-stock team;
- relevant liquidity/lending venues;
- Chainlink;
- USDC/Circle;
- asset-management/portfolio builders.

### Distribution thesis

Usance should attach to assets users already hold.

No new wrapper token required.

### Partnership pitch

> Coinbase makes equities programmable. Usance makes them financeable under instrument-specific, recovery-aware risk.

## Business milestones

Pre-mainnet:

- Base Batches application;
- B20 adapter demo;
- canary asset research;
- portfolio risk reference model;
- lender design partners.

Mainnet canary:

- low initial cap;
- one lender cohort;
- 1–3 assets;
- live liquidation depth;
- audited code;
- public proof dashboard.

Expansion:

- more equities;
- concentrated-position facilities;
- portfolio substitution;
- personal baskets;
- issuer/product integrations;
- institutional facility customers.

## Base Batches application truth

Pitch the company, not a hackathon.

Show:

- X Layer as proof that the core has already been built/tested;
- Base as default production market;
- ETHOnline as a genuine institutional collateral module;
- clear 12–18 month company path.

Do not tell Base that X Layer is the canonical chain.

---

<!-- SECURITY_AND_THREAT_MODEL.md -->

# SECURITY_AND_THREAT_MODEL.md

## 1. Security objective

A wrong external observation, compromised AI provider, compromised Sentinel runtime, stale indexer, venue outage or authority-provider failure must not be able to create unauthorized capital movement.

## 2. Trust hierarchy

### Financial authority

1. market-domain contracts;
2. versioned protocol policy;
3. owner/institutional authorization;
4. settlement/reconciliation proof.

### Information providers

Evidence, 0G, ChainGPT, Chainlink market inputs, ENS metadata and external APIs are inputs with bounded trust.

No information provider gets arbitrary money authority.

## 3. Cross-domain threats

### Split-brain facility

Attack: two domains each believe they own debt/collateral.

Defense: immutable `homeDomain`; one canonical facility controller.

### Duplicate collateral

Attack: same asset recognized on multiple facilities/domains.

Defense: local custody/lock proof; no remote credit without explicit source lock protocol; cross-domain remote collateral deferred.

### Reorg/finality mismatch

Defense: domain-specific finality in indexer; no global “confirmed” state until home domain confirms.

## 4. Instrument threats

### Ticker confusion

Attack: malicious/incorrect token with same ticker.

Defense: exact InstrumentId; official issuer-address provenance.

### Corporate-action drift

Attack: internal ledger becomes inconsistent after multiplier/rebase.

Defense: adapter-specific accounting and activation-window tests.

### Issuer/legal change

Defense: Passport supersession; weak/missing evidence restricts.

## 5. Portfolio threats

- concentration hidden by multiple wrappers;
- same underlying via different issuers;
- same custodian correlation;
- correlated gap risk;
- market-closed liquidity.

Defense: underlying/issuer/custody dimensions are separate risk keys.

## 6. Facility substitution threats

Critical invariant:

> Old collateral cannot be released before replacement is committed and all conditions are fresh.

Attack matrix:

- replay;
- duplicate request;
- policy result for wrong facility;
- stale policy result;
- revoked authority;
- paused/frozen replacement;
- transfer failure;
- insufficient replacement;
- concurrent substitutions;
- crash between steps;
- partial external operation.

All result in old collateral remaining secured unless the replacement is already committed.

## 7. ENSv2 threats

- stale resolver;
- delegated role revoked after caching;
- non-canonical registry;
- beta interface change;
- parent hierarchy change.

Defense:

- fresh canonical hierarchy read for sensitive operation;
- block/pointer recorded in receipt;
- adapter version/capability probe;
- unavailable ENS blocks new authority-sensitive operation, not safety exits.

## 8. Privy threats

- compromised signer;
- insufficient quorum;
- policy mismatch;
- replay;
- service outage.

Defense:

- Privy control is only one part of the operation;
- facility policy/contract still validates exact operation;
- no arbitrary signing endpoint;
- no silent fallback.

## 9. Chainlink CRE threats

- stale confidential decision;
- replay against another facility;
- policy version mismatch;
- workflow/provider outage;
- leaked private policy.

Defense:

Decision binds:

- facility id;
- replacement InstrumentId;
- facility snapshot/risk epoch;
- policy commitment/version;
- expiry;
- nonce/request id.

No fresh valid decision → no substitution.

## 10. 0G threats

### Prompt injection

Strict extraction schema + quote grounding + no financial tools.

### False verification claim

UI distinguishes:

- provider attestation;
- response integrity;
- document integrity;
- claim corroboration;
- Passport admission.

None implies the others.

### Same-provider false independence

Corroboration uses actual underlying provider/model route group.

### Storage substitution

Retrieved bytes hashed locally.

Mismatch → fail.

## 11. Circle/CCTP threats

- transport replay;
- incorrect destination;
- cash arrives but facility state not updated;
- cross-domain message mistaken for facility settlement.

Defense:

CCTP receipt is transport proof only.

Facility accounting changes only on home domain through its controller.

## 12. Venue threats

- quote expires;
- partial fill;
- duplicate fill;
- venue lies;
- timeout;
- insufficient exit;
- interface/API identity confusion.

Reuse IntentBook:

`EXECUTION_UNKNOWN` releases nothing.

## 13. Sentinel threats

Preserve existing Sentinel security invariant:

> A compromised Sentinel is at worst a hostile delegated agent.

No new financial verbs.

Production signer via managed signer/KMS/HSM-style interface.

## 14. Governance threats

Risk increases require delayed governance.

Guardian may restrict.

Admission/Risk roles are separate.

Mainnet role owner must not be a single developer hot key.

## 15. Mainnet threat gates

Before real capital:

- external review;
- no unresolved high/critical;
- mainnet rehearsal;
- withdrawal test;
- liquidation test;
- oracle outage drill;
- issuer/corporate-action drill;
- key compromise drill;
- stale-indexer drill;
- facility substitution negative campaign;
- canary caps.

---

<!-- EVIDENCE_AND_MEASUREMENT_PLAN.md -->

# EVIDENCE_AND_MEASUREMENT_PLAN.md

## 1. Principle

Every important displayed number and public claim should trace to:

- authoritative chain state;
- generated projection with provenance;
- immutable evidence;
- or an explicit external source.

No screenshot-only truth.

## 2. Claim ledger

Each claim:

```json
{
  "claimId": "...",
  "claim": "...",
  "level": "LIVE_TESTNET",
  "domain": "xlayer",
  "artifact": "...",
  "deploymentDigest": "...",
  "inputs": [],
  "limitations": []
}
```

No claim is promoted by editing prose.

## 3. Artifact freshness

Every generated artifact has:

- input digests;
- generator version;
- deployment digest;
- source block/range;
- schema version.

Consumer rejects stale artifact.

## 4. Product metrics

### Capital

- recognized collateral;
- financed notional;
- originations;
- repayments;
- active facilities;
- capital velocity;
- utilization.

### Risk

- binding constraint frequency;
- Passport conflicts;
- RiskEpoch changes;
- NO_NEW_RISK / MARGIN_CALL duration;
- liquidation recovery;
- bad debt.

### Liquidity

- executable exit coverage;
- slippage by notional;
- withdrawal queue;
- lender utilization;
- recovery route success.

### Operations

- p50/p95/p99 API latency;
- indexer lag;
- RPC disagreement;
- reconciliation latency;
- unknown-execution backlog;
- external-provider uptime;
- Sentinel stuck runs.

### Ecosystem

Per domain:

- attributed users;
- attributed writes;
- financing cycles;
- DEX/venue activity genuinely caused by facilities;
- issuer assets admitted;
- repeat borrowers.

## 5. Capital velocity

Preferred metric:

```text
CapitalVelocity
=
(settled financing + financed execution volume)
/
average recognized collateral
```

This is not a reward for circular volume.

Exclude:

- self-trades;
- wash transactions;
- duplicate retries;
- failed/unknown execution until reconciled;
- purely internal accounting events.

## 6. ETHOnline proof plan

### Positive

Treasury A pledged → Treasury B approved/committed → Treasury A released → facility remains active.

### Negative

Treasury C rejected → old collateral untouched.

### Boundary

Replacement exactly at minimum coverage.

### Stale

expired CRE decision rejected.

### Authority

revoked ENS role or missing Privy quorum rejected.

### Failure

ATS transfer failure leaves old collateral.

### Sponsor removal

Run with each sponsor path deliberately absent and show exact lost guarantee.

## 7. Base mainnet proof plan

Before public capital:

- official B20 contract provenance;
- Passport;
- corporate-action fixture;
- portfolio risk;
- lender deposit;
- borrower deposit;
- USDC borrow;
- repayment;
- withdrawal;
- liquidation rehearsal;
- Sentinel risk-reduction action;
- public receipt.

## 8. X Layer proof plan

- exact xStock admission;
- multiplier accounting;
- native USDC financing;
- Builder Code attribution;
- OKX route proof where available;
- Sentinel/intent reconciliation;
- current deployment/bytecode proof.

## 9. 0G provenance UX

Show separately:

- **Evidence integrity:** exact source bytes/hash.
- **Inference provider:** provider/model.
- **Verification mode:** TeeML / TeeTLS / none.
- **Provider attestation:** status.
- **Response integrity:** status.
- **Claim corroboration:** single-source/corroborated/conflict.
- **Financial effect:** informational only / resulted in Passport proposal / deterministic policy consequence.

Never label the whole card “verified AI.”

## 10. Repeated evidence campaign

For any load-bearing mechanism, run:

- deterministic seed;
- ≥ repeated positive/negative cases;
- mutation/ablation;
- live external call where required;
- stored raw responses;
- a failed external call;
- clean-room replay.

## 11. Launch dashboard

Public `/status` should eventually display:

- current domains;
- current deployment hashes;
- oracle/session freshness;
- indexer lag;
- evidence provider status;
- current incidents;
- proof ledger counts.

Do not show fake uptime history before it exists.

---

<!-- UI_UX_INFORMATION_ARCHITECTURE.md -->

# UI_UX_INFORMATION_ARCHITECTURE.md

## 1. UX principle

Usance is one product with role-specific workspaces.

Do not make a capital user navigate an institutional repo terminal.

Do not make an institution use a consumer “borrow” card for a multi-party facility.

## 2. Public navigation

Top level:

- Assets
- Capital
- Collateral
- Sentinels
- Earn
- Developers
- Status

Primary CTA: **Open Usance**

Landing headline:

> **Make tokenized assets usable as capital.**

Subhead:

> Understand what an asset represents, see what it can safely support, and use it across credit, collateral and automated capital operations.

Do not lead with chain logos.

## 3. Public asset page

`/assets/[instrumentId]`

Always distinguish:

- instrument name;
- issuer;
- network/domain;
- underlying reference;
- rights;
- custody/backing;
- income/corporate actions;
- redemption;
- eligibility;
- market state;
- usable capital capabilities.

If two tokens reference Apple, they must appear as two instruments, not one merged “AAPL” row.

Advanced panel:

- Passport version;
- evidence root;
- RiskEpoch;
- oracle route;
- liquidity route;
- adapter versions.

## 4. Capital workspace

Routes:

- `/app`
- `/app/assets/[instrumentId]`
- `/app/collateral/add`
- `/app/borrow`
- `/app/repay`
- `/app/withdraw`
- `/app/positions`
- `/app/activity`
- `/app/activity/[receiptId]`
- `/app/alerts`
- `/app/mandates`
- `/app/sentinels`
- `/app/settings`

Dashboard answers:

1. What do I own?
2. How much is usable?
3. What do I owe?
4. What currently binds capacity?
5. What requires action?

Use plain terms first:

- Market value
- Usable collateral
- Available credit
- Debt
- Safety buffer

RiskEpoch is advanced detail, not the headline.

## 5. Institutional workspace

New namespace:

- `/institutional`
- `/institutional/facilities`
- `/institutional/facilities/new`
- `/institutional/facilities/[facilityId]`
- `/institutional/facilities/[facilityId]/collateral`
- `/institutional/facilities/[facilityId]/substitute`
- `/institutional/approvals`
- `/institutional/settlements`
- `/institutional/assets`
- `/institutional/policies`
- `/institutional/counterparties`

### Facility detail

Show:

- status;
- home domain;
- borrower;
- lender;
- settlement asset;
- principal/debt;
- collateral;
- coverage;
- next permitted action;
- current approval/policy requirements;
- settlement history.

Hero action when eligible:

**Replace collateral**

Not “Execute substitution transaction.”

## 6. Collateral substitution UX

Step 1 — Current facility

“Your financing stays open during an eligible replacement.”

Step 2 — Choose replacement

Display exact instrument identity, not ticker only.

Step 3 — Checks

- public authority;
- organizational approval;
- lender policy;
- asset eligibility;
- coverage;
- transfer state.

Step 4 — Review

Explicit:

- what enters;
- what leaves;
- coverage before/after;
- fees;
- what can fail;
- what happens if it fails.

Step 5 — Settlement timeline

`Replacement committed` must visibly precede `Old collateral released`.

## 7. Authority UX

### ENS

Display:

- institution name;
- role;
- expiry;
- namespace;
- “public authority checked at block …”

### Privy

Display:

- organization wallet;
- quorum status;
- approval progress.

Never conflate ENS role with wallet signature.

## 8. Confidential policy UX

Do not show private rules.

Show:

- policy version/commitment;
- decision;
- expiry;
- public reason class;
- confidential-compute proof status if available.

Copy:

> Lender policy accepted this replacement.

or

> Replacement does not satisfy the current lender policy. Existing collateral remains unchanged.

## 9. 0G provenance UX

On evidence/Ask Usance:

- model/provider;
- inference route;
- TeeML/TeeTLS/no attestation;
- inputs;
- source quotes;
- uncertainty;
- financial boundary.

Example:

> 0G TeeTLS proves this response was routed through the expected provider path. It does not prove the issuer statement is true. Usance still checks the source, corroboration and deterministic policy separately.

## 10. Sentinels UX

Keep current “alive but not theater” principle.

Show:

- ARMED/PAUSED/BLOCKED;
- exact goal;
- mandate;
- budget;
- trigger;
- last run;
- next check;
- receipt.

No glowing AI orb.

## 11. Domain presentation

Domain/network matters but is secondary to instrument and facility.

Show a small badge:

`Base` / `X Layer` / `Hedera`

Do not present chain switching as the product.

When a user starts a facility, the home domain is explicit and cannot silently change.

## 12. Errors/recovery

Every blocked action says:

- what is blocked;
- why;
- whether funds are safe;
- what the user can do;
- whether retry is safe.

Never generic “Transaction failed.”

## 13. Mobile

Mobile prioritizes:

- review;
- approve;
- repay;
- add collateral;
- Sentinel pause/revoke;
- facility substitution approval;
- proof inspection.

Complex portfolio/facility creation may use full-screen workspace.

## 14. Copy lock

Preferred:

- “Usable collateral”
- “Available credit”
- “Replace collateral”
- “Existing collateral stays locked”
- “Authority expired”
- “Lender policy rejected this replacement”
- “Market is closed; new risk is restricted”
- “AI analysis informed the Passport proposal; policy controls the limit”

Avoid:

- “AI-powered RWA verification”
- “universal stock”
- “execute”
- “smart collateral”
- “omnichain loan”
- “verified by AI”

---

<!-- DECISIONS.md -->

# DECISIONS.md

## D-100 — Usance becomes multi-domain

**Decision:** one company/protocol, chain-native market domains.

**Supersedes:** X Layer as company-wide canonical settlement domain.

## D-101 — Base is default public production network

Reason: Base-first accelerator requirement + native Coinbase tokenized-stock market + explicit credit/agent builder demand.

This is default deployment, not exclusivity.

## D-102 — X Layer remains a first-class xStocks/OKX domain

Do not demote it to “old hackathon testnet.”

Its product delta is xStocks finance + OKX execution/distribution.

## D-103 — Hedera is issuer/lifecycle domain

ATS is used where the asset lifecycle itself matters, especially Usance Collateral.

## D-104 — One facility, one authoritative domain

No mutable cross-chain debt state.

## D-105 — Instrument identity is not underlying ticker

`InstrumentIdentity` and `UnderlyingReference` are separate.

## D-106 — Existing ClearingHouse is closed

No institutional/chain/scheduler feature creep into the near-EIP-170 core.

## D-107 — Add facility implementations, not one mega-contract

Existing ClearingHouse = revolving credit facility implementation.

Institutional repo/substitution gets separate controller/module.

## D-108 — Portfolio risk promoted to pre-mainnet

Concentration/correlation can no longer remain P2 for Base stock credit.

## D-109 — Corporate-action accounting is adapter-specific

B20 and xStocks may both use multiplier concepts but are not assumed identical.

## D-110 — Oracle product is per-domain/per-instrument

No global “Usance uses Data Feeds” or “Usance uses Data Streams.”

## D-111 — Native USDC/CCTP on X Layer is now current

Supersedes old “CCTP unavailable on X Layer” planning.

CCTP remains cash transport, not facility authority.

## D-112 — ENSv2 is an overlay, not settlement

Public institution/facility identity + delegation + discovery.

Beta interfaces isolated behind adapter.

## D-113 — Privy is control/signing, not automatically legal custody

Use exact product/configuration language.

## D-114 — Chainlink CRE confidential policy stays planned but qualification is unresolved

The current ETHOnline page says qualification requirements are coming soon.

Do not freeze an old handler/API as competition truth.

## D-115 — 0G becomes provider-specific auditable intelligence

Use actual TeeML/TeeTLS/attestation semantics.

Do not call outputs “verified truth.”

## D-116 — Evidence intelligence remains multi-provider

0G does not require deleting ChainGPT/deterministic paths.

## D-117 — No forced asset bridging

Usance comes to the asset.

Remote collateral remains an edge capability, not the default architecture.

## D-118 — Competition modules cannot redefine the company

Base, ETHOnline and OKX work live in competition overlays with baseline/diff/proof.

## D-119 — Mainnet is a canary market process

No “support all RWAs” launch.

## D-120 — Mainnet readiness has three gates

Technical, economic, institutional.

Usance currently passes neither all three nor claims that it does.

## D-121 — Public promise remains outcome-first

“Make tokenized assets usable as capital.”

“Capital operating system” is the category/company frame, not the only landing copy.

---

<!-- IMPLEMENTATION_ORDER.md -->

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

---

<!-- BUILD_CONTRACT.md -->

# BUILD_CONTRACT.md

## Purpose

This file governs Claude/Codex implementation after Product Lock approval.

**Do not implement from old PRDs without first reconciling them against this Product Lock.**

## 1. First action in every implementation session

Run:

```bash
git status --short
git rev-parse HEAD
git log --oneline -20
```

Then load:

- `PRODUCT_LOCK.md`;
- `USANCE_MASTER_PRD.md`;
- `ARCHITECTURE.md`;
- `SECURITY_AND_THREAT_MODEL.md`;
- `MIGRATION_PLAN.md`;
- current specs/invariants;
- current checklist/proof ledger.

If code disagrees with documents, record the conflict before editing.

## 2. Task ledger

Before code, generate a dependency-ordered checklist with small checkboxes.

A task is complete only when:

- code exists;
- test exists;
- user/operator path exists where required;
- failure state exists;
- proof/docs updated where required.

No “feature complete” by file existence.

## 3. Constitutional rules

Never trade away:

1. one facility = one authoritative domain;
2. instrument identity != ticker;
3. AI has no financial authority;
4. `ProtocolAllows ∧ MandateAllows`;
5. no agent collateral withdrawal;
6. missing evidence can only restrict;
7. stale epoch cannot authorize new risk;
8. unknown execution reconciles; no blind retry;
9. generated proof artifacts cannot be manually edited into currency;
10. emergency guardian restricts only;
11. external venues are adapters;
12. ClearingHouse does not receive new unrelated features.

## 4. Proof levels

Use only:

- `SPECIFIED`;
- `UNIT_TESTED`;
- `INTEGRATION_TESTED`;
- `LIVE_TESTNET`;
- `LIVE_MAINNET`;
- `EXTERNAL_INTEGRATION`;
- `BLOCKED_EXTERNAL`;
- `NOT_YET_PROVEN`.

Every public claim maps to `proof/claims.json`.

## 5. External integration policy

For every provider:

- pin exact docs/version;
- capability-probe;
- record network;
- record addresses;
- record access level;
- record proof;
- define timeout/failure;
- never silently fall back while retaining stronger claim.

## 6. Competition isolation

Competition-specific files may configure/demo an existing product module, but must not fork the protocol.

Each competition folder records:

- baseline commit;
- preexisting work;
- new work;
- eligible tracks;
- sponsor-critical path;
- deployment evidence;
- receipts;
- limitations;
- demo script.

## 7. Mainnet gate

No mainnet real-capital deployment until all launch-gate items in the Master PRD are PASS.

A deploy script must refuse mainnet when:

- test fixture asset;
- fake oracle;
- unverified settlement asset;
- missing caps;
- unsafe role ownership;
- unconfigured freshness;
- test signer;
- proof/drift mismatch.

## 8. Stop conditions

Stop and report rather than invent when:

- a sponsor capability does not exist;
- an address cannot be verified;
- a legal/economic asset property is unknown;
- a current contract cannot satisfy an invariant without redesign;
- a required production signer/capital source is unavailable.

Hard does not mean blocked.

---

<!-- OFFICIAL_SOURCE_REGISTER.md -->

# Usance Product Lock — Official Source Register

**Research freeze:** 2026-09-03  
**Purpose:** External-system facts used by the Product Lock. This is not a substitute for capability probes at build/deploy time.

## Source policy

1. Current repository state is implementation truth.
2. Official provider/protocol documentation is integration truth.
3. Program/competition pages are eligibility truth.
4. Blog/marketing pages may establish announced product availability, but exact contract addresses, APIs, privileges, limits and security properties still require technical documentation or a live probe.
5. No integration is marked production-ready merely because a provider says it exists.

## Base

- Base Request for Builders: Tokenized Stocks  
  https://blog.base.org/request-for-builders-tokenized-stocks
- Base: Stocks just got updated  
  https://blog.base.org/tokenized-stocks
- Base Stocks / issuer-address directory  
  https://www.base.org/stocks
- Base Batches 004  
  https://blog.base.org/introducing-base-batches-004  
  https://www.base.org/batches
- Base B20 / network upgrade material  
  https://chain.base.org/upgrades/

### Verified at research freeze

- Coinbase-issued tokenized stocks are live natively on Base as B20 assets and are restricted to eligible non-US users.
- Base explicitly calls out credit, stock lending, personalized indexes, productive-asset credit and agent-managed portfolios as builder opportunities.
- Base Batches 004 closes 2026-09-09; selected teams are offered a $100K Base Ecosystem Fund investment subject to diligence.
- The program is explicitly Base-first: a company may support multiple chains, but Base should be its default network.
- Aave, Morpho, Euler and other third-party venues already advertise stock lending/borrowing support on Base. Usance therefore cannot claim that stock-backed lending itself is novel.
- Exact Coinbase token contract addresses must be sourced from the official Base/Coinbase directory and pinned in generated admission manifests.

## X Layer / OKX

- X Layer  
  https://web3.okx.com/xlayer
- Exchange OS announcement  
  https://web3.okx.com/learn/exchange-os
- Current xStocks activity / xPoints article  
  https://web3.okx.com/learn/earn-xpoints-xlayer
- OKX Dev Day 2026 program material supplied by the founder in the Product Lock source set.

### Verified at research freeze

- X Layer is an EVM L2 and describes Exchange OS as an architecture where EVM anchors assets/governance while TradeZone handles high-frequency execution.
- Exchange OS rollout is staged. Usance must keep any unavailable market-deployer access behind `ACCESS_REQUIRED`.
- xStocks are live on X Layer and OKX Wallet is actively distributing/incentivizing eligible holding/liquidity activity.
- OKX Dev Day applications close 2026-09-11; the online build period is 2026-09-17 to 2026-09-25; the Singapore finale is 2026-10-06.
- The primary Usance track should remain **X Layer: Tokenized stocks and RWA**.
- Native USDC and Circle CCTP are now live on X Layer, correcting older Usance assumptions that CCTP was unavailable there.

## xStocks

- Product legal overview  
  https://docs.xstocks.fi/docs/product-legal-overview
- How xStocks work  
  https://docs.xstocks.fi/docs/how-xstocks-work
- Dividends and stock splits  
  https://docs.xstocks.fi/docs/dividends-and-stock-splits

### Verified at research freeze

- xStocks are not ordinary shareholder-equity tokens; they are issuer-defined tokenized instruments whose legal/economic rights must be represented exactly rather than inferred from ticker.
- Corporate actions use a multiplier/rebasing mechanism. On EVM networks `balanceOf()` reflects the adjusted balance.
- Protocols are advised to account for multiplier activations and pause-sensitive windows.
- This makes rebase/corporate-action accounting a **pre-mainnet gate** for any xStock held by Usance.

## ETHOnline 2026

- Event prize page  
  https://ethglobal.com/events/ethonline2026/prizes
- ENS prize page  
  https://ethglobal.com/events/ethonline2026/prizes/ens

### Verified at research freeze

- Current sponsor set includes Hedera, ENS, Privy and Chainlink.
- Privy's B2B Financial Product requirements already name organization wallets, policies, signers, quorums and intents as qualifying control primitives.
- ENSv2 beta is on Sepolia and is the current target for the ENSv2 prize.
- Chainlink's **Best Confidential Workflow** exists, but its exact qualification requirements currently say **Coming soon**. Older Usance planning that treated a particular TEE handler function as an already-final qualification rule is not authoritative.
- Before ETHOnline implementation begins, freeze the actual git baseline and re-read the prize page.

## ENSv2

- Overview  
  https://docs.ens.domains/ensv2/overview/
- Enhanced Access Control  
  https://docs.ens.domains/ensv2/enhanced-access-control/
- Universal Resolver V2  
  https://docs.ens.domains/ensv2/universal-resolver-v2/
- App-developer guide  
  https://docs.ens.domains/ensv2/tutorial-app-developers/

### Verified at research freeze

- ENSv2 is deployed on Sepolia for testing.
- Enhanced Access Control supports resource-scoped roles and root roles.
- Universal Resolver V2 traverses hierarchical registries and exposes canonical-hierarchy discovery functions.
- ENSv2 contracts/interfaces are explicitly not final and may change before mainnet.
- Usance must therefore version-pin/capability-probe ENS writes and must not make irreversible core financial accounting depend on a beta interface.

## Privy

- Quorum approvals  
  https://docs.privy.io/controls/common-use-cases/quorum-approval
- Privy documentation root  
  https://docs.privy.io/

### Verified at research freeze

- Privy supports key quorums and its TEE infrastructure enforces the configured threshold for wallet actions.
- For Usance, Privy is an **institutional wallet-control and signing plane**. Do not describe it generically as the legal custodian of an institution's assets unless a specific custodial configuration and agreement establish that.

## Chainlink

- Developer docs  
  https://docs.chain.link/
- ETHOnline prize page  
  https://ethglobal.com/events/ethonline2026/prizes
- U.S. equities Data Streams overview  
  https://chain.link/blog/chainlink-data-streams-us-equities-etfs

### Verified at research freeze

- CRE is Chainlink's current workflow/orchestration direction; ETHGlobal explicitly tells builders to use CRE rather than deprecated Functions/Automation for those workflow needs.
- Data Feeds and Data Streams are different products and both may be relevant to Usance.
- Do **not** make “Data Streams” or “Data Feeds” a global architectural constant. The `OracleProvider` is resolved per domain, instrument and environment.
- Chainlink has publicly stated that OKX/X Layer adopted Chainlink infrastructure for RWA applications, while Usance's earlier testnet work found Data Feeds available in the specific environment it inspected.
- Production launch requires exact feed/stream identifiers, freshness semantics, market-session handling and fail-closed behavior per asset.

## Hedera / ATS

- Asset Tokenization Studio  
  https://docs.hedera.com/solutions/tokenization/ats
- ETHOnline sponsor requirements  
  https://ethglobal.com/events/ethonline2026/prizes

### Verified at research freeze

- ATS is Hedera's open-source digital-security tokenization stack and uses ERC-1400-family concepts, role controls, approval/block lists, pause/lock/snapshot mechanisms and asset lifecycle modules.
- ETHOnline's Hedera track explicitly values real asset lifecycle operations, not a static minted token.
- Usance's ETHOnline path should use ATS-issued testnet assets in a consequential collateral lifecycle.

## 0G

- Documentation  
  https://docs.0g.ai/
- Compute inference  
  https://docs.0g.ai/developer-hub/building-on-0g/compute-network/inference
- Storage SDK  
  https://docs.0g.ai/developer-hub/building-on-0g/storage/sdk

### Verified at research freeze

- 0G currently exposes Router and Direct inference paths.
- Direct mode uses provider sub-accounts and signed requests; provider/model catalog and pricing are dynamic.
- Current documented TEE modes include `TeeML` and `TeeTLS`; they prove different things.
- `TeeML`: model/computation are run inside a TEE and responses are TEE-signed.
- `TeeTLS`: a TEE broker proves authenticated routing to a centralized provider and binds request/response hashes; this does **not** prove the model's answer is true.
- `verifyService()` automates signer/compose-hash checks but the docs explicitly state this is not full provider verification; additional manual attestation/image checks are required.
- Direct inference currently requires funding the 0G ledger and provider sub-accounts; the docs specify minimum funding requirements.
- 0G Storage can be an integrity-bound archive. A storage root proves bytes/commitment, not legal truth.

## Circle / USDC

- CCTP docs  
  https://developers.circle.com/cctp
- X Layer launch  
  https://www.circle.com/blog/now-available-native-usdc-cctp-on-x-layer

### Verified at research freeze

- CCTP is native burn-and-mint transport for USDC and supported assets.
- Base supports CCTP.
- **X Layer now supports native USDC and CCTP**, announced 2026-08-06. This supersedes older Usance notes that treated CCTP on X Layer as unavailable.
- Hedera CCTP support is not assumed. The `CashTransport` adapter remains domain-specific.

## Re-verification rule

Every one of the following must be re-probed at implementation/deployment time:

- exact contract addresses;
- SDK/API versions;
- chain IDs and domains;
- feed/stream IDs and heartbeat/session semantics;
- issuer asset addresses;
- transfer/compliance behavior;
- current venue liquidity;
- sponsor eligibility requirements;
- staged-access products such as Exchange OS;
- TEE/provider attestations;
- CCTP testnet/mainnet availability.

A website announcement is evidence that a product exists. It is not permission to hard-code a production dependency.

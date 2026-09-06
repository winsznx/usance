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

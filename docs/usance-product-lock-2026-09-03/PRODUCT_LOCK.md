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

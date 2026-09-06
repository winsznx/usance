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

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

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

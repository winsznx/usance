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

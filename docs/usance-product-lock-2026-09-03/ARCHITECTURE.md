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

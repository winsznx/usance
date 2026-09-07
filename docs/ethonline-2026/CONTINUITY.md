# ETHOnline 2026 — continuity / baseline vs. new work

ETHOnline 2026 runs **2026-09-04 → 2026-09-16**. Usance is a continuation project: the protocol
was live on X Layer testnet (chain 1952) months before the event, deployed **2026-08-18**
(`deployments/1952.json`, 16 contracts). This file separates pre-existing work from work done
during the event, per the ETHOnline continuity rules ("Public GitHub repository clearly separating
pre-existing work from new work").

## Baseline

| Marker | Commit | Date | Meaning |
|---|---|---|---|
| Pre-competition baseline | `85f1530` | 2026-08-23 | Last commit before the Product Lock / multi-domain architecture work. Everything at or before this is unambiguously pre-existing. |
| X Layer deployment | (deployed) | 2026-08-18 | 16 contracts live on chain 1952 at commit `cf08fa1` (14 core) + `a3d89fe` (2 Sentinel registries). Not redeployed since. |

## Pre-existing components (not new work)

- The deployed X Layer revolving-credit protocol: `Authority`, `AssetRegistry`, `EvidenceRegistry`,
  `PassportRegistry`, `RiskPolicyRegistry`, `ChainlinkFeedAdapter`, `CollateralVault`,
  `LiquidityVault`, `FinancingEngine`, `ClearingHouse`, `FeeController`, `MandateRegistry`,
  `DelegationGateway`, `IntentBook`, `SentinelTemplateRegistry`, `SentinelInstanceRegistry`.
- `RiskMath` and the differential-conformance discipline (Solidity ↔ Rust ↔ TS ↔ Python).
- The evidence / Passport / receipt machinery.
- The web app, the indexer, the Sentinels autonomy plane.

## Work done during the event (2026-09-06 onward)

All of this is inside the competition window. It is architecture and infrastructure, **not**
sponsor-specific until Phase 07.

| Phase | Commit range | What |
|---|---|---|
| 00–01 identity | `71aab89` … `05e5fad` | Product Lock, instrument-identity model + schemas + binding artifact |
| 02 facility model | `088b597` … `27c5e31` | domain / facility schemas, descriptor artifact, read models |
| 03 corporate actions | `a1b4e61` … `1dd5aca` | provider-neutral corporate-action reference model |
| 04 portfolio risk | `a7aa97d` … `c24104f` | provider-neutral portfolio-risk reference model |
| 05 core completion | `07d03d9` … `38074c7` | proof-ledger reconciliation, LP journey, mandate controls, `/app/assets/[assetId]`, e2e triage, explorer verification package |
| **06 institutional core** | `9eb2732` … `4f76259` | **`InstitutionalFacility` + `FacilityValuation` + `ICollateralAdapter` / `IAuthorityVerifier` / `IPolicyVerifier` + `FacilityMath`.** Provider-neutral. Nothing deployed. This is the generic mechanism Phase 07's sponsors plug into. |

## Phase 07 — sponsor work (new, this event)

Commits after `38074c7`. Tracked per sponsor:

| Sponsor | Commit range | Deployment addresses | Proof |
|---|---|---|---|
| Local adapters + lifecycle (all four) | `38074c7` … `be929d6` | none (local, deterministic doubles) | `contracts/test/institutional/EthOnlineLifecycle.t.sol` (13 tests) |
| **Hedera ATS (live)** | `be929d6` … `dfac015` | ATS securities A `0.0.10406896`, B `0.0.10406931`, C `0.0.10406957` (v8 factory `0.0.9213391`) | `docs/ethonline-2026/proof/hedera-ats-issuance.json` |
| **Institutional facility on Hedera (live)** | `be929d6` … `dfac015` | `InstitutionalFacility 0x6B0A0c10450E11C86e7b6b9A69068e43B28Ef8B7` (+ full risk stack, `docs/ethonline-2026/HEDERA_LIFECYCLE.md`) | `docs/ethonline-2026/proof/hedera-facility-deployment.json` |
| **Live A→B / A→C substitution** | `dfac015` | facilityId `0x6534fdf6…` | `docs/ethonline-2026/proof/hedera-substitution-{positive,negative}.json` |
| **ENSv2 (live)** | `dfac015` … | name `usance-institutional.eth` on ENSv2 `ETHRegistry` Sepolia `0xbdc85dd5b15d7ecb354cd7cb6f2c50b4f2c4f0e2`; EAC `ROLE_SET_SUBREGISTRY|ROLE_SET_RESOLVER` granted to `0x06622c6a…04C1` and revoked (`docs/ethonline-2026/ENS_AUTHORITY.md`) | `docs/ethonline-2026/proof/ensv2-authority.json`, `ens-authority-lifecycle.json` |
| Privy (live) | _(pending — needs PRIVY_APP_ID/SECRET)_ | _(pending)_ | `docs/ethonline-2026/proof/privy-*` |
| Chainlink CRE (simulation) | _(pending — needs CRE CLI)_ | _(CRE workflow id)_ | `docs/ethonline-2026/proof/cre-*` |

The local adapters implement the frozen Phase 06 interfaces against deterministic doubles that
model each sponsor's real semantics (`HederaAtsCollateralAdapter` over the exact ATS `IHold`
surface, foundry keys for the Privy / CRE signers, `MockAtsSecurityToken`). The live testnet
lifecycle follows once the `TESTNET_RESOURCE_PLAN.md` resources are supplied.

## Prize eligibility notes

- **Hedera ATS $6,000** and **ENS $4,500** and **Privy $2,500** and **Chainlink $2,000** are
  "start fresh"-style tracks whose requirements are satisfied by new Phase 07 work regardless of
  the pre-existing base; the demo video for each covers only the new sponsor work.
- **ENS Continuity $500** and **Chainlink Continuity $500** explicitly reward integrating the
  sponsor into an *existing* project — Usance is exactly that shape. Eligibility for either is
  verified against the exact rule text before the claim is made.
- Phase 00–06 work is **not** claimed as "created during the sponsor integration". It is disclosed
  here as event-window architecture that is not sponsor-specific.

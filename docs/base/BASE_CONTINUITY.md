# BASE_CONTINUITY.md

Base evidence overlay. Usance is a company, not a Base Batches demo; this file keeps the Base-
specific work cleanly separable from everything else (§34). Hedera / ENS / Privy / CRE work is
**not** Base work.

## Pre-Base baseline

| Marker | Commit | Meaning |
|---|---|---|
| Pre-Base baseline | `e064e69` | Last commit before Phase 08. Everything at or before is not Base-domain work. |
| Product Lock / multi-domain architecture start | `85f1530` (2026-08-23) | pre-existing; see `docs/ethonline-2026/CONTINUITY.md` |
| Deployed X Layer core | chain 1952, commit `cf08fa1` + `a3d89fe` | untouched by Phase 08 |

## Existing Usance capabilities Phase 08 builds on (not new Base work)

- The identity model (`spec/identity-model.md`), corporate-action accounting reference
  (`spec/corporate-action-model.md`, Phase 03), and portfolio-risk reference
  (`spec/portfolio-risk-model.md` + `packages/portfolio-risk`, Phase 04).
- `RiskMath.sol` single-instrument valuation and the differential-conformance discipline.
- The evidence / Passport / receipt machinery and `services/evidence`.
- The institutional facility pattern from Phase 06 (`ICollateralAdapter`, decision binding) — the
  Base facility does not inherit `InstitutionalFacility` but reuses its structural discipline.

## New Base work (this phase)

| Area | Artifact | Status |
|---|---|---|
| Capability re-verification | `docs/base/BASE_CAPABILITY_MATRIX.md` | done |
| Real B20 canary ranking | `docs/base/BASE_CANARY_CANDIDATES.md` | done |
| Mainnet read-only characterization | `packages/base/src/mainnet/characterize.mjs` → `docs/base/proof/mainnet-b20-characterization.json` | done — `MAINNET_READ_ONLY`, 13 instruments, block 51029745 |
| Facility reuse analysis | `spec/base-portfolio-facility-model.md §1` | done — new facility (`PORTFOLIO_REVOLVING_CREDIT`) |
| B20 accounting/custody adapter | `contracts/src/base/BaseB20InstrumentAdapter.sol` | done — Beryl `multiplier()` + Cobalt selector probe |
| Scaled custody vault | `contracts/src/base/ScaledCollateralVault.sol` | done — raw nominal ledger, measured delta, surplus (I-109) |
| Portfolio risk engine (Solidity, = TS reference wei-for-wei) | `contracts/src/base/PortfolioRiskEngine.sol` + `PortfolioRiskPolicyRegistry.sol` | done — I-116 conformance green over 14 fixtures |
| Base portfolio-credit facility | `contracts/src/base/PortfolioRevolvingCredit.sol` | done — 17.2 KB, single `_draw` path (I-110), quoted-snapshot draw (I-115) |
| Oracle / liquidity / session adapters | `contracts/src/base/adapters/OracleAdapters.sol` | done — Chainlink Total-Return + TEST_ONLY + session + liquidity observer |
| Tests | `contracts/test/base/{PortfolioRiskConformance,BasePortfolioLifecycle,B20Compat}.t.sol` | 26 pass; full suite 322 pass; `make test-differential` green |
| Native USDC settlement | facility `settlementToken` = `0x036CbD53842c5426634e7929541eC2318f3dCF7e` (Sepolia) / `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` (mainnet), 6dp | wired in the facility Terms |
| Base Sepolia deployment | `packages/base/src/sepolia/deploy-and-run.mjs` (resumable) | **written, BLOCKED on the resource plan — needs `BASE_SEPOLIA_DEPLOYER_KEY` / `BASE_SEPOLIA_RPC_URL` + ~0.10 ETH, then native test USDC** |
| B20 proof + portfolio credit proof | `docs/base/proof/base-sepolia-lifecycle.json` | _pending the deployment_ |
| Limitations | Phase 08 report + `BASE_CONTINUITY.md` limitations section | this file |

## Base contracts / adapters (addresses filled at deployment)

_pending Base Sepolia deployment._

## Base Sepolia deployment

_pending._

## Limitations (carried into the Phase 08 report)

- The live financial lifecycle uses `SYNTHETIC_TEST_B20` instruments, not real Coinbase stocks —
  Coinbase issues only on Base Mainnet and there are no authoritative testnet versions.
- The Sepolia oracle is `TEST_ONLY` — there are no Chainlink tokenized-equity feeds on Base
  Sepolia. The mainnet canary route uses the real Chainlink Total-Return Data Feed.
- Policy is `CANARY_PROVISIONAL` / `TESTNET_CALIBRATION`, never `PRODUCTION_VALIDATED`.
- No real Coinbase stock is deposited, no real USDC is borrowed, no mainnet write occurs (§43).
  Real-capital Base credit is Phase 13.

## Base thesis alignment (not a company pivot)

Base-specific product sentence: *"Usance lets organizations turn eligible tokenized-stock
portfolios into controlled working capital on Base."* The architecture stays multi-domain — Base
is the default public production domain, not the whole company. Hedera (institutional), X Layer
(Phase 09) and 0G (Phase 10) remain separate.

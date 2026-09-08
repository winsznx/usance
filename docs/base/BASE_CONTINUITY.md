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
| Base Sepolia deployment | `packages/base/src/sepolia/deploy-and-run.mjs` (resumable) | **done — live on Base Sepolia 84532** |
| B20 proof + portfolio credit proof | `docs/base/proof/base-sepolia-lifecycle.json` | done — `LIVE_TESTNET`, full lifecycle PASS |
| Mainnet read-only characterization | `docs/base/proof/mainnet-b20-characterization.json` | done — `MAINNET_READ_ONLY`, 13 real B20 stocks, block 51029745 |
| Limitations | Phase 08 report + limitations section below | this file |

## Base Sepolia deployment (chain 84532, deployer `0x4De408bD4DE481D11afb27aBcB47AEBc808897eb`)

| Contract | Address |
|---|---|
| `PortfolioRiskPolicyRegistry` | `0x70616061140c08b7De091FD9eD2a703eD23522E1` |
| `ScaledCollateralVault` | `0xd571fc8C6040703EE7E55BFf0D61dA07E0f92995` |
| `UsEquitySessionOracle` | `0x2Db18AafD92A5AD227337Ef11569E5900B1fdE3f` |
| `TestOnlyOracleAdapter` (**TEST_ONLY**) | `0x2ef87f3880B4d273a56CB0e8B4ab2cC42EF34DBf` |
| `StaticLiquidityObserver` | `0xc6AC5F6D14E6c6F8a3D9d40D591F7EF471Aa9E08` |
| `BaseB20InstrumentAdapter` (series A / B) | `0x5553519C0BBb2Fe795D9dFaD9A90dFeb1B27340c` / `0x6985C26bE1F995FBB7483b870058846857551e5d` |
| **`PortfolioRevolvingCredit`** | **`0x3cBDD73621e86B1D3EFc9622D0F540734841F0B4`** |

`SYNTHETIC_TEST_B20` instruments (issued through the real `0xB20f…` factory precompile, ASSET
variant): A `utALPHA` `0xB200000000000000000000AB44Feb0D995173a71`, B `utBETA`
`0xB2000000000000000000002636674033A60396e0`. Settlement: Base Sepolia native USDC
`0x036CbD53842c5426634e7929541eC2318f3dCF7e`.

**Live lifecycle** (`docs/base/proof/base-sepolia-lifecycle.json`, `result: PASS`):
activate → portfolio recognised **$810,000** (the ISSUER cap binds, both series share
`i-usance-test`), facility cap **$20**; draw 10 USDC → debt **$10.03** / fee **$0.03** (I-110);
force UNKNOWN session → recognised drops to **$486,000**, `allLive: false`, **new draw refused**
(I-111, I-113); repay in full → debt **$0**; withdraw half of series A safely.

## Base Mainnet read-only evidence (`MAINNET_READ_ONLY`, NO FINANCIAL ACTION)

`docs/base/proof/mainnet-b20-characterization.json`, block 51029745: 13 real Coinbase B20
tokenized stocks — `isB20` true, real names, decimals 8, `multiplier() = 1e18`, Chainlink
Total-Return Data Feeds live (8dp USD, `us_equities_24/5`). B20 read path confirmed
`BERYL_INSTANT_ONLY` on mainnet.

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

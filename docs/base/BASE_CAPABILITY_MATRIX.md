# BASE_CAPABILITY_MATRIX.md

Phase 08. Current-truth re-verification of Base / B20 / Circle / Chainlink, done before any code.
Probed 2026-09-08. Supersedes the 2026-09-03 Product Lock research where the network state moved.

Columns: capability · current implementation/version · Sepolia · Mainnet · official source · exact
address · trust boundary · test strategy · unknowns · production implication.

---

## 1. Base network / B20 standard

| Field | Value |
|---|---|
| Capability | B20 native token standard (ERC-20 superset, Rust precompiles) |
| Current version | **Beryl** (hardfork ordinal 01) |
| Sepolia | **Active** since 2026-06-18 |
| Mainnet | **Active** since 2026-06-25 |
| Official source | `docs.base.org/specifications/b20/*`, `docs.base.org/upgrades/beryl/b20`, base-std **v1.0.0** (`github.com/base/base-std/tree/v1.0.0`) |
| Exact addresses | B20 Factory `0xB20f000000000000000000000000000000000000`; ActivationRegistry `0x8453000000000000000000000000000000000001`; PolicyRegistry `0x8453000000000000000000000000000000000002` — identical on every network where B20 is active (mainnet, Sepolia, Vibenet, base-anvil) |
| Trust boundary | consensus-level precompile; selectors + behavior are part of the chain's consensus surface and "the standard grows by addition" (existing selectors/behavior do not change across hardforks) |
| Test strategy | `contracts/test/base/B20Compat.t.sol` — selector/capability probe rerun on every deploy and after any Base upgrade; forge tests against a `MockB20Asset` modelled on base-std's own mock |
| Unknowns | none load-bearing for the read path |
| Production implication | the adapter targets **Beryl**; a Cobalt activation triggers a re-probe (§2) |

### B20 ASSET variant — Beryl read surface the adapter uses

From base-std v1.0.0 `IB20Asset` / `IB20`:

| Method | Selector | Use |
|---|---|---|
| `multiplier() → uint256` | `0x1b3ed722` | current effective corporate-action factor, WAD (`1e18` = neutral). Applied **instantly** on `updateMultiplier`. |
| `WAD_PRECISION() → uint256` | `0x664808a8` | `1e18` |
| `balanceOf(address) → uint256` | ERC-20 | **raw** units — never rewritten by a corporate action (I-B01) |
| `scaledBalanceOf(address) → uint256` | `0x1da24f3e` | `raw × multiplier / WAD` |
| `toScaledBalance` / `toRawBalance` | `0x04f04c99` / `0x0ca06c44` | conversions (integer division, not exactly reversible) |
| `decimals() → uint8` | ERC-20 | 6–18, immutable post-creation |
| `isPaused(PausableFeature) → bool` | `0x165c44bc` | token-level pause (`TRANSFER` / `MINT` / `BURN`); Beryl bitmask max `7` |
| `pausedFeatures() → PausableFeature[]` | `0xde9997e3` | set of paused features |
| `extraMetadata(string) → string` | `0x4ddf9da0` | issuer key/value (ISIN/CUSIP live here) |
| events `MultiplierUpdated(uint256)`, `Announcement(caller,id,description,uri)`, `EndAnnouncement(id)` | — | corporate-action provenance; indexed off-chain |

**Beryl has no on-chain pending-multiplier disclosure.** `updateMultiplier` is instant, `OPERATOR_ROLE`-gated, no timelock. Advance notice is the `Announcement` event only. The Chainlink feed's registry-pause + `updatedAt` freeze is the other in-band signal that a corporate action is mid-flight.

## 2. Cobalt (the next Base upgrade) — NOT active

| Field | Value |
|---|---|
| Status | **Planning** — Sepolia & Mainnet both dated "September 2026" (`docs.base.org/upgrades/cobalt/overview`); not activated as of the 2026-09-08 probe |
| B20 changes | scheduled multiplier updates (ERC-8056: `updateUIMultiplier` / `newUIMultiplier` / `effectiveAt` / `cancelUIMultiplierUpdate`, event `UIMultiplierUpdated`), `seizeWithMemo` surface + `burnBlocked` deprecation, composite (UNION/INTERSECT) policies, pay fees in B20 |
| Production implication | **do not build against ERC-8056 scheduled updates as if live.** The adapter probes `newUIMultiplier()` / `effectiveAt()` by low-level staticcall: absent (Beryl) → the pending factor is unknown on-chain and `feedStatus` derives the activation window from the oracle pause + `Announcement` events; present (Cobalt) → read them into `pendingFactorWad` / `pendingActivationAt`. The B20Compat probe records which path is live and the block it was probed at. |
| If Cobalt activates during Phase 08 | re-run `B20Compat.t.sol` + the Phase-03-derived compatibility cases against the new active semantics; do not assume a no-op. |

## 3. Coinbase tokenized stocks (real, Base Mainnet only)

| Field | Value |
|---|---|
| Capability | B20 ASSET-variant tokenized US equities issued by Coinbase |
| Sepolia | **none.** Coinbase issues only on Base Mainnet. No authoritative testnet versions of the real products exist. |
| Mainnet | 13 instruments live (list in `BASE_CANARY_CANDIDATES.md`) |
| Official source | `docs.base.org/specifications/b20/tokenized-stocks-on-base`, `coinbase.com/tokenize` (product/legal), onchain registry `0x3f3E8cf41cdd3b1D118c16471aB0113DfDDd5CaD` (`B20Created` discovery) |
| Trust boundary | Coinbase is the issuer and sole `OPERATOR_ROLE` / admin holder — sets the multiplier, can pause, can seize via policy-blocklist + `burnBlocked`. Base does not configure or control issued tokens. |
| Test strategy | mainnet **read-only** characterization (`packages/base/src/mainnet-characterize.mjs`), no transaction against the security |
| Unknowns | per-instrument prospectus/jurisdiction terms (recorded per candidate); exact Coinbase oracle-registry address (Chainlink reads it internally; Usance reads the token's own `multiplier()`) |
| Production implication | **eligible-jurisdiction, non-US only.** Real-collateral deposit is Phase 13, not here. |

## 4. Testnet B20 strategy — `SYNTHETIC_TEST_B20`

| Field | Value |
|---|---|
| Capability | deliberately synthetic B20 ASSET-variant instruments on Base Sepolia via the real factory precompile |
| Method | `IB20Factory.createB20(B20Variant.ASSET, salt, abi.encode(B20AssetCreateParams{version:1, name, symbol, initialAdmin, decimals}), initCalls)` → deterministic `0xB200…` address |
| Labelling | names/symbols carry a `USANCE-TEST-` prefix; **no ticker mimicry** of a real Coinbase instrument |
| Proves | B20 custody, `multiplier()` accounting, the portfolio facility mechanics, liquidation/accounting integration |
| Does NOT prove | "Coinbase stock X is live collateral on testnet" |
| Unknowns | whether the ASSET variant feature is activated on Base Sepolia — checked at deploy via `ActivationRegistry` before `createB20` (`FeatureNotActivated` otherwise) |

## 5. Chainlink price data — per instrument, Base Mainnet

| Field | Value |
|---|---|
| Product | **Chainlink Data Feeds** (push, `AggregatorV3.latestRoundData()` via proxy) — `deliveryChannelCode: DF`, `productTypeCode: primaryTokenizedPrice`, `productSubType: calculatedPrice` |
| Value | **Total Return Value = underlying equity market price × multiplier** → `priceConvention = FACTOR_IN_PRICE` (spec/corporate-action-model.md §5). Quantity side MUST use **raw** `balanceOf`, never `scaledBalanceOf`. |
| Decimals | **8** · quote **USD** · `marketHours: us_equities_24/5` |
| Freshness | 0.5% deviation or 24h heartbeat **during market hours only**; off-hours / weekends / holidays / corporate-action pause → feed holds last value, `updatedAt` stops advancing. "Never settle or liquidate against a frozen feed." |
| Pause | the feed reads a pause flag from Coinbase's onchain oracle registry (separate contract); `paused == true` → feed freezes at last-known-good. Total-return construction means no price discontinuity across a split. |
| Sepolia | **no Coinbase tokenized-equity feeds on Base Sepolia** (RDD probe: 0 of 9 Base-Sepolia feeds). Sepolia lifecycle uses a `TEST_ONLY` oracle for the synthetic instruments. |
| Official source | `docs.chain.link/data-feeds/tokenized-equity-feeds/coinbase`, RDD `reference-data-directory.vercel.app/feeds-ethereum-mainnet-base-1.json` |
| Access requirement | none — push feeds, no API key / Data Streams entitlement |
| Feed proxy addresses (Base Mainnet, decimals 8) | AAPL `0x787f13dEa48Db0897CbCDD985de77809D837F988` · AMZN `0x06A8E4b3aBB3B7543d8396FB2B763d22820cB295` · COIN `0x408e44f504A7371a345F03a73dDC96A4b48e8aa7` · CRCL `0x0231cF2635D1E17bB5c2462cc7504Ba1fBd61f33` · GOOGL `0x5bF49E0ffA937CE2FfF033c739aD7C634c4D34F2` · INTC `0xAB657C39bac0D5886250D70849e2E3E008F2EECB` · META `0x6526aE6797A76123638b863AeE4dD27Ba4E4b27D` · MSFT `0xeB10A6c9aa7E537aEd766C08c35Dae35B321b18c` · MSTR `0xB3cE282CD188b35DA0E38D8Bc7d58e33173D202a` · NVDA `0x04689a41629776563E6822F76f2e57D148d28513` · SNDK `0x388b0dC46C0Fb05A74BeE0994fa5b02c6Fcca2eA` · SPCX `0x6A634B235903C4ad6376892180d6fF8612e3Fa68` · TSLA `0xFaf869185383a24F8cb00e27BdA6b63B9905DCb4` |
| Trust boundary | Chainlink DON for the price; Coinbase registry for the multiplier/pause the feed folds in. Usance re-checks `updatedAt` staleness and cross-checks the feed's implied multiplier against the token's own `multiplier()` (I-B04). |
| Production implication | `ChainlinkTotalReturnOracleAdapter` reads the proxy; `FACTOR_IN_PRICE` so the risk pipeline multiplies raw quantity by the feed price only. A frozen feed (`updatedAt` older than the configured bound, or B20 token `isPaused`) → `feedStatus = PAUSED_FOR_ACTION` / `STALE` → no new risk. |

## 6. Settlement asset — native USDC

| Field | Value |
|---|---|
| Base Mainnet native USDC | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` · 6 decimals |
| Base Sepolia native USDC | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` · 6 decimals |
| Official source | `developers.circle.com/stablecoins/usdc-contract-addresses` |
| Sepolia acquisition | Circle faucet (`faucet.circle.com`) — recorded in `BASE_TESTNET_RESOURCE_PLAN.md`, requested only at the funding step |
| Trust boundary | Circle is the issuer/redeemer. The facility holds USDC as settlement; it never mints. |
| Test strategy | the live Base Sepolia lifecycle draws and repays **native test USDC**, not a mock, once available. Deterministic unit tests use a `MockERC20` 6dp stand-in clearly named `TEST`. |
| Production implication | settlement accounting is 6-decimal; USD18 ↔ token conversion at the facility boundary, same discipline as `spec/accounting.md` D-009. |

## 7. Circle CCTP — transport only, deferred

| Field | Value |
|---|---|
| Canonical version | **CCTP V2** (`developers.circle.com/cctp`) — V1 is legacy, not built against |
| Phase 08 need | **none.** Native USDC settlement on Base Sepolia proves the credit workflow without cross-chain cash transport. |
| If implemented later | `CircleCctpTransport` against CCTP V2; `CCTP attestation/mint != facility repayment != facility settlement` — the facility finalises its own financial state (§18). Not a Phase 08 blocker. |

## 8. Base network upgrade state (context)

Active upgrade chain through Beryl: …Isthmus → Jovian → **Beryl** (B20 + reth v2) → Denim (200ms blocks) — Denim/Jovian are execution/derivation, not B20. Cobalt is next and in Planning. The B20Compat probe records `block.number` and the active B20 read-path at deploy time.

---

## Consolidated trust model for the Base facility

```
B20 token multiplier()      → corporate-action factor        [Coinbase OPERATOR_ROLE, instant, announced]
B20 token balanceOf(vault)  → raw committed quantity          [stable across corporate actions]
Chainlink TR Data Feed      → underlying × multiplier (USD8)  [Chainlink DON + Coinbase registry pause]
Usance BaseB20InstrumentAdapter → pinned CorporateActionSnapshot { factorWad, feedStatus, sourceBlock }
Usance ChainlinkTotalReturnOracleAdapter → usd18 price + staleness + implied-multiplier cross-check
Usance PortfolioRiskEngine  → Σ singleRecognized → risk-group caps → portfolioRecognized   [pure, fixed-point, = TS reference]
Usance PortfolioRevolvingCredit → max debt, draw, repay, withdraw, origination fee (no bypass)  [the only money authority]
```

No AI in any number. `ClearingHouse` untouched. All Base contracts additive.

# Phase 08 report — Base production domain / tokenized-stock credit

Status: **complete**. Commits `0dce0c4` → `b3ba338`. Deployed core (X Layer 1952) untouched.
No real Coinbase stock deposited, no real USDC borrowed, no mainnet write — that is Phase 13.

Proof-language note carried in: CRE remains `LIVE_SIMULATION` (see
`docs/ethonline-2026/CONTINUITY.md`); Base Sepolia is `LIVE_TESTNET`; Base mainnet B20 work is
`MAINNET_READ_ONLY`.

---

## Base capability matrix

| Capability | Sepolia | Mainnet | Active version | Evidence |
|---|---|---|---|---|
| B20 native token standard | active (2026-06-18) | active (2026-06-25) | **Beryl** (ordinal 01); Cobalt is Planning / not active | `BASE_CAPABILITY_MATRIX.md §1–2`, base-std v1.0.0 |
| Coinbase tokenized stocks (B20 ASSET) | **none** (Coinbase issues mainnet only) | 13 instruments | Beryl `multiplier()` instant, no on-chain ERC-8056 pending | `mainnet-b20-characterization.json` |
| Chainlink price | **no tokenized-equity feeds** on Base Sepolia | Total-Return **Data Feeds** (push, 8dp USD, `us_equities_24/5`, `FACTOR_IN_PRICE`) | `AggregatorV3` proxy | RDD `feeds-ethereum-mainnet-base-1.json`, `docs.chain.link/.../coinbase` |
| Native USDC | `0x036CbD53…CF7e` (6dp) | `0x833589fC…2913` (6dp) | — | `developers.circle.com` |
| Circle CCTP | — | V2 canonical | — | not a Phase 08 dependency (§18) |
| B20 ASSET-variant issuance | active — used | active | Beryl factory `0xB20f…` | `base-sepolia-lifecycle.json` (2 tokens issued) |

## B20 canary candidates

| Instrument | Address | Underlying | Issuer | Accounting semantics | Oracle | Liquidity | Eligibility | Risk status | Decision |
|---|---|---|---|---|---|---|---|---|---|
| NVDAc | `0xb20000000000000000000078ee7ce2fE4908108C` | Nvidia | Coinbase | `EXTERNALLY_SCALED`, `FACTOR_IN_PRICE`, `multiplier()=1e18` | Chainlink TR feed `0x04689a41…` (fresh) | PROVISIONAL — real observation required at Phase 13 | non-US eligible-jurisdiction | admissible | **SELECT** |
| AAPLc | `0xb200000000000000000000C2e324d24d7eEcd1fb` | Apple | Coinbase | same | `0x787f13dE…` | PROVISIONAL | non-US | admissible | **SELECT** |
| GOOGLc | `0xb2000000000000000000002D0BA3164cc74f58B7` | Alphabet | Coinbase | same | `0x5bF49E0f…` | PROVISIONAL | non-US | admissible | **SELECT (3rd, optional)** |
| MSFTc / METAc | — | Microsoft / Meta | Coinbase | same | present | PROVISIONAL | non-US | admissible | HOLD (share a sector with a selected name / thin supply) |
| COINc, CRCLc, INTCc | — | — | Coinbase | — | present | — | — | `totalSupply == 0` at probe | EXCLUDE |
| SNDKc | `0xb200000000000000000000397293Cb8cda9a10c5` | SanDisk | Coinbase | same | feed reported `$1751.5` | — | — | data-quality flag | EXCLUDE until explained |
| MSTRc, SPCXc, TSLAc | — | — | Coinbase | same | present | — | — | BTC-proxy / private-company mark / high vol | EXCLUDE from the canary core |

Full scoring: `BASE_CANARY_CANDIDATES.md`. Selection cites exact addresses; admission at Phase 13
is still conditional on a real `ILiquidityObserver` size-aware exit + a re-read of `multiplier()` /
`isPaused()` / feed freshness at the admission block + signed `RiskGroupRef`s.

## B20 compatibility

**Can the existing `CollateralVault` safely custody this B20 family? — CONDITIONAL** (per
`spec/corporate-action-model.md §7`). B20 raw `balanceOf` is stable across corporate actions, so a
nominal per-account raw ledger keeps `Σ credited == token.balanceOf(vault)` and solvency; what the
deployed vault lacks is a pinned `CorporateActionSnapshot` per quote and feed-pause handling.

**What custody implementation is actually used?** A **new** `ScaledCollateralVault` — nominal raw
ledger + measured-delta deposit + surplus classification (I-109) + the facility pins the snapshot
on every quote. **Not** the deployed `CollateralVault` (untouched), **not** the
`RebasingCollateralVault` `SHARE_BASED_CUSTODY` design (that is for `REBASING_BALANCE` / xStocks,
Phase 09).

## Facility reuse decision

| | `ClearingHouse` | `InstitutionalFacility` | New facility |
|---|---|---|---|
| Portfolio-recognized collateral | no (Σ single only) | no | **required** |
| `EXTERNALLY_SCALED` custody + pinned snapshot | no (`FIXED_UNIT`) | no | **required** |
| Revolving draw / repay / re-draw | yes | no (term) | **required** |
| Bypass-free origination fee | no (D-025 gap) | yes | **required** |
| Deployed / immutable | yes (1952) | no | — |

**Decision: new `PortfolioRevolvingCredit`, `facilityType = PORTFOLIO_REVOLVING_CREDIT`** (D-028).
Neither existing facility fits safely. `ClearingHouse` stays closed. Base is the deployment
domain, not code — no contract is named after Base.

## Portfolio enforcement (live Base Sepolia)

```
Σ individually recognized      = $900,000 (A: 10,000 utALPHA x $100 x 90%) + $720,000 (B: 10,000 utBETA x $80 x 90%)  = $1,620,000
→ risk-group restrictions      ISSUER group i-usance-test holds both → group total = base → allowed = base x 50% = $810,000 → scale 0.5
                               (UNDERLYING 35% and SECTOR 40% caps do not bind harder; SESSION OPEN factor 1.0)
→ portfolio recognized         = $810,000     (I-112: <= Σ single; ISSUER binds)
→ facility credit limit        = min(facilityLimit $20 , $810,000 x maxLtv 50%) = $20
```

`base-sepolia-lifecycle.json.lifecycle.quoteAtActivation.portfolioRecognizedUsd18 =
810000000000000000000000`. After forcing UNKNOWN session: `486000000000000000000000`
(`810,000 x sessionFactor 0.30 / 0.50` — the UNKNOWN factor 3000bps replaces OPEN 10000bps),
`allLive: false`, `newDrawRefused: true`.

I-116 differential conformance (`fixtures/portfolio/portfolio-scenarios.json`, 14 scenarios):
Solidity `PortfolioRiskEngine` == `packages/portfolio-risk/src/evaluate.ts` wei-for-wei, including
the L truncation case (`449999999999999999200`).

## Oracle map

| Instrument | Product | Feed / source | Quote | Freshness | Market status | Access |
|---|---|---|---|---|---|---|
| Base Sepolia utALPHA / utBETA (this phase) | `TestOnlyOracleAdapter` (**TEST_ONLY**) | governance-set price + `updatedAt` | USD18 | `sess <= 2 && now <= updatedAt + 3600` | `UsEquitySessionOracle` | n/a |
| Base Mainnet canary (Phase 13) | Chainlink Data Feed (push) | proxy in `BASE_CANARY_CANDIDATES.md` | USD, 8dp | session-aware; `OPEN` bound tight, `CLOSED` never backs new risk | `UsEquitySessionOracle` | none (public) |

## USDC

| Network | Official address | Decimals | Funding source | Amount used |
|---|---|---|---|---|
| Base Sepolia | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` | 6 | Circle faucet | 25 test USDC funded into the facility; 10 drawn; ~10.03 repaid |
| Base Mainnet | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` | 6 | — | none (no mainnet write) |

## Base Sepolia lifecycle — every tx in order

`docs/base/proof/base-sepolia-lifecycle.json` (`basescan` link on each). Deployer
`0x4De408bD4DE481D11afb27aBcB47AEBc808897eb`.

1. issue utALPHA `0x4c9769a3…` · 2. issue utBETA `0xdd8b2853…`
3–10. deploy PolicyRegistry / Vault / SessionOracle / TestOracle / LiquidityObserver / Adapter A / Adapter B
11. publish `BaseCanaryPortfolioRiskPolicy` · 12–13. risk groups + register + price + liquidity (A `0xc936a52c…`, B `0x5b1fd3ec…`)
14. deploy `PortfolioRevolvingCredit` `0x3c165dd9…` · 15. bind vault `0x18f17ca2…`
16–17. admit A `0x6bf740c4…` / B `0x70a08865…`
18. fund 25 test USDC `0xfc20fe17…` · 19–20. commit A `0xe02499d7…` / B `0x2e71696f…`
21. activate `0x2923df2d…`
22. **draw 10 USDC** `0x61c0b770…` (debt $10.03, fee $0.03)
23. force UNKNOWN session → recognised $810k→$486k, `allLive:false`, **new draw refused**
24. **repay in full** `0x15a429b7…` (debt → $0)
25. **withdraw half of series A safely** `0xd7c33876…`

## Mainnet read-only evidence

`docs/base/proof/mainnet-b20-characterization.json`, Base Mainnet block 51029745, **NO FINANCIAL
ACTION**. All 13 real Coinbase B20 tokenized stocks: `isB20` true, real names ("Apple Inc.",
"Nvidia", …), decimals 8, `multiplier() = 1e18`, `WAD_PRECISION() = 1e18`, Chainlink Total-Return
Data Feeds live (8dp USD, `us_equities_24/5`; off-hours feeds held last close as expected).
`b20ReadPath: BERYL_INSTANT_ONLY` confirmed on mainnet. Exact token + feed addresses per
instrument in the proof and `BASE_CANARY_CANDIDATES.md`.

## Production readiness

**TECHNICAL** — the Base facility mechanics run live on Base Sepolia with synthetic B20 + a test
oracle + native test USDC; the portfolio engine differential-conforms to the reference wei-for-wei;
322 forge tests + `make test-differential` green; contracts under EIP-170 with margin (facility
17.2 KB). The mainnet oracle route and real B20 read path are characterized read-only.

**ECONOMIC** — `BaseCanaryPortfolioRiskPolicy` is `CANARY_PROVISIONAL` / `TESTNET_CALIBRATION`,
never `PRODUCTION_VALIDATED`. Caps and the facility limit are deliberately conservative and
un-calibrated. Real size-aware liquidity observations do not exist yet (they are a Phase 13
admission gate). Liquidation depth is not proven under stress.

**INSTITUTIONAL** — no legal review of the Coinbase tokenized-stock prospectus terms, no
eligible-jurisdiction attestation flow, no lender agreement, no KYC path. Coinbase tokenized
stocks are non-US eligible-jurisdiction only. None of this is in scope for Phase 08.

## Acceptance criteria (§44)

All satisfied: current Base/B20 truth re-verified; Beryl pinned, Cobalt not treated as live; real
mainnet B20 candidates mapped by exact address; no ticker-only admission; real vs synthetic
distinguished; B20 adapter consumes Phase 03; corporate-action snapshot pinnable; unsafe
`CollateralVault` semantics not forced onto B20 (new `ScaledCollateralVault`); facility reuse
analysis done (new facility); `ClearingHouse` untouched; Phase 04 engine implemented +
differential-conformed; policy registry + versioned epoch; no diversification bonus; unknown
metadata cannot improve capacity; risk-group metadata for the candidates; market-session handling;
Chainlink product chosen per candidate (Data Feed, Total-Return); stale/unsupported oracle fails
closed; native Base Sepolia USDC used for the live settlement; CCTP not a blocker; origination fee
has no bypass; live Base Sepolia lifecycle executed; multiplier/session change with debt tested;
unsafe withdrawal refused; mainnet read-only characterization produced; no real-capital mainnet
action; Base continuity overlay exists; contracts under EIP-170 with headroom; fuzz/property/
conformance pass; full repo gates pass; proof claims honest.

## Carried forward (not absorbed by Phase 08)

- X Layer OKLink explorer source publication → `MANUAL_ACTION_REQUIRED`.
- CRE network deployment → external Chainlink deploy-access; the simulation proof is the honest ceiling.
- Phase 09 owns production xStocks / X Layer; Phase 10 owns 0G; **Phase 13 owns real Base capital.**

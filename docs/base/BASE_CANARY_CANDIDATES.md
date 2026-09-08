# BASE_CANARY_CANDIDATES.md

Machine-readable admission scoring for the real Coinbase B20 tokenized stocks on Base Mainnet.
Candidates are **not** chosen by ticker popularity (§4). All on-chain values are from
`docs/base/proof/mainnet-b20-characterization.json`, Base Mainnet block 51029745, probed 2026-09-08.
This ranks instruments for the **future Phase 13 real-capital canary**; Phase 08 itself deposits
nothing real.

## Scoring dimensions (each 0–3, higher = more admissible)

| Key | Meaning |
|---|---|
| `identity` | authoritative contract identity verified (`isB20`, real `name`, deterministic `0xB200…` address, docs + registry cross-checked) |
| `issuerLegal` | issuer + legal terms clarity (Coinbase issuer; eligible-jurisdiction non-US; prospectus at coinbase.com/tokenize) |
| `b20Semantics` | current B20 accounting semantics resolved (Beryl `multiplier()`, raw-stable `balanceOf`, `FACTOR_IN_PRICE`) |
| `oracle` | Chainlink Total-Return Data Feed present, fresh in-session, 8dp USD |
| `liquidity` | observable size-aware DEX depth on Base (admission GATE — a real number is required before mainnet admission, not a guess) |
| `liquidationRoute` | a concrete Base venue that can exit the position |
| `sessionObservable` | underlying US-equity session is classifiable (all `us_equities_24/5`) |
| `corpAction` | corporate-action capability + advance-notice path understood |
| `custodyCompat` | fits `ScaledCollateralVault` raw-hold custody (all B20 ASSET → yes) |
| `concentration` | portfolio concentration implications (does it add a *distinct* underlying/sector, or double up / correlate) |
| `opComplexity` | low issuer-operational surprise risk (mature large-cap < BTC-proxy < private-company mark) |

`liquidity` and `liquidationRoute` are scored **PROVISIONAL** in Phase 08: the real size-aware
observation is produced by `ILiquidityObserver` against a named Base venue at admission time
(`spec/base-portfolio-facility-model.md §8`). An instrument with no real `(route, positive depth)`
stays **unadmitted** — it is not silently zero-capped, it is simply not collateral (I-89 rule).

## Ranked candidates

| Rank | Instrument | Token address | Underlying | Sector group | Supply (tokens) | Feed | Feed proxy | identity | issuerLegal | b20Semantics | oracle | liquidity | liqRoute | corpAction | concentration | opComplexity | Total | Decision |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | **NVDAc** | `0xb20000000000000000000078ee7ce2fE4908108C` | Nvidia | US_SEMICONDUCTORS | ~13,768 | Coinbase NVDA | `0x04689a41629776563E6822F76f2e57D148d28513` | 3 | 3 | 3 | 3 | P/2 | P/2 | 3 | 3 (distinct underlying + sector) | 3 | **28** | **SELECT** — deepest B20 supply, distinct sector, clean large-cap |
| 2 | **AAPLc** | `0xb200000000000000000000C2e324d24d7eEcd1fb` | Apple | US_LARGE_CAP_TECH | ~6,228 | Coinbase AAPL | `0x787f13dEa48Db0897CbCDD985de77809D837F988` | 3 | 3 | 3 | 3 | P/2 | P/2 | 3 | 3 (distinct underlying + sector) | 3 | **28** | **SELECT** — mature mega-cap, second-deepest supply, no BTC/AI-narrative correlation to NVDA beyond broad-market |
| 3 | **GOOGLc** | `0xb2000000000000000000002D0BA3164cc74f58B7` | Alphabet | US_COMMUNICATION_SERVICES | ~6,661 | Coinbase GOOGL | `0x5bF49E0ffA937CE2FfF033c739aD7C634c4D34F2` | 3 | 3 | 3 | 3 | P/2 | P/2 | 3 | 3 (distinct underlying + sector) | 3 | **28** | **SELECT (optional 3rd)** — adds a third sector for a genuine 3-name portfolio test |
| 4 | MSFTc | `0xB200000000000000000000Ab99cFa739E253872B` | Microsoft | US_LARGE_CAP_TECH | ~633 | Coinbase MSFT | `0xeB10A6c9aa7E537aEd766C08c35Dae35B321b18c` | 3 | 3 | 3 | 3 | P/1 | P/1 | 3 | 2 (same sector as AAPL) | 3 | 26 | HOLD — thin B20 supply, shares AAPL's sector group |
| 5 | METAc | `0xb2000000000000000000008bC8786B856E61707C` | Meta Platforms | US_COMMUNICATION_SERVICES | ~2,433 | Coinbase META | `0x6526aE6797A76123638b863AeE4dD27Ba4E4b27D` | 3 | 3 | 3 | 3 | P/2 | P/2 | 3 | 2 (same sector as GOOGL) | 3 | 27 | HOLD — good liquidity, but doubles GOOGL's sector |

## Excluded (with reason)

| Instrument | Reason |
|---|---|
| COINc, CRCLc, INTCc | `totalSupply == 0` on Base Mainnet at the probe block — no AP-minted float, nothing to observe or admit |
| SNDKc | `latestAnswer` reported `$1751.5` (SanDisk trades well below that) — an unresolved feed/reference data-quality flag; tiny ~175-token supply. Not admissible until the discrepancy is explained by Chainlink/Coinbase. |
| MSTRc | MicroStrategy is a leveraged Bitcoin proxy — its price is highly correlated with the crypto collateral risk Usance already carries elsewhere; poor concentration behaviour for a stock-portfolio canary |
| SPCXc | SpaceX is a private company; the "market price" is a periodic mark, not continuous public price discovery — weakest `oracle` + `sessionObservable` of the set |
| TSLAc | high volatility relative to the mega-cap set; retained as a stress-test-only name, not a canary core |
| AMZNc | fine large-cap, but Rank 1–3 already cover its sector-adjacent exposure with deeper B20 supply; kept as a 4th-slot alternate |

## Final selection for the Phase 13 canary

**1–3 instruments, exact addresses:**

```
NVDAc  0xb20000000000000000000078ee7ce2fE4908108C   feed 0x04689a41629776563E6822F76f2e57D148d28513
AAPLc  0xb200000000000000000000C2e324d24d7eEcd1fb   feed 0x787f13dEa48Db0897CbCDD985de77809D837F988
GOOGLc 0xb2000000000000000000002D0BA3164cc74f58B7   feed 0x5bF49E0ffA937CE2FfF033c739aD7C634c4D34F2
```

The 2-name minimum (NVDA + AAPL) gives two distinct underlyings and two distinct sector groups
with a shared issuer (Coinbase) and shared custody group — the portfolio engine's ISSUER and
CUSTODY dimensions genuinely bind, which is the point. Adding GOOGL makes it a 3-sector portfolio.

**Admission is still conditional** on, per instrument, at Phase 13:
- a real `ILiquidityObserver` size-aware exit estimate on a named Base venue ≥ the intended facility limit's liquidation slice;
- the current `multiplier()` and `isPaused()` re-read at the admission block;
- the Chainlink feed fresh and in-session at the admission block;
- the risk-group `RiskGroupRef`s (underlying/issuer/custody/sector/liquidity) signed into policy with source + taxonomy version;
- `CANARY_PROVISIONAL` policy caps and a very low facility limit (`BaseCanaryPortfolioRiskPolicy`).

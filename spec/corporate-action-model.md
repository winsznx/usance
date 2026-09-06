# spec/corporate-action-model.md — corporate-action accounting

Status: **frozen**. Additive to a live deployment. The reference model and fixtures are new; the
deployed core is not touched (§7). Changing a conversion rule or a rounding direction here once a
fixture is committed is an RFC in `spec/rfcs/`.

This document answers: **an instrument whose economic quantity changes through issuer-defined
corporate-action mechanics must not silently create, destroy, misattribute, double-count or unlock
Usance collateral.**

It is accounting, not risk. Corporate-action accounting answers *how many economically effective
units does an account own*. The risk engine answers *what value may Usance recognise for those
units*. The instrument/accounting layer never sets a price, haircut, LTV or recognised USD value.

---

## 1. Three quantities, never one `amount`

| Name | Symbol | Is | For FIXED_UNIT |
|---|---|---|---|
| **Stored quantity** | `stored` | what the token contract or the custody adapter actually holds/returns for an account. For `EXTERNALLY_SCALED` this is raw token units; for `REBASING_BALANCE` it is `balanceOf()` which the token has already adjusted; for `SHARE_BASED_CUSTODY` it is a share count in a Usance pool. | `stored = deposited` |
| **Effective economic quantity** | `effective` | what the holder economically owns *now*, after applying the instrument's current corporate-action state. This is the number the risk engine multiplies by a price. | `effective = stored` |
| **Usance credited quantity** | `credited` | the quantity Usance attributes to one account for collateral accounting and withdrawal entitlement. Under `SHARE_BASED_CUSTODY` it is a share of a pool; the account's `effective` is `credited × poolEffective / poolShares`. | `credited = stored` |

Every conversion boundary is an explicit function with a frozen rounding rule (§4). They are equal
for `FIXED_UNIT`. They are **not assumed equal** for any corporate-action-capable family.

## 2. Accounting-mode taxonomy

The smallest set that expresses the real behaviour of the families Usance intends to support.
Names describe **Usance** semantics, not provider brands. An accounting mode is a field on
`InstrumentIdentity`, never an input to `instrumentId` (`identity-model.md §5`); adding a variant
is a runtime-behaviour change, not an `InstrumentIdentity` meaning change, so it is not an RFC
(`DECISIONS.md` D-023).

| Mode | `balanceOf()` on a corporate action | Where the factor lives | Real example |
|---|---|---|---|
| `FIXED_UNIT` | unchanged; there is no factor | n/a | plain ERC-20 stablecoin / T-bill token, the X Layer testnet stand-ins |
| `EXTERNALLY_SCALED` | **unchanged (raw)** | a separate accessor on the token (`multiplier()` / `scaledBalanceOf()`), WAD-scaled | **Coinbase B20** |
| `REBASING_BALANCE` | **changes** — the token applies the factor inside `balanceOf()` | internal to the token; also readable via a `multiplier()` accessor | **xStocks / Backed** on EVM |
| `SHARE_BASED_CUSTODY` | n/a — the account holds Usance pool shares, not the token | a Usance-owned pool whose effective size tracks the custodied token balance | the additive V2 custody path for `REBASING_BALANCE` instruments (§7) |
| `EXTERNALLY_MANAGED` | gated by an external partition/compliance system | external | Hedera ATS securities |

`EXTERNALLY_SCALED` and `REBASING_BALANCE` have **opposite `balanceOf()` semantics** and must be
modelled independently (D-109). A single `supportsCorporateActions` boolean is forbidden — support
is a status (§6).

## 3. `CorporateActionSnapshot` — mutable state must be pinnable

A financial quote or risk computation that depends on a mutable multiplier/rebase state must be
reproducible. The adapter never returns a bare current number.

```
CorporateActionSnapshot {
    instrumentId         bytes32
    accountingMode       one of §2
    accountingModeVersion uint      // bump when the interpretation of `factorWad` changes
    factorWad            uint       // WAD-scaled. 1e18 == neutral. EXTERNALLY_SCALED: the
                                    // token multiplier. REBASING_BALANCE: the multiplier the
                                    // token reports. FIXED_UNIT: exactly 1e18.
    pendingFactorWad     uint | null // a scheduled/announced future factor (B20 ERC-8056,
                                     // xStocks pre-published multiplier), null if none
    pendingActivationAt  uint | null // block or unix time the pending factor becomes authoritative
    sourceDomain         caip2
    sourceBlock          uint       // block the factor was read at
    sourceEvent          string | null // the announcement/update event id, when observed
    priceConvention      "FACTOR_IN_PRICE" | "FACTOR_IN_QUANTITY" | "FACTOR_ABSENT"
    feedStatus           "LIVE" | "PAUSED_FOR_ACTION" | "STALE" | "UNKNOWN"
    adapterVersion       string
    support              one of §6
    observedAt           unix
}
```

`priceConvention` is the anti-double-count control (§5). A `RiskEpoch` or a quote records the
snapshot it used; a decision made under one snapshot cannot execute under another (`I-85`,
restating `I-12` over corporate-action state).

## 4. Rounding, frozen

| Conversion | Direction | Owner of the shortfall |
|---|---|---|
| `stored → effective` for valuation | **down** (toward less recognised value) | the account (conservative) |
| `effective → credited` on deposit (share mint) | **down** | the account (fewer shares → less claim) |
| `credited → effective` on withdrawal / valuation | **down** | the account |
| `credited → raw transfer amount` on withdrawal | **down** | the account (never transfers out more raw than the share entitlement) |
| pool residue after all shares redeemed | — | **classified protocol dust**, never swept to income, surfaced like `CollateralVault.surplus` |

A conversion must **never** let rounding increase borrowing capacity or let a holder withdraw more
underlying economic ownership than their claim. Fixtures include adversarial decimal cases
(6/8/18-decimal tokens, non-integer multipliers like `4.032`, `2.016`).

## 5. Price × quantity must not double-count the factor

The corporate-action factor appears **exactly once** in an economic value. Which side carries it
is the instrument's `priceConvention`:

- `FACTOR_IN_PRICE` — the oracle feed already includes the multiplier (the **Chainlink B20
  Total-Return feed** reports `underlyingSharePrice × multiplier`). Then economic value =
  `rawBalance × feedPrice`. The quantity side must use **raw**, not `scaledBalanceOf`.
- `FACTOR_IN_QUANTITY` — the feed reports the raw underlying share price. Then economic value =
  `effectiveQuantity × sharePrice`, where `effectiveQuantity = raw × factorWad / WAD` (or, for
  `REBASING_BALANCE`, `balanceOf()` directly, which is already `effective`).
- `FACTOR_ABSENT` — `FIXED_UNIT`; factor is `1e18` and neither side scales.

A 2× split with a 0.5× per-unit price move preserves economic value **before haircuts**; the
reference model asserts this for split, reverse split and dividend. Applying the factor on both
sides is the specific defect `I-84` exists to catch.

## 6. Support status, not a boolean

```
CorporateActionSupport:
  VERIFIED_SUPPORTED  — the exact token contract + feed were inspected; mechanics match a fixture
                        family; an additive adapter and (if needed) V2 custody are deployed.
  TESTED_SUPPORTED    — the family's mechanics are modelled and pass the reference + adversarial
                        campaign; no production adapter/deployment yet.
  RESTRICTED          — partial support; new risk is capped or blocked; risk-reducing ops allowed.
  UNKNOWN             — a load-bearing behaviour could not be established from authoritative
                        sources. Cannot unlock new risk. Restricts.
  UNSUPPORTED         — not modelled; cannot be admitted.
```

Production admission requires the status appropriate to the risk. `UNKNOWN` never authorises new
risk (`I-85`). Today: `FIXED_UNIT` is `VERIFIED_SUPPORTED` (deployed); `EXTERNALLY_SCALED` (B20)
and `REBASING_BALANCE` (xStocks) are `TESTED_SUPPORTED` after Phase 03 — the modelled semantics are
safe, no production adapter or deployment exists.

## 7. Existing-core compatibility

The deployed `CollateralVault` credits a **measured delta at deposit** and stores a **nominal
per-account unit count** (`balanceOf[assetId][account]`), with `totalDeposited[assetId]` its sum
and `isSolvent = held >= totalDeposited` as invariant `I-01`. `ClearingHouse._assetInput` feeds
`quantity = collateral.balanceOf(id, account)` straight into the risk pipeline. There is no
corporate-action event ingestion and no effective-quantity conversion.

| Family | Deployed core custody | Reason | Path |
|---|---|---|---|
| `FIXED_UNIT` | **YES** | `stored = effective = credited`; no factor | unchanged |
| `EXTERNALLY_SCALED` (B20) | **CONDITIONAL** | `balanceOf(vault)` is **stable** across corporate actions, so `totalDeposited` stays matched and `I-01` holds. Economic value stays correct **iff** the oracle is the B20 Total-Return feed (`priceConvention = FACTOR_IN_PRICE`) and nothing separately multiplies by `scaledBalanceOf`. What is missing is a pinned `CorporateActionSnapshot` on every quote/epoch and feed-pause handling. | additive **read adapter** (`IInstrumentAdapter`) that supplies raw quantity + a pinned snapshot + `feedStatus`; **no `CollateralVault` change** |
| `REBASING_BALANCE` (xStocks) | **NO** | `balanceOf(vault)` **changes** on a corporate action (multiplier `4.032 → 2.016` on a 2-for-1 reverse split). A positive rebase orphans value in `surplus`; a negative rebase makes `held < totalDeposited` and **breaks `I-01`**. Nominal per-account accounting cannot represent a share of a rebased pool. | additive **`SHARE_BASED_CUSTODY` V2 vault** (`RebasingCollateralVault`, §8) — per-account shares, pool effective size tracks `token.balanceOf(vault)` at a pinned block. Deployed alongside a domain in Phase 08/09. The deployed `CollateralVault` is never modified. |
| `EXTERNALLY_MANAGED` (ATS) | **NO** | partition/compliance-gated transfers | additive ATS adapter + custody, Phase 06/07 |

This is not an RFC. The Product Lock anticipates additive production paths (`MIGRATION_PLAN` "code
to add", D-119 canary process). The deployed X Layer 1952 core stays byte-for-byte matched to
source; it holds only `FIXED_UNIT` instruments and continues to.

## 8. `RebasingCollateralVault` — the additive V2 custody path (spec, not built)

For `REBASING_BALANCE` / `SHARE_BASED_CUSTODY` instruments on a future production domain.

```
per account:   shares[assetId][account]        // Usance pool shares, minted on deposit
pool:          totalShares[assetId]
               pinnedTokenBalance[assetId]      // token.balanceOf(vault) at pinnedBlock
               pinnedBlock[assetId]

deposit(raw):
   observedDelta = token.balanceOf(vault)_after - _before          // measured delta, as today
   sharesMinted  = totalShares == 0 ? observedDelta
                                    : mulDiv(observedDelta, totalShares, pinnedTokenBalance)  [down]
   shares[account] += sharesMinted ; totalShares += sharesMinted
   pinnedTokenBalance = token.balanceOf(vault) ; pinnedBlock = block.number

effectiveOf(account) = mulDiv(shares[account], currentTokenBalance, totalShares)  [down]

withdraw(account, shares):
   rawOut = mulDiv(shares, currentTokenBalance, totalShares)  [down]
   shares[account] -= shares ; totalShares -= shares
   transfer(rawOut)

reconcileRebase():  // permissionless; re-pins to the current token balance
   pinnedTokenBalance = token.balanceOf(vault) ; pinnedBlock = block.number
   // emits RebaseObserved(oldBalance, newBalance, factorImplied) — NOT CollateralDeposited/Withdrawn
```

Properties (proved in the reference model, and required of the eventual Solidity):

- a rebase changes `currentTokenBalance` and therefore every account's `effectiveOf`
  **proportionally**; it never changes `shares`, never mints/burns a deposit, and emits a
  distinct `RebaseObserved` event (`I-81`);
- `Σ effectiveOf(account) + dust == currentTokenBalance` under authorised deposits, withdrawals,
  liquidation transfers, issuer rebases and modelled fees only (`I-80`);
- a reverse split (`currentTokenBalance` drops) reduces every `effectiveOf` proportionally and
  **cannot break solvency** — the pool never owes more than it holds;
- an unsolicited transfer into the vault increases `currentTokenBalance` with no `RebaseObserved`
  provenance; it is classified as **unattributed surplus** and never credited to a holder or to a
  share (`I-82`). Where a token cannot distinguish a rebase from a donation on-chain, the
  conservative default is to treat an unprovenanced balance increase as surplus, not as a rebase.

## 9. Activation windows fail closed

`EXTERNALLY_SCALED` and `REBASING_BALANCE` both publish a factor **before** it is authoritative
(B20 ERC-8056 `updateUIMultiplier`; xStocks activation at 00:30 UTC the day after the Ex-Date).
During the window between announcement and activation, and during a feed pause
(`feedStatus = PAUSED_FOR_ACTION`):

- new risk (borrow, new collateral valuation increase, capacity increase) is **blocked or
  capped**;
- risk-reducing operations (repay, add collateral, reduce exposure) remain available where safe;
- a pending factor **never increases** collateral privilege before `pendingActivationAt`;
- the more conservative of `{ factorWad, pendingFactorWad }` is used for any capacity computation
  during the window.

`I-83`.

## 10. Ingestion is idempotent; the event stream is not truth

Corporate-action state is reconciled from **authoritative chain state** (`token.multiplier()` /
`token.balanceOf()` at a finalised block), not from an off-chain event feed. Events give advance
notice and provenance; they do not set the number.

- the same announcement/update event delivered twice produces **one** state effect;
- an indexer restart reproduces the same `CorporateActionSnapshot`;
- a reorg reconciles the factor to the canonical chain's value at the domain's safe depth
  (`facility-model.md §3`, `I-79`);
- a factor read below safe depth is `feedStatus = STALE` and restricts, like a stale oracle.

`I-84` (duplicate), reconciliation rules per domain finality.

## 11. What does not change

- `AssetRegistry`, `CollateralVault`, `ClearingHouse`, `FinancingEngine`, `LiquidationManager`,
  `RiskPolicyRegistry` — no bytecode, storage or interface. Live 1952 still matches source.
- `spec/accounting.md` valuation formulas, `identity-model.md` id derivations,
  `fixtures/canonical/`, the differential property — untouched. The risk pipeline stays a pure
  function of an opaque `bytes32` and a `quantity`; corporate-action accounting decides what
  `quantity` (`= effective`) to hand it, and pins the snapshot that produced it.
- Every historical `assetId`, `passportId`, `receiptId` — valid and unedited.
- No new production claim. Phase 03 proves *Usance can safely represent family X*, not *asset Y is
  production collateral* (`EVIDENCE_AND_MEASUREMENT_PLAN`, proof levels stay honest).

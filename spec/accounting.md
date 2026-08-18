# spec/accounting.md — canonical accounting

Status: **frozen**. Changing anything in this document requires an RFC in `spec/rfcs/`.

Four implementations must agree exactly on everything here:

| Implementation | Path | Role | State |
|---|---|---|---|
| Solidity | `contracts/src/libraries/RiskMath.sol` | onchain authority | built |
| Rust | `crates/risk-core` | reference model, differential oracle | built |
| TypeScript | `packages/domain/src/risk.ts` | presentation and preview only | built |
| Python | `scripts/gen_fixtures.py` | direct spec transcription; generates the fixtures | built |

Four independent readings of this document, proven identical on every canonical scenario by
`make test-differential`. `crates/risk-core` has no dependencies at all, not even for its tests,
so an auditor can rebuild the number Usance lends against from this repository alone.

The TypeScript implementation is **never** allowed to invent a financial number. It exists so
the browser can preview a value without a round trip; every previewed value must be
reproducible by the Solidity implementation, and `make test-differential` proves it on the
canonical fixture set.

The canonical set deliberately spans 6, 8 and 18 decimal assets at non-round prices. An
18-decimal-only set divides evenly and hides exactly the decisions this document freezes: with
one, mutation testing showed the haircut order, the market-value rounding direction, the
concentration-cap rounding direction and the debt rounding direction all surviving every
implementation's full test suite.

---

## 1. Numeric domain

No floating point appears anywhere in financial state, in any implementation.
`f64` is banned in `crates/risk-core`. `number` is banned for money in
`packages/domain`; money is `bigint`.

### 1.1 Scales

| Name | Scale | Type | Used for |
|---|---|---|---|
| `BPS` | `10_000` | `uint16` / `u16` | ratios, haircuts, LTVs |
| `PRICE` | `1e8` | `int256` / `i128` | raw Chainlink answer |
| `USD` | `1e18` | `uint256` / `u128` | every internal USD amount |
| `WAD` | `1e18` | `uint256` / `u128` | interest index, health factor |
| asset units | `10^decimals` | `uint256` / `u128` | token quantities |

Every USD quantity in the protocol is `usd18`: an unsigned integer with 18 decimal places.
`1 USD` is `1_000_000_000_000_000_000`.

Chainlink on X Layer publishes 8-decimal answers. The adapter is the only place that
converts, and it converts once:

```
priceUsd18 = uint256(answer) * 1e10          // 8 dp → 18 dp, exact, no rounding
```

A non-positive answer is not a price. It is `ORACLE_INVALID`, and it is rejected before any
conversion.

### 1.2 Rounding

Rounding direction is a property of the *quantity*, not of the call site. There is exactly
one rule and it has no exceptions:

> **Round in the direction that reduces the protocol's risk.**

| Quantity | Direction | Rationale |
|---|---|---|
| collateral market value | down | never over-credit the user |
| recognised collateral value | down | never over-credit the user |
| borrow limit | down | never over-lend |
| maintenance limit | down | trigger protection earlier, not later |
| debt principal | up | never under-charge |
| accrued interest | up | never under-charge |
| interest index | down | index only ever grows; flooring keeps it monotone |
| scaled principal at borrow | up | debt reconstructed from it must not be understated |
| fees owed to protocol | down | never over-collect from the user |
| withdrawable amount | down | never release too much |

Integer division in Solidity, Rust and TypeScript all truncate toward zero, and every value
here is non-negative, so plain `/` *is* round-down. Round-up is written explicitly:

```solidity
function mulDivUp(uint256 a, uint256 b, uint256 d) internal pure returns (uint256) {
    return a == 0 ? 0 : ((a * b - 1) / d) + 1;
}
```

`mulDiv` (round down) is `a * b / d` computed with full 512-bit intermediate precision, so
`a * b` never overflows before the division. The Rust reference uses `u256` intermediates for
the same reason. Any implementation that computes `a * b` in 256 bits and can overflow is a
bug, not a rounding difference.

### 1.3 Ordering

Sums over a portfolio are order-dependent under truncation. The canonical order is
**ascending `assetId`**, where `assetId` is a `bytes32` compared as an unsigned big-endian
integer. All implementations iterate in that order. Fixtures encode assets already
sorted, and `RiskMath` asserts the ordering rather than trusting it.

---

## 2. Identifiers

All identifiers are `bytes32` and all are derived, never assigned by a human, so that two
independent implementations produce the same value from the same inputs.

```
assetId    = keccak256(abi.encode(chainId, tokenAddress))
accountId  = keccak256(abi.encode("USANCE_ACCOUNT_V1", owner))
evidenceId = keccak256(abi.encode(sourceHash, contentHash, effectiveAt))
passportId = keccak256(abi.encode(assetId, version))
intentId   = keccak256(abi.encode(accountId, mandateId, nonce, planHash))
receiptId  = keccak256(abi.encode(chainId, txHash, logIndex))
```

`riskEpoch` is not a hash. It is a strictly increasing `uint64` counter owned by
`RiskPolicyRegistry`. It increments on **any** input change that can move a recognised value:
a Passport commit, a policy parameter change, an asset status change, or an oracle
configuration change. A price moving inside an existing configuration does **not** mint a new
epoch; the epoch identifies the *policy* under which a decision was made, and the oracle
observation is recorded alongside it.

---

## 3. Account model

```
Account {
    collateral[assetId]     -> uint256   // raw token units held by CollateralVault
    scaledPrincipal         -> uint256   // debt principal, index-scaled, usd18-denominated
    reservedUsd18           -> uint256   // capital committed to in-flight execution
    riskEpoch               -> uint64    // epoch of the last evaluation
    status                  -> AccountStatus
    statusOverride          -> AccountStatus  // guardian floor, never a ceiling
}
```

There is no `recognizedCollateral` field. Recognised value is **derived**, never stored.
Storing it would let it drift from the inputs that justify it, and a stored risk number that
disagrees with policy is exactly the failure mode this protocol exists to prevent.

### 3.1 Debt

Debt is carried as scaled principal against a monotonically increasing borrow index.

```
index(0)      = 1e18
index(t + dt) = index(t) + index(t) * rateBps * dt / (BPS * SECONDS_PER_YEAR)     [floor]

SECONDS_PER_YEAR = 31_536_000        // 365 days exactly. Not 365.25. Not a leap-year table.
```

Accrual is linear within an accrual step. Compounding arises from stepping the index; the
step is taken on every state-changing interaction, so the effective compounding frequency is
"every interaction". This is deterministic, cheap, and monotone, and it never depends on how
often anyone happened to call a poke function.

```
borrow(amount):  scaledPrincipal += mulDivUp(amount, WAD, index)
repay(amount):   scaledPrincipal -= min(scaledPrincipal, mulDiv(amount, WAD, index))
debt()        =  mulDivUp(scaledPrincipal, index, WAD)
```

`repay` rounds the *reduction* down, which is round-up on the residual debt. A repayment of
the exact `debt()` value must clear the account to zero: `repayAll` is a distinct code path
that sets `scaledPrincipal = 0` and transfers `debt()`, rather than relying on rounding to
land on zero. This is why invariant `I-04` is testable at all.

### 3.2 Reservations

`reservedUsd18` is capital promised to an in-flight external execution. It is subtracted from
borrowing capacity the moment it is reserved, and released on reconciliation — including
partial reconciliation, where only the unfilled remainder is released.

An adapter can never consume more than its reservation. The reservation is the budget, and
the ClearingHouse debits against it rather than against the account.

---

## 4. Valuation

Given asset `i` with quantity `q_i` (raw units, `d_i` decimals) and price `p_i` (usd18):

### 4.1 Market value

```
marketValue_i = mulDiv(q_i, p_i, 10^d_i)                          [down]
```

### 4.2 Haircut mark

Five haircuts apply in a **fixed order**. Order matters under truncation, so it is frozen
here: market, liquidity, issuer, settlement, crosschain.

```
v = marketValue_i
v = mulDiv(v, BPS - h_market,     BPS)      [down]
v = mulDiv(v, BPS - h_liquidity,  BPS)      [down]
v = mulDiv(v, BPS - h_issuer,     BPS)      [down]
v = mulDiv(v, BPS - h_settlement, BPS)      [down]
v = mulDiv(v, BPS - h_crosschain, BPS)      [down]
haircutMark_i = v
```

Applying them sequentially rather than summing them is deliberate. Summed haircuts can exceed
`BPS` and produce a negative value; sequential application is monotone, bounded in
`[0, marketValue]`, and every intermediate is a real number the UI can explain.

These factors are **not** assumed independent. They are deterministic policy bands set per
asset by governance, not a statistical decomposition.

### 4.3 Stressed exit

The exit curve answers "what would we actually recover if we had to sell this position", and
it is a function of size, not of best bid.

```
exitCurve = [(thresholdUsd18, recoveryBps), ...]     strictly ascending by threshold
```

Selection: take the recoveryBps of the **first tier whose threshold ≥ marketValue**. If the
position exceeds the last threshold, use the **last** tier's recoveryBps — the worst one.
The curve is therefore required to be non-increasing in `recoveryBps`; `RiskPolicyRegistry`
rejects a curve that is not, because a curve that recovers *better* at larger size is not a
liquidity curve, it is a typo.

```
stressedExit_i = mulDiv(marketValue_i, recoveryBps, BPS)           [down]
```

### 4.4 Redemption floor

Redemption is an alternative exit path, available only when the Passport says it is.

```
if passport.redemption.supported:
    redemptionValue_i = mulDiv(marketValue_i, redemptionFloorBps, BPS)   [down]
```

### 4.5 Recognised value

```
candidates = [haircutMark_i, stressedExit_i]
if passport.redemption.supported: candidates += [redemptionValue_i]
recognised_i = min(candidates)
```

**Deviation recorded.** The planning material writes this as
`min(haircutMark, stressedExit, redemptionFloor)` unconditionally. Taken literally, an asset
with no redemption path has `redemptionFloor = 0` and is therefore worth zero as collateral —
which would exclude most tokenized assets, including every one we intend to admit first. The
conditional form above is identical to the literal formula whenever redemption exists, and is
non-binding when it does not. Nothing else about the formula changes.

### 4.6 Concentration

Applied after per-asset recognition, in one pass over the **uncapped** total:

```
T_raw   = Σ recognised_i
capped_i = min(recognised_i, mulDiv(T_raw, maxConcentrationBps_i, BPS))     [down]
T       = Σ capped_i
```

A fixed-point iteration would be marginally less conservative and would cost an unbounded
loop onchain. Single-pass on the uncapped total is deterministic, cheap, and errs toward
recognising less. Documented here so no future implementation "fixes" it into a loop.

---

## 5. Capacity, health and status

```
borrowLimit      = Σ mulDiv(capped_i, initialLtvBps_i,     BPS)     [down]
maintenanceLimit = Σ mulDiv(capped_i, maintenanceLtvBps_i, BPS)     [down]
liquidationLimit = Σ mulDiv(capped_i, liquidationLtvBps_i, BPS)     [down]
```

Policy requires `initialLtv ≤ maintenanceLtv ≤ liquidationLtv < BPS`. `RiskPolicyRegistry`
enforces this on write; there is no valid configuration in which the borrow limit exceeds the
liquidation limit.

```
debt             = mulDivUp(scaledPrincipal, index, WAD)
availableBorrow  = borrowLimit - debt - reservedUsd18        (floored at 0)
healthFactor     = debt == 0 ? type(uint256).max
                             : mulDiv(maintenanceLimit, WAD, debt)
```

`healthFactor < 1e18` means the maintenance requirement is breached.

### 5.1 Status

Status is computed from a total order. `NORMAL < NO_NEW_RISK < REDUCE_ONLY < MARGIN_CALL <
LIQUIDATING < SETTLED < BAD_DEBT`.

```
base =
    debt == 0                    -> NORMAL
    debt <= borrowLimit          -> NORMAL
    debt <= maintenanceLimit     -> NO_NEW_RISK
    debt <= liquidationLimit     -> REDUCE_ONLY
    otherwise                    -> MARGIN_CALL

status = max(base, gateFloor, statusOverride)
```

`gateFloor` is the restriction implied by degraded inputs:

| Condition | Floor |
|---|---|
| any held asset has a stale oracle | `NO_NEW_RISK` |
| any held asset has a stale Passport | `NO_NEW_RISK` |
| any held asset has `CLAIM_CONFLICT` | `NO_NEW_RISK` |
| any held asset is `SUSPENDED` | `NO_NEW_RISK` |
| L2 sequencer down or in grace period | `NO_NEW_RISK` |

Because status is a `max` over a total order, degraded inputs can only ever *restrict*.
There is no code path in which a stale oracle, a stale Passport, or a guardian action makes
an account healthier. That is invariant `I-07`, and it is enforced structurally rather than
by review.

`availableBorrow` is additionally forced to `0` whenever `status > NORMAL`.

### 5.2 Withdrawal

```
canWithdraw(account, asset, amount) =
    simulate removal of `amount`, recompute from scratch, require resulting
    debt <= maintenanceLimit' AND reservedUsd18 == 0 for that asset
```

Full re-simulation, not a linear approximation. Recognised value is not linear in quantity —
the exit curve is a step function and concentration caps interact — so a closed form would be
wrong at exactly the tier boundaries where it matters. The UI finds the maximum safe amount
by bounded binary search over this exact view function, so the number it shows is the number
the contract will accept.

---

## 6. Interest rate model

Two-slope utilisation model, in basis points, per financing market.

```
u = totalBorrows == 0 ? 0 : mulDiv(totalBorrows, BPS, cash + totalBorrows)     [down]

u <= kink :  rate = base + mulDiv(u, slope1, kink)
u >  kink :  rate = base + slope1 + mulDiv(u - kink, slope2, BPS - kink)
```

`rate` is an annualised borrow rate in bps. Supplier yield is
`rate * u * (BPS - reserveFactorBps) / BPS^2`, and the difference accrues to reserves.

Available lender cash and account borrowing capacity are different constraints and are never
conflated. A borrow is limited by `min(availableBorrow, vault.availableCash())`, and when
cash is the binding constraint the UI says so in those words.

---

## 7. Fee conservation

For every financing operation:

```
Δ(vault cash) + Δ(vault receivables) + Δ(reserves) + Δ(insurance) + Δ(user balance) = 0
```

measured in usd18 of the settlement asset. No token balance may become protocol revenue
without appearing on the left-hand side. This is asserted as a Forge invariant over the full
action space, not checked by inspection.

---

## Liquidation settlement and the repair-per-dollar identity

What leaves a borrower is collateral. What that collateral becomes:

```
collateral seized (market) = debt retired
                           + keeper incentive
                           + protocol fee
                           + route loss
```

`route loss` is the gap between the mark and what the route actually returned, realised at
execution. The other three are the split of the proceeds, with debt retirement computed as the
residual so rounding dust falls on the debt rather than into a fee.

A liquidation does **not** repair a breach dollar for dollar, because seizing collateral removes
borrowing capacity as well as debt. Retiring `R` consumes `R(1 + t)` of recognised value, where `t`
is the total take (incentive plus protocol fee), and removes `R(1 + t)m` of maintenance limit at
effective maintenance LTV `m`. So:

```
repairPerDollar = 1 - (1 + t)m
```

At `m = 0.90`, `t = 0.055`: `repairPerDollar = 0.0505`. Curing an $85.76 shortfall on a $791.46 debt
would require roughly $1,700 of repayment, more than the account owes. A single liquidation can
therefore be valid, reduce debt, reduce collateral, and correctly leave the account in
`MARGIN_CALL`. `LiquidationManager.planFor` reports this as `curesTheBreach = false` alongside the
amount that would be required, and bounds the round by a close factor.

This was found by a live liquidation on X Layer testnet, not by unit tests: the seizure matched the
plan, the debt fell, and the account stayed breached.

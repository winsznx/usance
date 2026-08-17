# spec/risk-model.md — why the risk model is shaped this way

Status: **frozen**. The formulas are in `accounting.md` and are not restated here except where a
line of arithmetic is the argument. This document explains **why** each step exists, what failure
it prevents, and how a policy author sets the parameters without producing a configuration that is
valid and wrong.

Every number below is quoted from `fixtures/canonical/risk-scenarios.json` and is reproduced by
`contracts/src/libraries/RiskMath.sol`, `packages/domain/src/risk.ts` and
`scripts/gen_fixtures.py` to the wei. Scenario ids are the fixture ids. Run `make test-differential`
to check any of them.

---

## 1. The question the model answers

Not "what is this worth". Markets answer that.

> **If this account stopped paying right now, what could Usance actually recover, and how much of
> that is safe to have already lent?**

Every stage narrows the answer:

```
quantity × price          what the market says the position is
      ↓ haircuts          what we mark it at between observations
      ↓ exit curve        what a position this size would actually fetch
      ↓ redemption floor  what the issuer's own terms guarantee
      ↓ min()             the exit we would be forced to take, not the one we would choose
      ↓ concentration     how much of one thing we are willing to depend on
      ↓ LTV ladder        how much of that we have already lent
```

A number that survives all seven stages is a number the protocol will enforce onchain.

---

## 2. Why the haircut stack is sequential, not summed

Five haircuts apply in a fixed order (market, liquidity, issuer, settlement, crosschain), each
flooring, each multiplying the running value rather than adding to a running total.

Take `S02`: 1,000 USTBx at $1.00, haircuts 50 / 25 / 100 / 25 / 0 bps.

| Step | Value (usd18) |
|---|---:|
| market value | 1,000.000000000000 |
| × (1 − 0.0050) | 995.000000000000 |
| × (1 − 0.0025) | 992.512500000000 |
| × (1 − 0.0100) | 982.587375000000 |
| × (1 − 0.0025) | **980.130906562500** |
| × (1 − 0.0000) | 980.130906562500 |

Exact: `980130906562500000000`. Summing the same haircuts gives 200 bps and a mark of `980.000000`.
The sequential mark is **13 cents higher**, so this choice is not the more conservative one, and
claiming otherwise would be the kind of comfortable half-truth this document exists to avoid.

`S11` widens the gap. 5,000 NVDAx at $120 is $600,000 of market value with haircuts
400 / 250 / 150 / 100 / 0:

| Method | Mark |
|---|---:|
| sequential | **547,644.24** |
| summed (900 bps) | 546,000.00 |

$1,644.24 apart, and the divergence grows with the size of the haircuts. So why sequential?

**Because summing is not closed under composition.** Nothing bounds the sum of five independently
set parameters. A policy of 40 / 30 / 25 / 15 / 0 bps at the percent scale sums to 110% and
produces a *negative* collateral value, which then has to be clamped somewhere, and a clamp is a
place where a bug hides. The same policy applied sequentially gives
`0.60 × 0.70 × 0.75 × 0.85 = 0.26775`, which is 26.775% of market value: small, correct, and still
a real number.

`RiskPolicyRegistry._validateParams` reflects this. It bounds each haircut individually below
`BPS` and places **no bound on the sum**, which is only safe because the application is
sequential. Change the application and that validation becomes wrong.

Three further properties follow, and each of them is used somewhere:

- **Monotone and bounded in `[0, marketValue]`.** No clamp, no sign check, no special case.
- **Every intermediate is a displayable number.** The UI's "why is this lower than market?" walks
  the same five rows in the table above, because they exist.
- **Order is frozen, so truncation is deterministic.** Each step floors. Reordering the five
  factors changes the last wei, and three implementations have to agree on the last wei.

The factors are **not** assumed statistically independent. They are deterministic policy bands set
per asset by governance, one per named cause of loss, and multiplying them is a composition rule,
not a probability calculation.

---

## 3. Why recognised value is a `min` of three valuations

Each candidate answers a different question about the same position:

| Candidate | Question | Source of truth |
|---|---|---|
| haircut mark | what do we mark this at between observations? | governance policy |
| stressed exit | what would selling this whole position actually fetch? | governance policy, from observed depth |
| redemption floor | what do the issuer's own terms guarantee? | the Passport, from evidence |

They are three different exit routes. In a default Usance takes the route it is left with, not the
one it would prefer, so recognised value is the worst of the routes that exist. Taking a mean, a
median or a weighted blend would recognise value that no single achievable route delivers.

The fixtures make each of the three bind in turn:

| Fixture | Position | Haircut mark | Stressed exit | Redemption floor | Recognised | Binding |
|---|---|---:|---:|---:|---:|---|
| `S02` | 1,000 USTBx @ $1 | **980.130907** | 999.000000 | 990.000000 | 980.130907 | haircut stack |
| `S11` | 5,000 NVDAx @ $120 | 547,644.24 | **486,000.00** | none | 486,000.00 | exit curve |
| `S21` | 1,000 USTBx @ $1, floor 9,000 bps | 980.130907 | 999.000000 | **900.000000** | 900.000000 | redemption |

`S21` differs from `S02` in exactly one field: `redemptionFloorBps` is 9,000 instead of 9,900.
That single evidence-derived number moves recognised value by $80.13 and the borrow limit from
$833.11 to $765.00. That is the whole thesis of the protocol reduced to one fixture.

### The conditional, and why it is not the literal formula

`accounting.md §4.5` records a deliberate deviation from the planning material: the redemption
floor joins the `min` **only when the Passport says redemption is supported**. Taken literally, an
unconditional three-way `min` gives every asset without a redemption path a floor of zero, so it
is worth zero as collateral, so no tokenized equity is ever admissible. `S11` and `S12` carry
`redemptionSupported: false` and `redemptionFloorUsd18: null`, and their recognised value comes
from the two candidates that exist.

This is also the exact boundary of what evidence can do to capacity, and it is stated in full in
`evidence-model.md §7`. Recognised value is bounded above by `min(haircutMark, stressedExit)`,
both of which are governance policy. Evidence can move recognised value anywhere in
`[0, min(haircutMark, stressedExit)]`. It cannot move it above.

---

## 4. The exit curve

### What it models

`V_exit(Q)`, not `P_bestBid`. The curve answers "if we had to liquidate a position of this size,
what fraction of its marked value would we actually realise", and it is a function of size because
that is the variable that destroys recoveries in practice.

```
exitCurve = [(thresholdUsd18, recoveryBps), ...]     strictly ascending in threshold
                                                     non-increasing in recovery
```

Selection takes the recovery of the **first tier whose threshold is at or above the position's
market value**. Past the last threshold the last (worst) tier applies.

`RiskPolicyRegistry._validateCurve` rejects an empty curve, a non-ascending threshold, a recovery
above `BPS`, and a recovery that increases with size. A curve that recovers better at larger size
is not a liquidity curve, it is a typo, and `RiskMath`'s "past the end, use the last tier" rule
depends on the curve being monotone for "last" to mean "worst".

### Worked, from the NVDAx policy

Curve: `(25k, 9950) (100k, 9780) (400k, 9200) (1M, 8100)`.

| Fixture | Market value | Tier selected | Recovery | Stressed exit |
|---|---:|---|---:|---:|
| `S11` | 600,000 | 4th (≤ 1M) | 8,100 bps | 486,000.00 |
| `S12` | 1,200,000 | past the end → last | 8,100 bps | 972,000.00 |

`S12` is the one that matters. There is no "refuse above $1m" in a curve. Past the final threshold
the worst tier keeps applying, linearly, forever. If you would not underwrite an unbounded
position at the last tier's recovery, the last tier is wrong, and the instrument that says "no
more than this" is `maxConcentrationBps` or the asset's status, not the curve.

### How a policy author sets one

Six rules, in order of how often each one is got wrong.

1. **`recoveryBps` is average proceeds over the whole position, not the marginal price at that
   depth.** `stressedExit = marketValue × recoveryBps / BPS` multiplies the entire position by one
   number. A curve authored from marginal book depth systematically overstates recovery.
2. **Thresholds are market value in `usd18`, not quantity.** The same curve serves a $1 token and
   a $120 token because size is measured in dollars.
3. **A tier's recovery covers everything above the previous threshold up to and including its
   own.** Selection is `marketValue <= threshold`, so the boundary belongs to the *better* tier.
4. **The gap between adjacent tiers is a cliff, and you are choosing its height.** On the NVDAx
   curve a position of exactly $400,000 selects 9,200 bps and recognises $368,000 of stressed
   exit. One wei more selects 8,100 bps and recognises $324,000. A single wei of deposit removes
   $44,000 of recognised value. That is a legitimate model of a real liquidity cliff, and it is
   why `ClearingHouse.maxWithdrawable` binary searches the exact simulation instead of
   interpolating: a linear approximation is wrong precisely at the boundary where users push.
   If a $44,000 discontinuity is not what you meant, add tiers.
5. **Source it from observed executable depth, not from a quote at decision time.** The curve is
   governance state. A manipulated pool cannot move it, because nothing reads a pool.
6. **The curve belongs to the policy, not the asset.** Every asset bound to a policy shares its
   curve. Two assets with different depth need different policies.

### What the curve does not model

Time. It is a function of size only, so "liquidate $600k over a week" and "liquidate $600k in the
next block" produce the same number. It also prices one account in isolation: ten accounts
liquidating the same asset simultaneously each see the single-position curve. Both are known
simplifications, not oversights, and both err optimistic. The haircut stack is where a policy
author buys that margin back.

---

## 5. Concentration

```
T_raw    = Σ recognised_i
capped_i = min(recognised_i, T_raw × maxConcentrationBps_i / BPS)
T        = Σ capped_i
```

One pass, against the **uncapped** total. Worked on `S13`, a portfolio of 10,000 USTBx at $1 and
1,000 NVDAx at $120:

| | USTBx | NVDAx |
|---|---:|---:|
| market value | 10,000.000000 | 120,000.000000 |
| recognised | 9,801.309066 | 109,528.848000 |
| `maxConcentrationBps` | 10,000 | 6,000 |
| cap = `T_raw × bps / BPS` | 119,330.157066 | **71,598.094239** |
| capped | 9,801.309066 | 71,598.094239 |

`T_raw = 119,330.157065625`, `T = 81,399.403305`. Exact:
`rawTotal = 119330157065625000000000`, `cap_NVDA = 71598094239375000000000`.

Two consequences that a policy author has to internalise, because neither is obvious from the
parameter's name.

**A single-asset portfolio caps itself.** In `S11` the account holds only NVDAx. `T_raw` equals
that asset's recognised value, so the cap is `0.60 × 486,000 = 291,600`, and recognised value
drops 40% purely because a concentration limit exists. `maxConcentrationBps` on a lone position is
a straight multiplier, not a diversification requirement. If you do not want that, the value is
`10_000`.

**The nominal cap is not the resulting share.** After capping, NVDAx is `71,598.09 / 81,399.40`,
about **88%** of the recognised total, not 60%. `maxConcentrationBps` bounds an asset's share of
the *uncapped* total, which is a different quantity from its share of the total that actually
backs the loan.

`accounting.md §4.6` freezes the single pass and records the reason as cost and determinism, since
converging a fixed point costs an unbounded loop onchain. On the direction of conservatism, note
what converging would actually produce here: a self-consistent solution requires
`capped_NVDA = 0.6T` and `capped_USTB = 9,801.309066`, giving `T = 9,801.309066 / 0.4 = 24,503.27`
against the single pass's `81,399.40`. The converged answer recognises far less, not more. The
single pass is the frozen behaviour and the tested one; a future RFC that wants concentration to
bind on the final total has to change the formula, not reinterpret it.

---

## 6. The LTV ladder and the status bands

```
borrowLimit      = Σ capped_i × initialLtvBps_i     / BPS
maintenanceLimit = Σ capped_i × maintenanceLtvBps_i / BPS
liquidationLimit = Σ capped_i × liquidationLtvBps_i / BPS
```

All three sum over the **capped** value, all three round down, and
`initialLtv ≤ maintenanceLtv ≤ liquidationLtv < BPS` is enforced on every policy write (`I-13`).
There is no reachable configuration in which the borrow limit exceeds the liquidation limit.

Three thresholds rather than one, because a binary cliff at a single number turns every ordinary
price move into a liquidation. On the `S02` position the ladder is $833.11 / $882.12 / $911.52, and
the fixtures walk an account up it:

| Fixture | Debt | Status | Available borrow | Health factor |
|---|---:|---|---:|---:|
| `S03` | 500.00 | `NORMAL` | 333.111271 | 1.764236 |
| `S04` | 880.00 | `NO_NEW_RISK` | 0 | 1.002407 |
| `S05` | 900.00 | `REDUCE_ONLY` | 0 | 0.980131 |
| `S06` | 990.00 | `MARGIN_CALL` | 0 | 0.891028 |

`S04` is the band worth understanding. The account is above its initial-LTV limit and below
maintenance: it can no longer add risk, and it is not in trouble. That gap, $833.11 to $882.12,
is $49 of room for the market to move without anything happening to the user. Collapse the three
thresholds into one and that room disappears.

Health factor is `maintenanceLimit × WAD / debt`, floored, `type(uint256).max` when debt is zero.
Because it is defined against the maintenance limit, `healthFactor < 1e18` is exactly equivalent
to `debt > maintenanceLimit`, which is exactly the `REDUCE_ONLY` boundary. `S05` sits at 0.980131
and `S04` at 1.002407, on either side of the same line. One number, one meaning, no separate
calibration to keep in sync.

---

## 7. What the gates protect against

A gate is not a valuation input. It is a statement that an input Usance depends on is no longer
trustworthy, and it acts by flooring `status` at `NO_NEW_RISK` and forcing `availableBorrow` to
zero.

| Gate | Fires when | Fixture | The failure it prevents |
|---|---|---|---|
| `ORACLE_STALE` | `now − priceUpdatedAt > maxOracleAge` | `S07` (86,401s vs 86,400s) | lending against a price that stopped tracking the market |
| `ORACLE_INVALID` | `priceUsd18 == 0` | `S22` | treating a reverting or non-positive feed answer as a price |
| `PASSPORT_STALE` | `now − passportCommittedAt > maxPassportAge` | `S08` (604,801s vs 604,800s) | lending against terms that may already have been superseded |
| `CLAIM_CONFLICT` | `passportStatus == CONFLICTED` | `S09` | resolving a disagreement about what an asset legally is by picking one reading |
| `ASSET_SUSPENDED` | asset or Passport suspended | `S10` | extending new credit against an issuer or instrument under investigation |
| `SEQUENCER_DOWN` | uptime feed reports down, or is unreadable | `S17` | pricing against a market nobody can arbitrage into |
| `SEQUENCER_GRACE` | `now − lastRestartAt < gracePeriod` | `S18` (600s into 3,600s) | the queued-transaction burst immediately after an L2 restart |

Four design decisions are visible in that table.

**Gates cap capacity, they do not change value.** `S07` still recognises $980.130907 with a stale
oracle. Zeroing recognised value on a stale feed would push the account straight past the
maintenance and liquidation limits and make it liquidatable because a heartbeat was late. Refusing
new risk is proportionate to an operational fault; forced liquidation is not.

**Every exit stays open.** Repay, add collateral and withdraw-within-maintenance work under every
gate. `Lifecycle.t.sol::test_staleOracleBlocksNewRiskButNotRepayment` and
`test_suspendedAssetKeepsExitPathsOpen` hold that line. A protocol that traps users during its own
degradation has converted an operational fault into a credit event.

**A zero balance raises no gate.** `RiskMath.assetGates` returns immediately when
`quantity == 0`. Without that, one retired asset in an account's history would freeze the account
permanently.

**The floor is uniform, the diagnosis is not.** All seven gates produce the same
`NO_NEW_RISK` floor, which keeps `status` a total order and keeps `I-07` structural. The `gates`
bitmask carries the distinction, and `packages/domain`'s `GATE_COPY` turns each bit into the
sentence a user needs, including what they can still do.

`I-07` is the reason this is a `max` over a total order rather than a chain of conditionals:
`status = max(base, gateFloor, statusOverride)`. There is no arrangement of degraded inputs, no
guardian action, and no combination of the two that produces a lower status or a higher
`availableBorrow` than the same account with clean inputs. `S19` is the guardian half: a debt-free
account with $833.11 of capacity, floored to `REDUCE_ONLY`, available borrow zero.

---

## 8. Reservations and interest

**Reservations remove capacity at the moment of commitment, not at fill.** `S15`: borrow limit
$8,331.112706, debt $1,000, reserved $2,000, available borrow $5,331.112706. The reservation is
the budget an in-flight execution is allowed to consume, and `ClearingHouse` debits against the
reservation rather than against the account (`I-19`). An execution whose result is unknown
releases nothing, because "we do not know" and "it did not happen" are different states, and
treating them alike frees capital that is already spent (`I-23`).

While any reservation is outstanding, `withdrawCollateral` refuses outright and `maxWithdrawable`
returns zero. Simulating a withdrawal against capital that a venue may be about to consume is a
race, and the cheap correct answer is to not race.

**Debt rounds up and limits round down, always.** `S16`: 4,000 units of scaled principal against a
borrow index of 1.0537 reconstructs to exactly $4,214.80, leaving $4,116.312706 available against
the same $8,331.112706 limit. The two rounding directions are chosen per quantity in
`accounting.md §1.2` so that both errors, each at most one wei, favour the protocol. That is also
why `repayAll` is a distinct code path that zeroes `scaledPrincipal` outright instead of trusting
arithmetic to land on zero: dust debt that survives a full repayment is an account that can never
be closed.

**Truncation is the dust policy.** `S20` deposits one wei of an 18-decimal token at $1. Market
value is 1 wei of `usd18`; the first haircut floors it to zero; every downstream value is zero;
nothing underflows and the account stays `NORMAL` with unbounded health. There is no minimum
position size anywhere in the pipeline and none is needed, because rounding down at every stage
already collapses dust to nothing.

---

## 9. Setting a policy

The order below is the order in which the parameters constrain each other. Working in a different
order produces a configuration that validates and misprices.

1. **Exit curve first.** It is the only parameter derived from an external measurement, and it
   sets the ceiling everything else works under. Average proceeds, whole position, dollar
   thresholds, worst tier acceptable at unbounded size.
2. **Haircuts second, one per named cause.** Market for what moves between observations, liquidity
   for spread and impact *not already in the curve*, issuer for structure and counterparty,
   settlement for the redemption or delivery mechanism, crosschain for message and escrow risk on
   a remote asset. Double-counting liquidity in both the curve and `haircutLiquidityBps` is the
   most common authoring error, and it is invisible because the result is merely conservative.
3. **Concentration third**, read as a multiplier on the uncapped total (§5). `10_000` if you do
   not want one.
4. **LTV ladder last.** These apply to the *capped recognised* value, which is already well below
   market. An 8,500 bps initial LTV on the `S02` T-bill is 83.3% of market value, not 85%. Leave
   real distance between initial and maintenance, since that gap is the user's room to be wrong.
5. **`maxOracleAge` above the feed's heartbeat, with margin.** The Chainlink Data Feeds live on X
   Layer publish on an 86,400-second heartbeat (`docs/INTEGRATIONS.md`). A `maxOracleAge` at or
   below the heartbeat gates the asset every cycle, and the fixture policies are illustrative
   values against synthetic feeds, not a recommendation to copy.
6. **`maxPassportAge` from how fast the evidence actually changes.** A prospectus that is amended
   annually and a redemption notice that changes weekly are not the same freshness problem.

Every write here advances `riskEpoch`, and any change `RiskPolicyRegistry._increasesRisk`
classifies as risk-increasing (a higher LTV at any tier, a smaller haircut, a larger concentration
allowance, a longer tolerated staleness) waits out a 2-day timelock and can be cancelled by a
guardian. Risk-reducing changes take effect immediately. The asymmetry is the safety argument, and
it is enforced by comparing proposed parameters against live ones rather than by trusting a caller
to classify their own change.

---

## 10. What this model is not

Stated so nobody mistakes silence for coverage.

- **Not a correlation model.** Concentration is per asset against a total. Two assets that always
  move together are two independent lines in the sum.
- **Not a time model.** The exit curve has no urgency axis, and there is no liquidation-horizon
  parameter anywhere.
- **Not a market model.** Nothing reads a pool, a book, or a quote at decision time. Every
  liquidity assumption is governance state, which is what makes it unmanipulable and also what
  makes it only as fresh as governance.
- **Not a probability model.** No haircut is a confidence interval, no LTV is a VaR, and nothing
  here estimates a loss distribution. They are deterministic policy bands.
- **Not a systemic model.** One account at a time, in isolation.
- **Not complete.** Liquidation is specified and unbuilt (`I-11`), so the model currently describes
  the bands an account moves through without describing what happens at the bottom of them. The
  waterfall in `threat-model.md §2` (user equity, then penalties and reserves, then insurance,
  then the affected vault) is the intended answer and has no code.

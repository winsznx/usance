---
description: Evidence to Passport to recognised value to capacity, and the risk machinery over it.
---

# How Usance works

Everything Usance does follows one chain: **evidence → Passport → recognised value → capacity**,
governed by a deterministic risk policy. Each step is inspectable, and each number cites the step
before it.

## 1. Evidence

For a supported asset, Usance fetches the issuer's own public filing, hashes it so the exact
document is pinned, and extracts a structured set of claims from it. Two independent extraction
paths are run where possible. If only one produces a reading, the resulting Passport is marked
**single-source** and capped by policy rather than trusted at full value.

## 2. The Passport

The extracted claims are committed on-chain as a **Passport**, a versioned, hash-anchored record
of what the asset legally is: issuer, rights, custody, redemption window, transfer rules, and how
corporate actions are handled. Passports are versioned because filings change, so a new filing
produces a new version rather than silently overwriting the old one.

## 3. Recognised value

Market value is what an asset is quoted at. **Recognised value** is what Usance is willing to lend
against, and it is deliberately lower. Starting from market value, Usance applies a set of named
haircuts in a fixed order, then floors the result at the worse of a **stressed-exit** estimate
(what the position would realise if it had to be sold quickly) and, where one exists, a redemption
floor.

The gap between market and recognised value is **not a fee**. Nobody takes it. It stays in your
deposit and you can withdraw it. Usance simply will not _lend_ against the part of the value it
could not defend under stress. Every haircut is shown, and each asset's row states which bound
(policy or stressed size) was the binding one.

## 4. Capacity and borrowing

Your **borrowing capacity** is derived from recognised value. Two limits are always kept separate,
because they have opposite remedies:

* **What your collateral supports.** Raised by depositing more collateral.
* **What lenders can currently fund.** Raised only when lenders supply more liquidity, never by
  adding collateral.

Borrowing draws settlement liquidity against your recognised value while your assets stay where
they are. Repaying is always available, in every account state, because it reduces risk.

## 5. Risk epochs

Every quote Usance produces is stamped with a **risk epoch**, the version of the policy and inputs
it was computed under. If policy or the evidence moves between the moment you were quoted and the
moment you sign, the transaction is **refused** rather than executed under rules you never saw. This
is why a stale preview never silently goes through at the wrong number.

## 6. The account status ladder

An account's status is **recomputed from live inputs on every read**. It is never a stored flag
that a background job might leave stale. The ladder, in plain terms:

| Status | What it means |
| --- | --- |
| **Normal** | Nothing restricted. |
| **No new risk** | New borrowing is paused (recognised value fell, or an input became untrustworthy). Repay, add collateral, and withdraw-within-limit stay open. |
| **Reduce only** | Withdrawal is also paused. Repaying or adding collateral restores it. |
| **Margin call** | Debt is above the maintenance limit, and a liquidator may take part of the collateral. You can stop it by curing the shortfall. |
| **Liquidating** | Collateral is being sold to reduce the debt. |

## 7. Liquidation

When an account is below its maintenance requirement, a liquidator may repay part of the debt in
exchange for a portion of the collateral. Usance takes the part the breach requires and leaves the
rest. Liquidation is **partial and priced**, ranked on what a route is expected to actually
recover (fees, latency, and the chance it does not complete at all) instead of the price it quotes.
Because seizing collateral removes borrowing capacity along with debt, a single round often
reduces the position without fully curing it, and the receipt says so rather than implying more.

Every one of these steps writes a public receipt. See [Security and authority](security.md) for who
is allowed to act, and [Networks and what is live](networks.md) for what is executable today.

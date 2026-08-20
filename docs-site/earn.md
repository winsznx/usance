---
description: Supply the settlement asset borrowers draw against, and earn what they pay.
---

# Earn

The lending side of Usance. Borrowers post assets Usance has read and priced; you supply the
**settlement asset** they draw against and earn the financing they pay.

## What the page shows — and what it refuses to

Usance deliberately does **not** show an "Earn 8.4% APY" card. A headline APY is a projection
dressed as a promise: realised lender yield depends on utilisation, on borrowers repaying, and on
whether anything defaults. Instead the vault shows what can actually be read from the contract:

* **Total supplied**, **utilisation**, **available cash**, and **deployed principal** — where the
  money currently is.
* **What borrowers pay right now**, split into the protocol's share and the share that accrues to
  lenders. This is the current rate, not a forecast of what you will earn.

## Getting your capital back

Capital that is lent out cannot be redeemed on demand. What you can take today is the vault's
**available cash**. Redemptions that cannot be paid now join a **withdrawal queue** that is paid in
order, ahead of new lending. Your shares are burned when you join the queue, so a later default
cannot shrink a claim you have already exited.

## Losses

A **reserve** absorbs the first loss. Only what the reserve cannot cover reduces lender value, and
losses stay **inside the vault for that asset** — they are never spread to lenders who supplied
against a different asset.

Every figure on the page is read from the deployed contract; where one cannot be read, the field
says so rather than rendering a zero that reads like a fact. On testnet the settlement asset is a
labelled stand-in (`tUSD`) with no real value — see [Networks and what is live](networks.md).

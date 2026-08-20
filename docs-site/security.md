---
description: What a connection, a session, an allowance, a mandate and a transaction each grant.
---

# Security and authority

Usance is **non-custodial**: it never holds your keys or your assets, and every action is a
transaction you sign yourself. The risk, then, is not that Usance takes something — it is that you
grant more authority than you meant to. Five different things get loosely called "connected," and
they are not the same.

## The five grants

| Grant | What it lets happen | When it ends |
| --- | --- | --- |
| **Wallet connection** | A site can _see_ your address and _ask_ you to sign. It cannot move anything. | When you disconnect — but the site can reconnect silently on your next visit. |
| **App session** | Proves you control the address (a signature), so Usance shows _your_ account. Kept only in your browser. | When you sign out, or clear the browser. Never leaves your device. |
| **Token allowance** | Lets a specific contract move up to a specific amount of one token. | When you set it back to zero. Usance requests exact amounts, not unlimited ones. |
| **A mandate** | Lets a named agent act on your account, inside limits you sign. | When it expires or you revoke it — revocation is immediate and permanent. |
| **A transaction** | Does one specific thing, once. | Immediately; it grants nothing ongoing. |

Two of these — allowances and mandates — **outlive closing the browser**, because they live
on-chain rather than in a tab. Disconnecting a site does not repay a debt, close a position, or
revoke a mandate.

## A mandate

A mandate is a signed, bounded delegation. It can only ever **narrow** what the protocol already
allows — it can never widen it. When you sign one you see, before your wallet opens, exactly which
actions it grants, the caps, the expiry, and the agent it authorises.

The load-bearing rule: **withdrawal of collateral is not a delegable action.** There is no
withdrawal action in the mandate vocabulary at all, so an agent cannot move your collateral out
even if you signed a mandate granting everything. A mandate can let an agent repay debt or add
collateral — actions that reduce risk — and nothing that removes value from your account.

Revocation is **terminal**: the registry has no un-revoke function on any path. Re-authorising an
agent means signing a new mandate.

## Sentinels: automation you can bound

A **Sentinel** is a bounded autonomous agent built on this mandate model — for example, one that
repays a little debt to hold a safety buffer when your account approaches its limit. The guarantees
are the same ones the mandate gives, made explicit:

* Every action is checked as `AllowedAction = ProtocolAllows ∧ MandateAllows`, re-read against live
  state before it submits. AI may _observe_ and _propose_; deterministic policy and your signed
  mandate _decide_.
* A compromised agent still cannot exceed the mandate, cannot borrow or trade, cannot withdraw
  collateral, and cannot widen its own permissions.
* You can pause or revoke it at any time, and revocation is immediate and permanent.

## Verifying instead of trusting

Every financial action writes a public receipt that cites the transactions behind it. Anyone can
open a receipt and check it against the chain without a wallet — so a counterparty can confirm a
claim without taking your word, or Usance's.

---
description: Delegate a bounded, signed authority to an agent — and revoke it in one transaction.
---

# Mandates

A **mandate** lets an agent act on your account inside limits you sign. Its defining property is
that it can only ever **narrow** what the protocol already allows — never widen it. It is the
foundation the [Sentinels](sentinels.md) are built on.

## Start from a template

Each template grants the narrowest set of actions that achieves its purpose; you adjust the limits
before signing. For example:

* **Maintain a safety buffer** — the agent repays debt on your behalf as the account nears its
  maintenance limit. It can only reduce your risk.
* **Repay automatically** — the agent repays from its own balance. It can never draw new debt or
  move your collateral.
* **Top up collateral** — the agent adds collateral it funds itself. Your balance is never charged.

## Which actions are delegable

| Action | Delegable? |
| --- | --- |
| Repay your debt | **Yes** |
| Add collateral | **Yes** |
| Borrow against your collateral | No |
| Trade your exposure | No |
| Open / close a hedge | No |

The refusals are deliberate. **Withdrawal of collateral is not in the mandate vocabulary at all**,
so no agent can move your collateral out even under a mandate granting everything. Trade, hedge and
close are refused because no external-venue path is wired yet — granting them would authorise an act
with nowhere to go. Borrowing is refused until every bound is enforced end to end.

## Limits

When you create a mandate you set, and see before your wallet opens: the authorised agent, a debt
ceiling and how much has been drawn against it, a notional ceiling and slippage cap (for actions
that become available later), and an expiry. The mandate detail page reads these **from the chain**,
with expiry folded into the status, so "what can this agent do to me right now" is always current —
which matters most at the moment you are trying to revoke.

## Revocation is terminal

Pausing suspends an agent without losing anything. **Revoking is permanent** — the registry has no
un-revoke function on any path. Re-authorising an agent means signing a new mandate with a new
nonce. Both are single transactions from your wallet.

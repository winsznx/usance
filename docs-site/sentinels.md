---
description: Bounded autonomous agents that can only ever reduce your risk.
---

# Sentinels

A **Sentinel** is a bounded autonomous agent that acts on your account within a mandate you sign —
for example, repaying a little debt to hold a safety buffer when the account approaches its limit.
It is the mandate model made autonomous, with the boundaries kept explicit.

The one rule everything else follows: **AI is not a financial authority.** A Sentinel may _observe_
state and _propose_ an action, but a deterministic policy and your signed [mandate](mandates.md)
_decide_ what is allowed. Every action is checked as:

```
AllowedAction = ProtocolAllows ∧ MandateAllows
```

re-read against live state immediately before it submits.

## What a Sentinel can never do

Even a fully compromised agent key:

* cannot exceed the mandate you signed;
* cannot borrow, trade, or open a hedge;
* **cannot withdraw your collateral** (there is no such action to delegate);
* cannot widen its own permissions.

You can **pause or revoke** any Sentinel at any time. Revocation is immediate and permanent, and a
revoked mandate refuses the agent's next attempt on-chain.

## The library

The **Sentinel Library** lists published strategy templates from the committed on-chain manifest —
publisher, version, risk class, the exact actions and trigger classes it requires, its fee model,
and audit status. A template holds **no authority and contains no executable code**: it is a
declarative, versioned manifest. Statistics are shown as zero until real runs exist, never as
invented ROI.

### Safety Buffer (T1)

The first template. It is **risk-reducing only** — it may `REPAY` and `ADD_COLLATERAL`, nothing
else — and it acts to keep your account above a safety threshold you configure.

## Arming one

From **Arm a Sentinel** you see the full permission preview — every action it may take, and the
explicit list of what it cannot (borrow · trade · withdraw collateral) — **before your wallet
opens**. Arming is two transactions: the EIP-712 **mandate** the agent acts under, then the
**instance** that pins the template and its manifest hash. A mismatched template is refused, never
guessed.

## The autonomy plane

Every run passes through the same auditable sequence, and each step writes evidence:

**observe → trigger → snapshot → plan → validate → authorize → reserve → execute → reconcile →
receipt.**

A run that is refused before submission is a real, recorded outcome — the receipt says so rather
than implying an action occurred. A public run timeline at `/sentinels/runs/…` shows exactly what a
Sentinel observed, why it acted, what it executed on-chain, and what changed — with no wallet
required. A live autonomous repay is recorded on the [proof explorer](networks.md).

Publishers can read the publishing contract at `/developers/sentinels`; see
[For developers](developers.md).

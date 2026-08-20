---
description: Connect, deposit, borrow, repay, withdraw — and where to check what happened.
---

# Using Usance

Usance is non-custodial, so everything here is a transaction you sign from your own wallet. Nothing
below moves value without your signature, and every number is quoted before you sign it.

## Connecting

Usance asks for a wallet **once**, on its own onboarding screen — and it asks for a _signature_,
not just a connection. That signature is your **session**, stored only in your browser. Signing out
(in Settings) clears it locally; it never touches anything on-chain, and it does not close a
position or repay a debt. See [Security and authority](security.md) for the difference between
connecting, a session, an allowance and a mandate.

## Add collateral

Depositing an admitted asset shows you the single most important, most surprising number first:
its **recognised value**, which is lower than its market value. The gap is not a fee — it stays in
your deposit and you can withdraw it — it is the part Usance will not lend against because it could
not defend it under stress. The deposit screen shows the market value, each haircut, and the
recognised amount before you sign.

Depositing takes two signatures: an **approval** for exactly the amount (never unlimited), then the
deposit itself.

## Borrow

Borrowing draws settlement liquidity against your recognised value while your assets stay put. The
screen keeps two limits visibly separate, because they have opposite remedies:

* **What your collateral supports** — raise it by depositing more collateral.
* **What lenders can currently fund** — raise it only by waiting for lenders to supply more;
  adding collateral will not.

The rate is shown as an annual figure and is variable. Every quote is stamped with a
[risk epoch](how-it-works.md#5-risk-epochs); if policy moves before you sign, the borrow is refused
rather than executed at a number you never saw.

## Repay

Repaying is available in **every** account state — it reduces risk, so it is never blocked, and it
is the action that returns a restricted account to normal.

One thing to know: closing a loan costs slightly **more than you borrowed**. Your debt is principal
plus accrued interest, and only the principal was ever paid out to you. The repay screen quotes the
full payoff and offers a "repay everything" option that sends the instruction to close the loan
exactly, rather than a fixed amount that would leave dust behind.

## Withdraw

Withdrawing collateral is genuinely gated, because taking collateral out while in debt increases
risk:

* With **no debt**, your collateral is yours to withdraw in full, in any protocol state.
* With debt, you can withdraw whatever is not needed to cover it. A restricted account status
  pauses withdrawal entirely until you repay or add collateral.

## See your position and what happened

* **Position** shows recognised collateral, debt, available-to-borrow, your safety buffer, and the
  status ladder — all recomputed live, never cached.
* **Activity** lists every action Usance recorded, each linking to a receipt. It is not a full
  wallet history: Usance runs no indexer, so anything done directly against the contracts is real
  and on-chain but will not appear here — the page says so rather than implying completeness.
* Every receipt has a **public version** at `/proof/…` that needs no wallet, so a counterparty can
  verify a claim without your account context. Opening it from inside the app opens a new tab, so
  you keep your dashboard.

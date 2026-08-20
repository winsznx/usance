---
description: Make tokenized assets usable as capital.
---

# Introduction

Usance is a clearing and risk layer on [X Layer](networks.md). It reads what a tokenized asset
actually is, recognises a conservative portion of it as collateral, and lets you finance against
that portion without selling — while telling you, line by line, exactly how it arrived at the
number.

## The problem

Tokenization tells a chain that an asset _exists_. It does not tell the chain what the asset is
worth as collateral, what could be recovered if it had to be sold under stress, or what rights the
holder actually has. So most tokenized real-world assets sit idle: you can hold them and transfer
them, but you cannot safely borrow against them, because nothing on-chain has done the work of
turning an issuer's filing into a number a lender can trust.

## What Usance does

Usance does that work, and shows it.

* **Reads the evidence.** For every supported asset it fetches the issuer's own filing, hashes it,
  and extracts a structured, versioned set of claims — legal rights, custody, redemption terms,
  transfer restrictions. That becomes the asset's **Passport**.
* **Recognises a conservative value.** Market price is not liquidation value. Usance recognises
  only the portion it could defend under stress, applying named haircuts in a fixed order and
  flooring the result at a stressed-exit estimate. The recognised value is deliberately lower than
  the market value, and every deduction is visible.
* **Lets you finance against it.** Borrow settlement liquidity against the recognised value, keep
  the exposure, and repay whenever you want to take the asset back. The position stays yours the
  entire time.
* **Bounds any automation.** You can delegate a narrow, signed [mandate](security.md#a-mandate) to
  an agent — for example, to maintain a safety buffer — inside limits you set. It can only ever
  reduce risk, never widen your permissions, and never withdraw your collateral.
* **Proves every step.** From the original document to the final on-chain state, each action writes
  a public receipt that anyone can verify without a wallet.

## What Usance is not

* **It is not custodial.** Usance never holds your keys or your assets. Every action is a
  transaction you sign from your own wallet.
* **It does not invent numbers.** Where a value cannot be read from the chain or the evidence, the
  interface says so rather than showing a plausible-looking placeholder.
* **It is not live with real value yet.** Usance currently runs on X Layer **testnet** with
  labelled test stand-ins. See [Networks and what is live](networks.md) for exactly what is and is
  not executable today, and the path to mainnet.

## Where to go next

* [**How Usance works**](how-it-works.md) — evidence to Passport to recognised value to capacity,
  and the risk machinery that governs it.
* [**Security and authority**](security.md) — the difference between a connection, a session, an
  allowance and a mandate, and why withdrawal can never be delegated.
* [**Networks and what is live**](networks.md) — testnet today, the mainnet plan, and an honest
  integration status.

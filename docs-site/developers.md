---
description: Read the chain, verify receipts, attribute writes, and publish a Sentinel template.
---

# For developers

Usance is built to be read and checked, not taken on faith. This is where to start if you are
integrating with it, verifying it, or publishing on it.

## Everything is verifiable

Every financial action writes a **receipt** that cites the transactions behind it, and every
receipt has a public page at `/proof/…` that needs no wallet. The receipt model is a single shared
schema, so the public proof and a user's own activity view can never disagree about the same event.
A receipt is refused the `CONFIRMED` status unless it can cite a successful transaction — "it
happened" is never assertable without the hash.

## Reading chain state

The interface reads directly from the deployed contracts on [X Layer](networks.md) rather than from
an indexer or cache, and re-reads on every request — which is why an account status is never stale.
There is no Usance indexer yet, so anything done directly against the contracts is real and on-chain
but will not show up in the app's own activity list; that is stated in the product rather than
hidden.

## Attribution

Every write path carries an **ERC-8021 builder-code suffix** in its calldata, and Usance decodes
that attribution back out of the submitted transaction rather than assuming it because a helper
supports it. The builder code is configured with `USANCE_BUILDER_CODE`.

## Typed schemas

The domain types — mandate actions, Sentinel templates and instances, budgets, runs, snapshots,
receipts — are strict, shared schemas (zod + viem) used identically by the contracts' expectations,
the runtime, and the interface. That is what lets three independent implementations of the valuation
and risk logic agree to the wei.

## Publishing a Sentinel template

A [Sentinel](sentinels.md) template is a **declarative, versioned manifest** — it holds no user
authority and contains no executable code. Publishing commits a manifest (publisher, risk class,
the exact actions and trigger classes it requires, fee model, schema hashes) to the on-chain
registry, under immutable sequential versions with bounded fees. An installed instance pins a
specific template version and its manifest hash; a mismatch is refused rather than guessed.
`/developers/sentinels` documents the publishing contract.

## What needs access

Some integrations are intentionally not live and are disabled rather than simulated: ChainGPT
evidence extraction (no API key configured caps extraction to a single, marked path) and external
venue execution for hedging/trading (no builder deployment access). The current, reproducible state
of every integration is on the [status page](networks.md) and at `/status` in the app.

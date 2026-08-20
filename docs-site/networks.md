---
description: Testnet today, the mainnet plan, and an honest integration status.
---

# Networks and what is live

Usance is built to settle on [X Layer](https://web3.okx.com/xlayer), OKX's Ethereum L2. This page
is the honest account of what actually runs today. The principle is simple: anything Usance cannot
do yet is disabled in the product with the reason shown, never replaced by a simulation dressed up
as the real thing.

## Testnet today

Usance is deployed on **X Layer testnet (chain 1952)**. The tokens it works with there — `tUSTB`,
`tUSD` — are **labelled test stand-ins with no monetary value**. They are not FOBXX, OUSG, ARCOIN,
USDC, or any issuer's token. Testnet exists to prove the mechanics end to end: reading a filing,
committing a Passport, recognising a conservative value, borrowing and repaying, liquidating a
breached account, and running a bounded agent — all on-chain, all with public receipts.

**X Layer mainnet (chain 196)** contracts are **not yet broadcast** — the deployer is unfunded. So
there is nothing with real value to execute against yet. That is a deployment step, not a missing
feature.

## What is live, what needs access, what is not on X Layer

| Capability | State | Note |
| --- | --- | --- |
| X Layer settlement | **Live** | Chain 196 / 1952, verified against the live RPC. |
| Chainlink price feeds | **Live** | 26 Data Feeds on X Layer, read back on-chain. |
| Evidence → Passport → capacity | **Live** | Deterministic; independent implementations agree to the wei. |
| Builder Code attribution | **Live** | ERC-8021 suffix on every write path. |
| Delegated mandates + Sentinels | **Live (testnet)** | Bounded delegation and an autonomous repay proven on testnet. |
| ChainGPT extraction | **Needs access** | No API key configured, so single-path extraction is capped, not silently trusted. |
| Exchange OS execution (hedge/trade) | **Needs access** | No builder deployment access; those actions are disabled, not simulated. |
| Chainlink Data Streams | **Not on X Layer** | Adapter retained; nothing routes through it. |

Every claim above is reproducible against the network.

## The path to mainnet

The plan to make Usance usable with real value from day one:

1. **Deploy to X Layer mainnet (196)** using the same scripts proven on testnet, with governance
   and guardian roles held by separate addresses (not the deployer).
2. **Admit a small set of real assets that exist on X Layer** — starting with **USDC** as
   settlement and collateral, and **xStocks** (the tokenized stocks X Layer is bringing liquidity
   to). Each asset needs a committed Passport built from its issuer's filing and a live price feed;
   X Layer's Chainlink feeds already provide the pricing.
3. **Day-one user flow:** connect a wallet, deposit a supported real asset, see its recognised
   value, and borrow settlement liquidity against it — or arm a Safety Buffer Sentinel. Deposit,
   borrow, repay, and bounded automation are executable against real assets on day one.

Trading and hedging execution remain gated until external-venue access is granted; they will stay
disabled rather than faked until then.

## Configuring a deployment

The public site origin is set with `NEXT_PUBLIC_SITE_URL` (the production domain,
`https://usance.xyz`), which is what social link previews and absolute URLs resolve against. Email
capture stores addresses in Supabase via `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`; until those
are set, the subscribe form reports that it is not configured rather than pretending to store.

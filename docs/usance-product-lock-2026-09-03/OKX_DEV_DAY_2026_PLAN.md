# OKX_DEV_DAY_2026_PLAN.md

## Primary track

**X Layer: Tokenized stocks and RWA**

## Product delta

Usance should not submit the old X Layer build unchanged.

Build the first production-shaped **xStocks market domain**.

## One-line product

> **Use xStocks as programmable collateral and financing inventory on X Layer.**

## Why OKX/X Layer should care

Trading creates one capital event.

Financing lets the same RWA position create:

- collateral demand;
- stablecoin borrowing;
- lender demand;
- trading/hedging;
- repayment;
- liquidation/keeper flow;
- repeated capital turns.

Usance should measure:

`capital velocity = financed activity / average recognized collateral`

not manufactured volume.

## Required new work

### Instrument admission

- xStocks exact issuer/address registry;
- legal/product Passport;
- issuer/custody/redemption;
- corporate action/multiplier;
- transfer restrictions.

### Accounting

- rebase-aware custody;
- share of multiplier changes;
- no orphan balance;
- no user over/under-credit after corporate action.

### Market risk

- market-session state;
- exact Chainlink product per xStock;
- price + freshness + context;
- executable liquidity curve.

### Cash

Native USDC on X Layer.

CCTP only for transport, not split facility state.

### OKX surfaces

Keep types separate:

- Wallet;
- DEX Interface;
- DEX API;
- Exchange OS/TradeZone;
- Builder Codes.

No claim that API volume is Interface volume unless the current program says so.

### Sentinels

Strong optional/live demo:

Safety Buffer observes a real X Layer account deterioration and repays within mandate.

Event Guard becomes useful only after a real execution venue exists.

## Main demo

```text
Exact xStock
  ↓
Asset Passport
  ↓
recognized portfolio capacity
  ↓
deposit
  ↓
borrow native USDC
  ↓
Safety Buffer / collateral management
  ↓
repay / execute / reconcile
  ↓
public receipt
```

## Partner alignment

- xStocks: additional utility and financing demand;
- OKX Wallet: more useful asset holdings;
- X Layer: capital velocity and settlement;
- Circle: native settlement liquidity;
- market makers/LPs: financing and liquidation flow;
- Exchange OS: later authorized execution.

## What not to claim

- that xStock is the underlying share itself;
- that stock-backed borrowing is novel;
- that Exchange OS access exists before granted;
- that every OKX stock token is the same issuer/structure;
- that CCTP makes facility state cross-chain;
- that agent execution is autonomous if user Interface confirmation is required.

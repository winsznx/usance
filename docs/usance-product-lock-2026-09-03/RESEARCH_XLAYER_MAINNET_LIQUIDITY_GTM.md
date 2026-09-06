# Usance as X Layer’s RWA Capital Activation Layer: Mainnet, Liquidity and GTM Strategy

## Executive verdict

The most important conclusion from the research is that **the market around Usance has moved faster than the integration assumptions currently recorded in the repository**.

Your core thesis is still right, but the opportunity is materially larger and more immediate than the current docs suggest.

**Usance should not position itself as another project that “brings RWAs onchain”. X Layer, OKX and xStocks are already doing that.** Tokenised equities are already live in the OKX ecosystem; OKX officially supports deposits and withdrawals of xStocks over **X Layer**, and more than 40 tokenised US equities and ETFs are trading through OKX's Unified Tokenized Stocks product. citeturn11view1turn11view2 X Layer also has Uniswap, Aave, Chainlink Data Streams, Chainlink CCIP, extremely cheap execution and a developing Exchange OS. citeturn7search1turn7search15turn17search0turn16search0turn16search4

The problem is now one layer further down the stack:

> **Assets are arriving onchain faster than they are becoming reusable capital.**

A tokenised NVIDIA position sitting in someone's wallet is an asset. A tokenised NVIDIA position that can be reliably identified, understood, risk-adjusted, admitted as collateral, financed, liquidated, traded, hedged, monitored and safely controlled by autonomous agents is **financial infrastructure**.

That is Usance.

The best positioning I found is therefore:

> **Usance is the capital activation layer for RWAs on X Layer.**
>
> Tokenisation puts the asset onchain.  
> Usance makes the asset usable.

Or, more technically:

> **Usance is the clearing, collateral and risk layer that turns tokenised assets into reusable onchain capital.**

That is much stronger than “AI verifies RWAs”, “RWA lending protocol”, “RWA marketplace” or even “RWA clearinghouse” in isolation.

Your canonical PRD already describes exactly this architecture: Evidence and Passports establish what an asset represents; deterministic risk establishes how much capacity it can support; ClearingHouse, LiquidityVault and FinancingEngine convert that capacity into credit; IntentBook and venue adapters make that capital executable; Mandates and Sentinels make it programmable without giving AI financial authority. fileciteturn0file2 The AI boundary is particularly valuable: AI may read evidence and propose claims, but it cannot set haircuts, LTVs, move collateral, release collateral or commit financial truth. fileciteturn0file3 Sentinels extend precisely the same principle to autonomous execution: `AllowedAction = ProtocolAllows ∧ MandateAllows`. fileciteturn0file5

**My strongest bias is therefore: stop treating “generic RWA onboarding” as the first wedge. Start with assets that are already live, liquid and distributed on X Layer — especially wrapped xStocks — and demonstrate that Usance turns them from things people can trade into capital people can continuously use.**

That matters now because X Layer itself is actively subsidising the liquidity problem. The programme you supplied commits up to **$5 million in RWA ecosystem liquidity incentives**, with a first $300,000 round built specifically around RWA/stablecoin and RWA/ecosystem-token pools. The eligible RWA assets for the first pool programme are scheduled to be announced on **24 August 2026**, and the second pool window begins on 26 August. fileciteturn0file0

This is not merely hackathon alignment. It is direct evidence that **X Layer wants exactly the economic behaviour Usance can produce: RWA deposits becoming liquidity, trading activity and persistent capital on X Layer.**

The one thing I would *not* tell partners yet is “we are basically mainnet-ready and just need to deploy”. Your repository is much further along than an ordinary hackathon project, but its own authoritative checklist records **234 total completion items, 146 complete, 3 P0 open, 36 P1 open, 46 P2 open and 3 externally blocked**, with several mainnet-relevant integration and operations items unfinished. fileciteturn0file8

So the honest status is:

**Protocol architecture: unusually mature.**  
**Testnet proof: strong.**  
**Mainnet deployment machinery: substantially built.**  
**Mainnet production with real RWA capital: not yet cleared.**

That is not bad news. It means you have a short, concrete path from “serious prototype” to **mainnet beta**, rather than needing to invent the protocol.

## What has actually happened on X Layer

Your screenshots are important because they expose a misconception in the current internal integration plan.

You were looking at OKX Wallet's stock discovery surfaces and seeing names such as TSLAx, NVDAx, AAPLx, IBMx and other equity-linked tokens. That is not just cosmetic wallet categorisation. There is now a real tokenised-equity stack around X Layer.

OKX's July 2026 Unified Tokenized Stocks launch is powered by xStocks. OKX explicitly says its tokenised-stock product supports **deposits and withdrawals of xStocks over both Solana and X Layer**, trades 24/7 against USDT and handles issuer-level dividend adjustments automatically. It also makes clear that the products provide economic exposure rather than ordinary shareholder voting rights. citeturn11view1 xStocks separately reports that its atomic RFQ infrastructure and xStocks themselves have been deployed on X Layer, alongside its xPoints incentive programme. citeturn11view2

The scale of the broader network is now substantial. xStocks' current site reports **716 stocks and ETFs and more than $35 billion in transaction volume**, while its ecosystem directory lists 67 partners spanning DeFi, infrastructure, chains and centralised exchanges. citeturn13search8turn15search0 Earlier in 2026, xStocks reported passing $25 billion in combined transaction volume, with more than $3.5 billion in onchain activity and more than 80,000 unique onchain holders at that point. citeturn15search8

And there is a much more interesting fact for Usance than the headline trading numbers: **xStocks have already demonstrated that collateralisation can create a new liquidity flywheel.**

On Solana, Kamino created an xStocks-specific lending market. By April 2026 it had approximately **$6.3 million USDC supplied and $5.75 million borrowed — roughly 92% utilisation**. xStocks says its incentive campaign subsequently doubled the market's size because users gained a reason to deposit equities as collateral and put them to work rather than simply hold them. citeturn11view0

That is almost a live validation of the first half of the Usance thesis.

The difference is that Usance can attempt to build a more general architecture around it:

**asset → Passport → risk → collateral capacity → financing → execution → autonomous capital management**

rather than one isolated lending market.

### The X Layer infrastructure is now much more mature than the repository assumes

Several assumptions in the current Usance integration ledger are stale.

| Existing assumption in the build | Current reality | Usance implication |
|---|---|---|
| X Layer DEX unavailable / venue blocked | Uniswap officially supports X Layer. citeturn7search1 | Mainnet `IExecutionVenue` should no longer be designed around “no DEX”; build a real Uniswap adapter. |
| xStocks X Layer deployment still needs confirmation | OKX explicitly supports xStocks deposits/withdrawals over X Layer; xStocks says its infrastructure is deployed there. citeturn11view1turn11view2 | Promote xStocks verification from research blocker to immediate integration work. |
| Aave availability uncertain | Aave is live on X Layer, and X Layer users can supply and borrow there. citeturn7search15 | Treasury Recycle can have a real external-yield route after exact contracts/caps are verified. |
| Chainlink Data Feeds are essentially the end of the oracle decision | Chainlink **Data Streams went live on X Layer mainnet on 17 June 2026**, including 24/5 TSLA, NVDA and AAPL data, Treasury pricing and precious-metals data. citeturn17search0 | Add a Data Streams adapter for execution-sensitive RWA observations; do not blindly replace the deterministic oracle layer. |
| LayerZero is the natural cross-chain architecture | X Layer selected **Chainlink CCIP as its canonical cross-chain infrastructure** in November 2025. citeturn16search0 | Make remote collateral provider-agnostic and prioritise CCIP for X Layer. Keep LayerZero optional. |
| X Layer described as the earlier zk/Polygon architecture | Current X Layer developer docs say X Layer migrated to an enhanced **OP Stack** architecture with an EVM-equivalent execution environment. citeturn16search2turn16search10 | Rewrite chain threat assumptions and runbooks before mainnet. |

This matters because the ecosystem is no longer waiting for basic primitives.

X Layer has consciously moved towards financial-market infrastructure. Its current homepage describes Exchange OS as a two-environment architecture: **X Layer EVM anchors assets/governance while TradeZone performs high-frequency matching and execution**, with shared liquidity and composable markets as explicit objectives. citeturn16search4

X Layer also gives Usance a technically attractive environment for repeated capital actions. Its Jovian upgrade lowered the minimum base fee to 0.02 gwei and OKX estimated an ordinary ERC-20 transfer at roughly $0.0001 following that upgrade. citeturn7search6 Current developer documentation gives mainnet chain ID **196** and testnet chain ID **1952**. citeturn18search0 Public RPC endpoints are limited to 100 requests per second per IP, while OKX also provides instructions for self-hosting a Reth-based X Layer node, which is relevant to a production Sentinel/indexer deployment. citeturn18search3turn18search4

The ecosystem is also becoming economically meaningful. Third-party reporting based on DeFiLlama data put X Layer at approximately **$116 million DeFi TVL and $2.07 billion stablecoin market capitalisation in early August**, with Aave and Uniswap accounting for much of the locked DeFi value; those figures are volatile, so I would use them as a market snapshot rather than a permanent marketing claim. citeturn9search1turn9search7

And actual wrapped-equity liquidity is beginning to appear. Current market indexing shows Wrapped NVIDIA xStock trading on Uniswap V3 on X Layer, including a USDG market; CoinGecko recently indexed roughly $0.27 million of liquidity and approximately $0.93 million of 24-hour volume in the leading wNVDAx/USDG market at the time of capture. citeturn14search9 Wrapped Tesla xStock is likewise visible on X Layer with a USDG/Uniswap market. citeturn19search0 These values change rapidly, but their existence is more strategically important than their exact present size.

So your screenshot is actually pointing at the right problem:

**X Layer has begun acquiring assets, venues, users and stablecoins. The next question is how to make all that capital interact repeatedly rather than sit in isolated balances and pools.**

That is where Usance fits.

## The problem Usance should own

There are really three RWA problems, and you should consciously **not** try to own all three.

The first problem is **tokenisation**:

> How does an offchain share, Treasury, fund interest, commodity or private asset become a blockchain token?

xStocks, Securitize, Ondo, Franklin Templeton, tokenisation platforms, custodians and issuers are attacking this.

The second problem is **distribution and execution**:

> Where can somebody buy, sell or transfer that token?

OKX, Uniswap, aggregators, market makers, xChange and Exchange OS are attacking this.

The third problem is **capital utility**:

> Now that I possess this token, what else can safely be done with it?

**That is the gap Usance should own.**

Your own PRD essentially anticipated this. A token address does not tell a lending or capital protocol whether the holder has redemption rights, who the issuer is, whether the backing changed, what happens during a corporate action, whether the token may be transferred, whether there is executable exit liquidity, how fast that liquidity disappears under stress, or how much lending capacity should survive those uncertainties. fileciteturn0file2

Usance creates the missing machine-readable transition:

```text
TOKENISED ASSET
      ↓
Evidence
      ↓
Asset Passport
      ↓
Admission / Capability
      ↓
Risk Policy
      ↓
Recognised Collateral Value
      ↓
Borrowing Capacity
      ↓
Settlement Capital
      ↓
Trade / Hedge / Yield / Rebalance
      ↓
Repayment / Interest / Fees
      ↓
Capital available again
```

The deepest insight here is that **Usance is not primarily creating liquidity by creating a pool**.

It is creating liquidity by **increasing the velocity and utility of already-tokenised assets**.

Suppose, purely as an illustrative model rather than a forecast, that $10 million of admitted RWAs receives an average 35% usable credit capacity and 60% of that capacity is actually utilised. That produces $2.1 million of credit outstanding. If that settlement capital turns over four times a month across swaps, hedges, yield deposits or refinancing, those $10 million of otherwise passive tokenised assets can support roughly $8.4 million of downstream monthly capital activity.

That is the metric you want to optimise:

> **RWA capital velocity**

not:

> transactions for the sake of transactions.

### What this looks like with xStocks

There is one major integration discovery that should change your implementation priorities immediately.

**Raw xStocks are rebasing assets.**

xStocks' developer documentation says dividends, stock splits and reverse splits are reflected through rebasing; on EVM chains `balanceOf()` automatically changes as the multiplier changes. Integrators must not assume balances remain static. citeturn13search0turn13search6

More importantly, xStocks explicitly says that because rebasing tokens can interfere with DeFi accounting, **xStocks are wrapped into non-rebasing ERC-4626 tokens for DeFi integrations**. citeturn13search13

That means I would **not admit raw NVDAx as Usance collateral first**.

I would admit something like:

```text
wNVDAx
  │
  ├── wrapper contract
  ├── underlying → NVDAx
  ├── issuer → Backed Assets / applicable issuer entity
  ├── legal terms
  ├── underlying equity → NVIDIA
  ├── corporate-action mechanism → xStocks multiplier
  ├── wrapper conversion
  ├── Chainlink market-data route
  ├── Uniswap liquidation route
  ├── optional xChange route
  └── Passport + RiskPolicy
```

Your Passport therefore becomes valuable in a way a simple token allow-list does not.

The user deposits **the existing canonical wrapped asset**. Usance does **not** need to mint “uNVDA” or pretend to re-tokenise NVIDIA. `CollateralVault` holds the admitted wrapper; the Passport references the wrapper and underlying legal/economic asset; the risk engine gives it recognised collateral value; `ClearingHouse` records debt and capacity. The same pattern extends to other tokenised products. This follows the architecture already defined in your canonical PRD rather than creating a new tokenisation business. fileciteturn0file2

Now add liquidity:

```text
User holds wNVDAx
       ↓
Deposits into Usance
       ↓
Passport + deterministic risk validates it
       ↓
Recognised collateral capacity
       ↓
Borrow USDG / USDT0 / approved settlement asset
       ↓
┌────────────────────┬────────────────────┬────────────────────┐
│ Uniswap            │ Aave               │ Exchange OS        │
│ trade / liquidity  │ yield / liquidity  │ markets/execution  │
└────────────────────┴────────────────────┴────────────────────┘
       ↓
Interest / spread / fees / productive strategy
       ↓
Sentinel monitors safety
       ↓
Repay / hedge / rebalance
       ↓
Capacity recycled
```

That is the flywheel.

A user can eventually hold an equity exposure **without selling it**, unlock conservative stablecoin liquidity against it and deploy that capital elsewhere. LPs receive lending yield. DEXs receive volume. Market makers receive flow. X Layer retains both the RWA and the settlement capital. xStocks gets additional token utility. OKX gets more Wallet/DEX engagement. Usance earns financing/execution fees. Sentinels can continually keep the position safe within a mandate.

**Everyone's incentives line up.**

The Kamino case is particularly powerful evidence for this GTM story because xStocks itself reports that simply giving holders a reason to collateralise and borrow drove very high utilisation and that incentives doubled the market. citeturn11view0 Usance can credibly pitch X Layer:

> “You are bringing the stock market to X Layer. We make those stocks reusable capital once they arrive.”

That is the pitch.

## Mainnet readiness and how the contracts should work

The repository is much closer to serious protocol infrastructure than the word “hackathon” would imply.

Your completion ledger says the major protocol components already exist: Authority, AssetRegistry, EvidenceRegistry, PassportRegistry, RiskPolicyRegistry, ClearingHouse, CollateralVault, LiquidityVault, FinancingEngine, FeeController, LiquidationManager, MandateRegistry, IntentBook, DelegationGateway and EmergencyController. The repo also records deterministic deployment, role handover, mainnet guards, bytecode drift checks, clean-room reproduction, Slither, fuzz/invariants, differential accounting and more than 48 mutation tests. fileciteturn0file8

The Sentinel work is also structurally serious: schemas, two additive registries, the runtime, trigger deduplication, snapshotting, plan compilation, budget handling, delegated execution, reconciliation and a Safety Buffer strategy are already implemented locally/tested; the key missing P0 is the **live autonomous X Layer proof and complete production/web wiring**. fileciteturn0file7 The security model deliberately treats a compromised Sentinel as an untrusted delegated agent whose authority remains constrained by the existing mandate layer. fileciteturn0file6

But **mainnet readiness is not the same as “Solidity compiles and testnet works”**.

For the first real-capital deployment I would define the following launch architecture.

| Layer | Mainnet job | First production configuration |
|---|---|---|
| `EvidenceRegistry` | Anchor issuer/legal/custody/oracle evidence | xStocks primary docs + wrapper docs + addresses + corporate-action mechanism |
| `PassportRegistry` | Say exactly what wNVDAx is and what Usance recognises | One immutable/versioned Passport for the first collateral asset |
| `AssetRegistry` | Define capabilities | HOLD + COLLATERAL initially; add broader capabilities separately |
| `RiskPolicyRegistry` | Haircut, exit curve, limits, oracle policy | Very conservative first limits |
| `CollateralVault` | Custody admitted collateral | wNVDAx, not arbitrary equity tokens |
| `ClearingHouse` | Canonical collateral/debt/capacity accounting | Remains closed to feature creep |
| `LiquidityVault` | LP settlement capital | One verified mainnet stable settlement asset initially |
| `FinancingEngine` | Interest/debt accrual | Existing fixed-point deterministic model |
| `LiquidationManager` | Recover debt if account deteriorates | Uniswap first; RFQ/redemption later as extra routes |
| `IntentBook` | Reserve capital before external execution | Required for venue actions |
| `MandateRegistry` + `DelegationGateway` | Bound autonomous/user-delegated actions | No agent withdrawal; existing conjunctive authority |
| Sentinels | Monitor and execute bounded actions | Risk-reduction-only first |
| Venue adapters | Connect capital to external markets | Uniswap → Aave → Exchange OS/xChange as access arrives |

That is almost entirely the architecture you already built. fileciteturn0file2turn0file5

### I would change the mainnet launch order, however

**Do not launch “all RWAs”.**

Launch a **mainnet canary market**.

My preferred first market is:

> **Wrapped blue-chip xStock collateral → one approved stablecoin → one deterministic oracle configuration → one deep liquidation route.**

wNVDAx is attractive because X Layer already has actual trading activity, but wSPYx or another broader-market product could ultimately be a better first risk asset if its X Layer liquidity and oracle coverage prove superior. That decision should be made from an exact depth/slippage study, not brand recognition.

The first real-capital market should have deliberately low:

- global collateral cap,
- account cap,
- borrow cap,
- maximum LTV,
- liquidation close factor,
- concentration limits.

The limit can rise only after measured execution data exists.

### Several “P2” items need to become mainnet P0/P1

Your existing checklist reasonably prioritised them for product completion, but **real tokenised-equity money changes their severity**.

Concentration limits are currently P2. fileciteturn0file8 I would move **issuer-level concentration** to the mainnet launch gate. NVDAx, AAPLx and TSLAx look diversified economically, but they may share issuer, custody, redemption and technical infrastructure. Ten different xStocks can therefore contain a substantial common-mode risk.

Likewise, autonomous production execution cannot run permanently on the current test/local signer and file-backed durability model. Your Sentinel architecture explicitly describes the KMS signer as the production target and the file store as the local adapter. fileciteturn0file5 If Sentinels control mainnet actions, KMS/HSM signing, durable database storage, alerts and production reconciliation should move ahead of marketplace polish.

Your mainnet indexer should also have at least two independent RPC paths and preferably a self-hosted node. X Layer's public RPCs have published rate limits, and its WSS endpoints explicitly document reorganisation behaviour, including duplicate/retracted logs with `removed=true`; your trigger dedup/reorg model should consume those semantics deliberately. citeturn18search4turn18search9

### There are three important architecture updates I would make before deployment

**First: update the X Layer chain model.** Current official developer documentation says X Layer migrated from Polygon zkEVM/Polygon CDK to OP Stack and subsequently to the Reth execution client. citeturn16search10 Anything in ARCHITECTURE, threat modelling, finality assumptions or marketing that still calls current X Layer a Polygon-based zkEVM should be corrected.

**Second: make Chainlink oracle support dual-purpose rather than binary.** Chainlink Data Streams are now live on X Layer mainnet specifically for equities, Treasuries, commodities, automated risk and AI execution. citeturn17search0 Keep your deterministic financial-authorisation boundary, but add a `DataStreamsOracleAdapter` rather than pretending the new service does not exist. Data Feeds can remain where they are appropriate; Data Streams can serve execution-sensitive quotation and trigger contexts.

**Third: rethink LayerZero as the default remote-collateral path.** X Layer itself selected CCIP as canonical cross-chain infrastructure. citeturn16search0 The right abstraction is therefore:

```text
IRemoteCollateralAdapter
        │
        ├── CcipRemoteCollateralAdapter   ← X Layer priority
        └── LayerZeroRemoteCollateralAdapter
```

not a protocol whose architecture implicitly depends on LayerZero.

### The liquidation route can become a real competitive advantage

A generic lending protocol usually asks:

> “What is the oracle price?”

Usance's PRD asks the better question:

> “What can I actually recover?”

That is especially important for 24/7 tokenised equities. xStocks can trade on secondary markets 24/7, while primary issuance/redemption is aligned with underlying-market hours. citeturn13search2turn13search3

Your liquidation system can therefore eventually rank:

```text
Uniswap pool
vs
xChange / RFQ
vs
other market maker
vs
primary redemption
```

by **expected net recovery**, taking session state, slippage, fees and available depth into account.

That is much more sophisticated than blindly valuing a tokenised equity at the latest underlying-equity mark.

One particularly important consequence: when the US equity market is closed, a token can continue trading while issuer redemption and primary price formation are constrained. Usance should therefore have explicit `OPEN / PRE_MARKET / POST_MARKET / CLOSED / UNKNOWN` policies, exactly as the Sentinel architecture already anticipates. fileciteturn0file5

### I would call the current status “mainnet beta candidate”, not “mainnet ready”

The evidence supports this distinction.

**Already strong:** protocol core, deterministic accounting, authority model, testnet proofs, deployment guards, audits/invariants, Wallet integration and Builder Code support. fileciteturn0file8

**Before real capital:** exact xStock wrapper admission, live mainnet oracle configuration, real execution adapter, production settlement asset, liquidation depth tests, explorer verification, monitoring, account/issuer caps, legal/eligibility policy and funded keeper operations.

**Before autonomous real capital:** all the above plus production signer, durable Sentinel store, template-disable recheck, observability, full mutation/adversarial campaign and live autonomous testnet proof. fileciteturn0file7turn0file6

That is a credible mainnet story to partners because you are not saying “trust our roadmap”. You can show precisely which safety gates already exist and which gates remain.

## Partner and GTM map

The best GTM is **not to spend the next month trying to acquire individual retail users one by one**.

Usance needs to inherit distribution from the networks that already have:

assets,
wallets,
liquidity,
market makers,
issuers,
stablecoin balances,
and users.

This should be a B2B2C infrastructure GTM.

I would rank the pipeline as follows.

| Target | Priority | Why now | What you ask for | What Usance gives them |
|---|---:|---|---|---|
| **X Layer / OKX Web3** | Immediate | X Layer is explicitly pursuing RWA liquidity, AI and shared capital infrastructure. citeturn16search4 | Mainnet coordination, RWA programme inclusion, ecosystem listing, Exchange OS access, technical contact | More RWA deposits become borrowable capital, DEX flow and retained X Layer liquidity |
| **xStocks / Payward / Backed** | Immediate | xStocks are live with X Layer/OKX and actively recruit DeFi integrations. citeturn11view2turn15search7 | Official X Layer wrapper catalogue, developer contact, xPoints eligibility, xChange/RFQ access, joint launch | A new collateral/credit use case for xStocks on X Layer |
| **Uniswap** | Immediate | Uniswap is already live on X Layer and provides the simplest first liquidation/trading venue. citeturn7search1 | Pool/routing support, LP introductions, joint RWA liquidity work | Persistent borrow, liquidation and rebalance flow |
| **Chainlink** | Immediate | X Layer has Data Streams + Data Feeds + CCIP and is subsidising Scale infrastructure. citeturn17search0turn16search0 | RWA feed engineering support, Streams/CCIP integration review, co-marketing | Showcase of Chainlink RWA + autonomous risk infrastructure |
| **Aave** | Immediate/secondary | Already a major liquidity destination on X Layer. citeturn7search15 | Exact deployment/caps, integration coordination | Usance routes idle settlement capital to Aave; Aave becomes one leg of the capital loop |
| **BitGo** | Immediate/secondary | X Layer selected BitGo as preferred custodian for its institutional/RWA strategy. citeturn10search0 | Custody/evidence integration discussion, issuer referrals | Passport layer that transforms custody evidence into usable onchain risk state |
| **CoinRoutes** | Next | Already integrated with xStocks for institutional multi-asset execution across 60+ venues. citeturn15search4 | Institutional execution/market-maker relationship | Collateral and financing source for institutional tokenised-equity strategies |
| **Alpaca / xPort** | Next | xPort allows institutions to convert existing shares directly into xStocks through Alpaca. citeturn13search15 | Institutional asset-onramp partnership | Shares can go broker → xStock → X Layer → Usance collateral |
| **Alchemy Pay** | Distribution | xStocks already uses it for fiat reach across 170+ countries and 50+ fiat currencies. citeturn13search11 | Fiat/onramp funnel | Users can move from fiat to tokenised asset to productive onchain capital |
| **Franklin Templeton / xStocks collaboration** | Expansion | xStocks announced tokenisation work around multiple Franklin Templeton ETFs and broader collaboration. citeturn13search14 | Eventually admit institutional-grade ETF/Treasury products | Additional lower-volatility collateral classes |
| **RWA data/index providers** | Expansion | RWA sector distribution is accelerating and data visibility increasingly matters | Indexing/API/visibility | Machine-readable Passport/risk information rather than token ticker alone |
| **Market makers / xChange solvers** | Essential before scale | xChange connects onchain xStocks to primary-market liquidity via RFQ/solver networks. citeturn15search6 | Quotes, liquidation commitments, inventory | Financing demand and predictable liquidation/hedging flow |

There is an especially strong pitch to xStocks because they explicitly tell potential DeFi partners that tokenised equities should be usable as collateral, liquidity-pool assets and structured-product components. citeturn13search10

And you have a quantitative precedent to attach to the email:

> “Kamino demonstrated 92% utilisation in an xStocks collateral market. We are building the X Layer-native clearing/risk system for the next version of that model.” citeturn11view0

That is dramatically stronger than:

> “Hi, we built an RWA AI protocol at a hackathon.”

### The dream joint user journey

This is what I would pitch OKX and xStocks:

```text
OKX Wallet
Stocks
│
│ User already owns wNVDAx / supported xStock
▼
"Use as collateral"
│
▼
Usance
Passport verified
Risk capacity shown
│
▼
Deposit
│
▼
Borrow approved stablecoin
│
├────→ Swap / LP on Uniswap
│
├────→ Earn on Aave
│
├────→ Execute in OKX ecosystem
│
└────→ Future Exchange OS market
       │
       ▼
Usance Sentinel
keeps the account inside the signed safety mandate
```

To OKX, that means **retention and capital velocity**.

To xStocks, it means **utility beyond trading**.

To Chainlink, it means **RWA data being used in live risk and autonomous execution**.

To Uniswap, it means **new RWA/stablecoin liquidity and flow**.

To LPs, it means **interest-producing stablecoin demand**.

To the RWA issuer, it means **their asset becomes financial collateral rather than a dead token**.

That is the multi-sided network effect Usance should sell.

### I would not lead with Aave as the core

Aave is useful, but you do not want to reduce Usance to:

> “We route assets into Aave.”

Aave's core competence is generic permissionless lending. Usance's moat should remain **RWA truth + RWA-specific risk + liquidation-aware credit + execution + bounded autonomy**.

Use Aave as an external settlement/yield venue.

Do not outsource your core collateral/risk product to it.

### I would also keep 0G deliberately secondary

The proposed 0G design is sound precisely because it does **not** make 0G a financial authority: Storage can act as an evidence archive and Compute can process or explain evidence, while X Layer remains the settlement/authority layer. fileciteturn0file4

That can be valuable for:

document provenance,
institutional due diligence,
AI evidence processing,
long-term evidence storage,
and an additional ecosystem relationship.

But it does not solve the immediate bottleneck.

**xStocks + X Layer mainnet + Uniswap + Chainlink + settlement liquidity solve the immediate bottleneck.**

I would therefore not spend the next five critical days deepening 0G while wrapped xStocks are already sitting on the exact chain you are targeting.

## The execution plan I would run now

There is a narrow window where your hackathon work and a genuine company GTM can reinforce one another rather than compete.

The RWA incentive programme in your supplied announcement does not disclose the first eligible RWA list until **24 August**, so nobody outside the organiser should pretend to know the final eligible assets today. fileciteturn0file0 That gives you a few days to make Usance technically capable of consuming whichever high-quality assets are selected rather than betting everything on an unconfirmed pool.

I would execute the company in this order.

| Window | Product / engineering | GTM |
|---|---|---|
| **Now → 24 August** | Update stale X Layer integration assumptions; verify exact wrapped-xStock contracts; implement rebasing/wrapper-aware Passport; add mainnet Uniswap venue adapter; verify Chainlink feeds/streams; choose settlement asset; rewrite OP Stack finality assumptions | Contact X Layer, xStocks, Chainlink and Uniswap with tailored one-page briefs |
| **24 → 26 August** | Map announced eligible RWA list into Usance admission candidates; run depth/slippage/liquidation simulations; select the safest candidate | Tell X Layer exactly which eligible asset Usance can turn into collateral and how |
| **Following week** | Deploy mainnet contracts with **zero or near-zero initial risk limits**, verify explorer source, validate manifests, run canary reads and venue quotes | Publish mainnet addresses + proof ledger; no “live lending” claim yet |
| **Mainnet beta** | Admit one wrapped RWA, one settlement token, one liquidation venue; small global/account caps; operate funded keeper; live borrow/repay/liquidation proof | Joint xStocks/X Layer launch target |
| **Following fortnight** | Second collateral; LP production deposits; Uniswap routing; optional Aave Treasury Recycle; production monitoring | Recruit first LPs and market maker; integrate ecosystem incentives |
| **Following month** | Risk-reducing Sentinel only on mainnet; Event Guard later; xChange/Exchange OS adapter when access permits | Pitch “autonomous RWA capital on X Layer”, backed by real receipts |
| **Following quarter** | Treasuries, issuer onboarding, CCIP remote collateral, institutional routes | BitGo, CoinRoutes, Alpaca/xPort, tokenisation issuers, fintech distribution |

I would **not launch ten assets at once**.

The strongest mainnet announcement would actually be small and precise:

> **Usance mainnet beta is live on X Layer.**
>
> A real tokenised asset can now be admitted through an evidence-backed Passport, deposited as collateral, assigned deterministic risk capacity, financed with onchain liquidity and liquidated through a real X Layer market.
>
> Every step is publicly verifiable.

Then prove one complete loop.

After that, add the second asset.

Then the third.

### The KPIs should change as well

Do not optimise Usance around hackathon vanity metrics such as number of AI calls, number of Passports generated or raw transaction count.

The operating dashboard should eventually measure:

| Metric | Why it matters |
|---|---|
| **Admitted RWA value** | How much real asset inventory Usance understands |
| **Recognised collateral value** | How much of that inventory is actually safe enough to use |
| **Debt outstanding** | Actual capital unlocked |
| **Credit utilisation** | Whether users want that liquidity |
| **LP capital / utilisation** | Whether financing is sustainably funded |
| **Borrowed capital routed into X Layer venues** | Direct contribution to ecosystem activity |
| **RWA DEX volume attributable to genuine strategy actions** | Real execution, not manufactured volume |
| **Capital turns per month** | The core RWA-capital-velocity metric |
| **Interest paid to LPs** | Real economic yield |
| **Median liquidation slippage / recovery** | Whether the risk model is truthful |
| **Repeated borrower rate** | Product value rather than incentives-only activity |
| **Passport refresh / restriction events** | Whether the truth layer is genuinely alive |
| **Autonomous risk reductions completed** | Sentinel utility |
| **Unauthorised actions refused** | Sentinel safety |
| **External integrations consuming Passport/risk data** | Platform/network effect |

That becomes your data moat.

Every asset that enters Usance creates a richer dataset about:

issuer,
rights,
custody,
corporate actions,
oracle behaviour,
market liquidity,
exit curves,
utilisation,
borrowing demand,
liquidation recovery,
and capital velocity.

Over time, Usance can become not merely a lending application but a **risk and clearing standard for tokenised assets**.

### There are also three GTM products hidden inside the architecture

Your current product can naturally become three offerings without fragmenting the company.

**Usance Capital** is what users and LPs see: deposit RWA, unlock liquidity, earn, repay.

**Usance Passport** is what issuers, wallets, protocols and institutions integrate: machine-readable asset truth, status and risk capability.

**Usance Sentinels** is the automation layer: maintain buffers, recycle idle capital, rebalance and respond to events under signed mandates.

All three use one protocol.

That is much cleaner than spinning EquityMind, RWA Sentinel and issuer tokenisation into unrelated brands.

The Sentinel architecture already reinforces this: the autonomy plane sits above Truth, Risk and Capital rather than replacing any of them. fileciteturn0file5 Its security specification also correctly assumes the runtime itself may be compromised and requires the existing mandate/capability layer to remain the outer financial boundary. fileciteturn0file6

### The long-term ecosystem position is unusually good

X Layer's strategic direction is increasingly close to Usance's architecture.

X Layer says Exchange OS is pursuing **one account, shared liquidity and composable markets**, with EVM asset/governance anchoring separated from higher-frequency execution. citeturn16search4

Usance can become the layer that answers:

> What assets are safe enough to enter that shared capital environment?

> How much capacity does each one contribute?

> What happens when its issuer, evidence, oracle or liquidity changes?

> Which venue should execute or liquidate it?

> What may an autonomous agent legally and financially do with it?

That is not redundant with Exchange OS.

It is complementary.

You could eventually diagram the stack this way:

```text
           REAL-WORLD FINANCE
       equities · funds · treasuries
                   │
          tokenisation / issuer
                   │
        xStocks / future issuers
                   │
                   ▼
┌───────────────────────────────────────────┐
│                 USANCE                    │
│                                           │
│  TRUTH          RISK          CAPITAL     │
│  Passport   →   Capacity   →  Clearing    │
│                                           │
│            AUTONOMY                       │
│            Sentinels                      │
└──────────────────┬────────────────────────┘
                   │
         executable capital
                   │
       ┌───────────┼───────────┐
       ▼           ▼           ▼
   Uniswap       Aave      Exchange OS
       │           │           │
       └───────────┼───────────┘
                   ▼
             X LAYER LIQUIDITY
                   │
            capital recycled
                   └──────────────→ Usance
```

And later:

```text
Other chains / institutions
          │
     Chainlink CCIP
          │
          ▼
       USANCE
          │
          ▼
      X LAYER
```

X Layer has already designated CCIP as its canonical cross-chain infrastructure, making that a more strategically aligned cross-chain direction than building the company story around a LayerZero-specific adapter. citeturn16search0

### The one-sentence company thesis

After going through the current ecosystem, your PRD, the implementation checklist, Sentinels and the live changes around X Layer, this is the sentence I would build the company around:

> **Tokenisation brings real-world assets onchain. Usance turns them into usable capital.**

For X Layer specifically:

> **Usance turns the RWAs arriving on X Layer into collateral, credit, liquidity and safely automated capital.**

For OKX/X Layer BD:

> **You are bringing assets and users onchain. Usance makes that asset base generate recurring liquidity and execution instead of stopping at ownership and trading.**

For xStocks:

> **xStocks brings equities onchain. Usance gives those equities a collateral and financing layer on X Layer.**

For an issuer:

> **We do not replace your token. We make it financeable.**

For an LP:

> **Fund the settlement liquidity behind tokenised real-world collateral and earn from real borrowing demand.**

For developers:

> **Integrate one Passport/risk layer instead of independently rebuilding RWA due diligence, collateral policy and liquidation logic.**

For users:

> **Keep the asset. Unlock the capital.**

That is the company.

And there is a very concrete first wedge sitting in front of you **today**:

**wrapped xStocks on X Layer → Usance collateral → stablecoin credit → Uniswap/Aave/OKX execution → Sentinel-managed safety.**

The repository's core architecture was designed for almost exactly that loop. fileciteturn0file2 The missing work is no longer figuring out what Usance should be. It is updating the integration layer to the ecosystem that now exists, promoting the real-money safety gaps to launch blockers, and proving the first complete capital cycle on X Layer mainnet. fileciteturn0file7turn0file8

The hackathon can be the forcing function.

**It should not be the ceiling.**
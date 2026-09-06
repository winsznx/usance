Yes. This is the point where we should freeze Usance’s chain architecture before entering more programs.

The key change I’d make is this:

> Usance should be one multi-domain capital protocol with chain-native market deployments, not a protocol that keeps changing its “home chain” every time there is a hackathon.

That lets us legitimately build on Base, X Layer, Hedera, Ethereum/ENS and future networks without telling contradictory stories.

There is one important correction to our old Usance positioning. We previously treated X Layer as the canonical collateral/debt domain. If we apply to Base Batches 004, we shouldn’t continue publicly claiming that. Base explicitly allows multichain companies, but says Base must be the team’s default network and primary chain. ([Base](https://www.base.org/batches?utm_source=chatgpt.com "Base"))

OKX Dev Day has no equivalent exclusivity requirement. Its judging explicitly rewards X Layer and/or OKX AI integration, product completeness, user value, technical execution, growth potential, and contribution to the OKX ecosystem. ([OKX](https://www.okx.com/en-gb/learn/okx-dev-day-terms?utm_source=chatgpt.com "OKX Dev Day 2026 - Disclaimers and T\&Cs | OKX"))

So there is a clean architecture that satisfies both without lying to either ecosystem.

# The Usance architecture I would lock

Usance becomes:

> The capital operating system for programmable real-world assets.

The universal protocol owns five things:

```text
                     USANCE

                Asset Passport
          what exactly is this asset?
                       │
                       ▼
                 Risk Engine
          what can safely be done?
                       │
                       ▼
               Capital Facility
       borrow / pledge / substitute
                       │
                       ▼
               Clearing Engine
      authorize / reserve / execute
                       │
                       ▼
                Reconciliation
           what actually settled?
```

None of those concepts belongs exclusively to Base, X Layer or Hedera.

Then each network provides a market domain.

And every individual financing facility has exactly one home domain.

That final rule matters a lot.

## One facility = one authoritative chain

For example:

```text
Facility #BASE-1042
Home domain: Base

Facility #XL-882
Home domain: X Layer

Facility #HBAR-401
Home domain: Hedera
```

Its collateral state, debt state, reservations and settlement live atomically on that chain.

We do not create a global mutable loan that is half on Base and half on X Layer.

That avoids:

- cross-chain split-brain
- weird finality assumptions
- sponsor-removal problems
- duplicated collateral
- competition narratives becoming incoherent

Cross-chain transport can come later around the edges.

---

# 1. Base becomes Usance's default production network

This is the strategic decision I'd make if we're serious about Base Batches.

Base explicitly says applicants can support several chains, but Base should be the default network of choice. ([Base](https://blog.base.org/introducing-base-batches-004?utm_source=chatgpt.com "Introducing Base Batches 004"))

And the new tokenized-stock signal is extremely relevant to us.

Coinbase tokenized stocks are now live natively on Base, and Base is publicly asking builders to create:

- credit
- stock lending
- personalized indexes
- brokerage products
- yield products
- derivatives
- agent-managed portfolios

([Base](https://blog.base.org/request-for-builders-tokenized-stocks?utm_source=chatgpt.com "Request for Builders: Tokenized Stocks"))

Usance fits directly into one of the most serious pieces of that map.

### Usance on Base

I would position the Base product as:

## Usance Stock Credit

> Borrow stablecoins against programmable tokenized equity without selling it.

Example:

```text
User portfolio

AAPL      $12,000
NVDA       $8,000
COIN       $5,000
────────────────
Collateral $25,000

Usance Risk Capacity
$14,000

Borrow:
10,000 USDC
```

Then later:

- portfolio-backed revolving credit
- dynamic collateral substitution
- concentrated-position credit
- stock-basket collateral
- personalized index collateral
- corporate-action-aware facilities
- eventually yield-aware financing where the instrument actually supports it

This plugs directly into Base's public request for credit on productive assets. ([Base](https://blog.base.org/request-for-builders-tokenized-stocks?utm_source=chatgpt.com "Request for Builders: Tokenized Stocks"))

And it is almost perfectly aligned with what Usance already exists to do.

### Base's responsibility

Base owns:

```text
Coinbase tokenized stocks
        ↓
Usance Asset Passport
        ↓
Risk
        ↓
Collateral
        ↓
Credit
        ↓
Base liquidity / settlement
```

So when Base asks:

> Why Base?

Answer:

> Because this market uses Base-native programmable equities as productive collateral.

Excellent.

---

# 2. X Layer becomes Usance's xStocks market

Now X Layer gets a different purpose.

It doesn't become a second arbitrary deployment of the Base product.

X Layer has its own native reason.

OKX is actively pushing xStocks on X Layer. Users can already hold xStocks there and provide liquidity to eligible Uniswap pools. ([OKX Wallet](https://web3.okx.com/cs/learn/earn-xpoints-xlayer?utm_source=chatgpt.com "Explore tokenized stocks and earn more xPoints | OKX Peněženka"))

And OKX Dev Day specifically asks for tokenized-stock/RWA applications on X Layer.

So:

## Usance X

or internally:

```text
Usance Market Domain:
XLAYER
```

uses xStocks.

### Product

> Capital markets infrastructure for xStocks.

Potential hero workflow for Dev Day:

```text
NVDAx
AAPLx
TSLAx
    ↓
Usance collateral portfolio
    ↓
risk-adjusted borrowing capacity
    ↓
stablecoin financing
    ↓
collateral substitution
    ↓
OKX / X Layer execution
```

This is related to Base but not identical.

And that difference is justified by the assets themselves.

---

# There is a huge legal/product distinction here

This is one of the most important things we discovered today.

We cannot internally represent:

```text
AAPL on Base
```

and

```text
AAPL xStock on X Layer
```

as simply:

```text
asset = AAPL
```

They are different instruments.

Base describes Coinbase's Base-native tokens as real shares held 1:1 with a regulated custodian and owned by the token holder. ([Base](https://blog.base.org/tokenized-stocks?utm_source=chatgpt.com "Stocks just got updated."))

xStocks legally describes its instruments as bearer debt instruments / tracker certificates providing economic exposure to the underlying stock. They do not confer shareholder voting rights. ([docs.xstocks.fi](https://docs.xstocks.fi/docs/product-legal-overview?utm_source=chatgpt.com "Product Legal Overview | xStocks Docs"))

xStocks also have their own corporate-action machinery. Dividends are reinvested and reflected through rebasing, and splits are handled through the same multiplier system. ([docs.xstocks.fi](https://docs.xstocks.fi/docs/dividends-and-stock-splits?utm_source=chatgpt.com "Dividends and Stock Splits | xStocks Docs"))

That distinction should become a strength of Usance.

---

# Asset Passport becomes much more important

Every Usance asset should have an identity such as:

```text
AssetPassport {

  network
  contract

  issuer
  instrumentType

  underlying
  custodyModel

  ownershipRights
  votingRights

  dividendModel
  corporateActionModel

  transferRestrictions
  jurisdictionRestrictions

  valuationSource
  riskModel

  collateralAdapter
  executionAdapter
}
```

Therefore:

```text
AAPL / Coinbase / B20 / Base

≠

AAPL / xStocks / X Layer
```

even though both reference Apple.

We should never make them fungible just because the ticker matches.

That is exactly the kind of mistake an institutional RWA protocol must prevent.

And actually gives Usance another moat:

> normalized risk without erasing the legal and economic differences between tokenized assets.

That is much better than generic "multichain RWA."

---

# 3. Hedera has another separate job

Hedera shouldn't compete with Base or X Layer for "the home of Usance."

Hedera becomes the issuer-native tokenization domain.

For ETHOnline:

## Usance Collateral on Hedera

```text
Issuer
   ↓
Hedera ATS
   ↓
Tokenized Treasury A
Tokenized Treasury B
   ↓
Usance financing facility
   ↓
Collateral substitution
```

This is different from Base and X Layer.

### Base

Assets already exist.

Usance turns Coinbase stocks into collateral/credit.

### X Layer

xStocks already exist.

Usance turns them into financing/capital markets.

### Hedera

ATS is part of the asset lifecycle itself.

Usance demonstrates:

> issuance → collateralization → financing → substitution → release.

That is exactly why Hedera remains load-bearing for ETHOnline without pretending Usance plans to relocate there.

---

# 4. ENSv2 does not belong to a market domain

ENS should sit above every chain.

```text
                   ENSv2

            acme.usance.eth
                   │
        ┌──────────┼──────────┐
        ▼          ▼          ▼
      Base      X Layer     Hedera
```

It answers:

- which institution is this?
- which operator represents it?
- which facility is this?
- what public authority is delegated?

Not:

- where is collateral settled?

That separation is extremely clean.

Example:

```text
acme.usance.eth

treasury.acme.usance.eth

risk.acme.usance.eth

base-1042.acme.usance.eth

xlayer-882.acme.usance.eth
```

ENSv2 remains Ethereum/Sepolia infrastructure while referring to resources on multiple execution domains.

Its hierarchy and EAC model are built specifically around granular name-level permissions. ([docs.ens.domains](https://docs.ens.domains/ensv2/enhanced-access-control/?utm_source=chatgpt.com "Enhanced Access Control | ENS Docs"))

So ENS never competes with Base/X Layer/Hedera for chain status.

---

# 5. Privy also sits above the chains

Privy is Usance's institutional custody/control plane.

```text
Institution
    │
    ├── Treasury operator
    ├── Risk officer
    └── 2-of-3 approvers
             │
           PRIVY
             │
       authorized tx
             │
      ┌──────┼──────┐
    Base   XLayer  Hedera
```

Privy doesn't determine what asset exists or where it settles.

It determines:

> who can authorize money movement.

That remains useful everywhere.

---

# 6. Chainlink becomes the common truth/policy layer

Chainlink can play several roles without owning Usance's state.

### Public market truth

Prices, NAVs and market data.

### Confidential policy

For ETHOnline:

```text
private lender policy
        +
collateral proposal
        ↓
Chainlink CRE
        ↓
ALLOW / DENY
```

### Cross-chain messaging

Where CCIP is appropriate later.

But I would not currently make Usance fundamentally cross-chain.

First make each domain independently correct.

---

# 7. 0G stays in the evidence/AI plane

This also means our 0G integration still has somewhere coherent to live.

Usance already has the principle:

> AI can interpret evidence and produce recommendations. Deterministic protocol logic controls risk parameters and capital movement.

So:

```text
documents
market reports
issuer evidence
news
disclosures
      ↓
     0G
AI analysis / evidence extraction
      ↓
Asset Passport evidence
      ↓
deterministic RiskEpoch
```

0G doesn't control:

- LTV
- collateral release
- settlement
- liquidation

That makes the AI useful without putting money behind an LLM decision.

---

# 8. Circle is the cash rail

Circle doesn't need its own Usance market.

USDC can be the financing/cash asset.

Eventually:

```text
Base facility
   │
 USDC
   │
 CCTP
   │
another supported domain
```

Circle is transport/cash infrastructure.

Not protocol authority.

---

# 9. Liquidity venues stay adapters

Same logic.

### Base

Potentially:

- Aerodrome
- Uniswap
- Aave
- other Base liquidity

### X Layer

- OKX Exchange OS
- OKX DEX
- Uniswap
- other X Layer liquidity

Usance doesn't become any one of them.

It says:

```text
Usance determines:
WHAT can happen

Execution adapter determines:
WHERE it happens
```

Very important separation.

---

# The complete map

| ComponentPermanent role in UsanceCompetition/ecosystem |                                                           |                                    |
| ------------------------------------------------------ | --------------------------------------------------------- | ---------------------------------- |
| Base                                                   | Default production network + Coinbase stock credit market | Base Batches / Base Ecosystem Fund |
| X Layer                                                | xStocks/RWA market domain + OKX execution/distribution    | OKX Dev Day                        |
| Hedera                                                 | Tokenization/issuer lifecycle domain                      | ETHOnline Hedera                   |
| ENSv2                                                  | Cross-domain institutional namespace + public delegation  | ETHOnline ENS                      |
| Privy                                                  | Institutional wallets, signing, quorum, policies          | ETHOnline Privy                    |
| Chainlink                                              | Market truth + confidential policy + eventual transport   | ETHOnline Chainlink                |
| 0G                                                     | Evidence interpretation / AI computation                  | 0G ecosystem                       |
| Circle                                                 | Stablecoin/cash movement                                  | Circle ecosystem                   |
| OKX Exchange OS                                        | X Layer execution adapter                                 | OKX                                |
| Base liquidity protocols                               | Base execution/liquidity adapters                         | Base                               |
| CCIP/other messaging                                   | Transport, never canonical state                          | Cross-chain expansion              |

That is coherent.

---

# The competition map also becomes clean

This matters just as much as architecture.

## ETHOnline, Sep 4 to 13

Submit:

### Usance Collateral

Continuity work:

```text
Hedera ATS
+
Chainlink confidential policy
+
Privy institutional authority
+
ENSv2 institutional namespace
+
Collateral Switch
```

We clearly mark everything that existed before kickoff.

Do not make Base or X Layer the judging story.

ETHOnline sees one bounded new Usance subsystem.

---

# Base Batches 004, apply by Sep 9

Submit the company:

### Usance

Not "Usance ETHOnline."

Pitch:

> Usance turns programmable real-world assets into usable capital, starting with portfolio-backed credit against tokenized stocks on Base.

And this matters:

Base's program explicitly says multichain is allowed, but Base should be the default network of choice. ([Base](https://blog.base.org/introducing-base-batches-004?utm_source=chatgpt.com "Introducing Base Batches 004"))

So from this point forward I would describe Base as:

> Usance's default public market deployment.

Do not tell Base:

> "X Layer is our canonical chain."

We cannot maintain both claims honestly.

---

# OKX Dev Day, apply by Sep 11

Their published terms don't require exclusivity or a newly founded project. Judging includes X Layer/OKX integration, market potential and ecosystem contribution. ([OKX](https://www.okx.com/en-gb/learn/okx-dev-day-terms?utm_source=chatgpt.com "OKX Dev Day 2026 - Disclaimers and T\&Cs | OKX"))

Apply:

### Usance, X Layer Capital Market

Pitch:

> Usance turns X Layer's xStocks and RWAs into productive collateral for programmable credit and capital markets.

Then during their Sep 17 to 25 build window, produce a concrete new X Layer delta.

I would probably build around:

```text
xStocks collateral
      +
corporate-action-aware risk
      +
collateral substitution
      +
OKX execution
```

That is much more X Layer-native than just redeploying the ETHOnline product.

And xStocks are actually active on X Layer today, so this is no longer speculative ecosystem alignment. ([OKX Wallet](https://web3.okx.com/cs/learn/earn-xpoints-xlayer?utm_source=chatgpt.com "Explore tokenized stocks and earn more xPoints | OKX Peněženka"))

---

# This also fixes the "same project winning five hackathons" problem

There is a good version and a bad version of doing that.

Bad:

> Deploy identical Usance contracts on five chains and submit the same demo everywhere.

Judges eventually notice.

Good:

```text
                         USANCE

                 same capital thesis

        ┌──────────────┬──────────────┐
        │              │              │
       BASE          X LAYER        HEDERA
        │              │              │
 Coinbase stocks    xStocks        ATS assets
        │              │              │
 stock credit      xStock market   collateral
                                   lifecycle
```

Each competition funds a genuinely new part of the same company.

Then winning multiple programs tells an investor:

> Four ecosystems independently funded different parts of the same capital infrastructure.

That is a powerful story.

---

# One rule I would freeze now

Do not bridge the equity assets just for multichain optics.

For now:

```text
Coinbase B20 stock → stays Base-native

xStock → stays X Layer-native

ATS Treasury → stays Hedera-native
```

Usance comes to the asset.

We don't force the asset to come to Usance.

Later, if issuer-supported/canonical interoperability is appropriate, we can add it explicitly. xStocks already has cross-chain infrastructure and corporate-action semantics of its own. ([docs.xstocks.fi](https://docs.xstocks.fi/docs/how-xstocks-work?utm_source=chatgpt.com "How xStocks Work | xStocks Docs"))

This avoids a huge amount of:

- legal ambiguity
- bridge risk
- accounting complexity
- corporate-action errors
- duplicate-liquidity problems

---

# And I would change the repo architecture now

Something like:

```text
usance/
│
├── protocol/
│   ├── asset-passport/
│   ├── risk-engine/
│   ├── collateral/
│   ├── facilities/
│   └── clearing/
│
├── adapters/
│   ├── base-b20/
│   ├── xlayer-xstocks/
│   ├── hedera-ats/
│   ├── ensv2/
│   ├── privy/
│   ├── chainlink/
│   ├── 0g/
│   └── circle/
│
├── deployments/
│   ├── base/
│   ├── xlayer/
│   └── hedera/
│
├── competitions/
│   ├── ethonline-2026/
│   └── okx-devday-2026/
│
└── evidence/
```

Each competition folder records:

```text
baseline_commit
new_work
eligible_tracks
deployment addresses
sponsor-critical paths
demo receipts
limitations
```

That will save us enormous trouble later.

## So the strategic lock I recommend

Usance company:

> Multi-domain RWA capital infrastructure.

Default network:

> Base.

Base:

> Coinbase tokenized stocks → portfolio-backed credit.

X Layer:

> xStocks → programmable financing and market infrastructure.

Hedera:

> issuer/token lifecycle → collateral operations.

ENS:

> institutional identity/delegation.

Privy:

> institutional control/signing.

Chainlink:

> truth + confidential policy.

0G:

> evidence intelligence.

Circle:

> cash transport.

This architecture lets us keep applying for grants and hackathons without rewriting what Usance is every two weeks.

And Base plus X Layer may actually strengthen the company thesis rather than conflict, because they already expose two legally and technically different forms of tokenized equities. Usance's job becomes normalizing capital operations across those assets without pretending the assets themselves are identical.

That is a much bigger and more defensible product thesis than the Usance we started with.
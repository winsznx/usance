Yes. That was the mistake. I overcorrected from “don’t stack sponsors” into “build almost entirely for one sponsor.”

Your skill’s actual rule is different: when several sponsors are involved, pick a dominant mechanism, give each sponsor a distinct responsibility in that mechanism, and make the causal contribution of each visible. One deep integration is better than decorative breadth, but 2 to 3 genuinely load-bearing integrations can be stronger than one.

I recomputed the idea space around that constraint.

And I would move Freehold out of first place.

# New lead: Collateral Switch

Working name only.

Think of it as an institutional collateral operations desk for tokenized assets.

The simple problem:

> A bank or dealer has borrowed money against Treasury A. It suddenly needs Treasury A back. Can it replace it with Treasury B without closing the loan?

This happens in real repo markets. DTCC already operates an automated repo collateral-substitution facility because dealers need to reclaim securities while keeping the underlying repo agreement alive. ([DTCC](https://www.dtcc.com/clearing-and-settlement-services/ficc-gov/repo-subs?utm_source=chatgpt.com "Repo Collateral Substitution"))

The digital-asset version is even more interesting. DTCC's 2026 interoperability work specifically calls out replacing one digital twin with another during an ongoing repo or securities-lending transaction. It says weak interoperability can force parties to unwind transactions and introduces mismatched finality, disputed liens, out-of-order events and operational risk. ([DTCC](https://www.dtcc.com/dtcc-connection/articles/2026/march/04/-/media/interoperable-digital-asset-securities-white-paper.pdf?utm_source=chatgpt.com "5.3 Collateral management: Substituting one digital twin for another"))

That's a much richer real problem than "make an RWA dashboard."

## The product

A firm has an active financing agreement:

```text
Repo R-1042

Cash borrowed:     $900,000
Current collateral: Treasury A
Collateral value:  $1,000,000
Status:             ACTIVE
```

The borrower wants Treasury A back because they need to sell it or use it elsewhere.

They offer Treasury B:

```text
Substitute

OUT: Treasury A
IN:  Treasury B
```

The lender has private collateral rules:

```text
minimum haircut
allowed issuers
maturity limits
concentration limits
minimum coverage
counterparty limits
```

Those rules may themselves be commercially sensitive.

Collateral Switch evaluates the replacement.

If valid:

```text
APPROVED

Treasury B locked
Treasury A released
Repo R-1042 remains ACTIVE
```

If Treasury C doesn't satisfy the rules:

```text
REJECTED

Existing collateral untouched
Repo remains fully secured
```

The memorable mechanism becomes:

> Collateral can move while the financing stays open.

That is far more distinctive.

---

# The three sponsor stack

This is where it gets strong.

## 1. Hedera, asset and settlement state

Primary sponsor.

Hedera's ETHOnline brief practically points us at this market. Their $6k Tokenization of Anything track explicitly calls tokenized collateral "the sharpest edge" of institutional adoption and gives tokenized Treasuries posted against repo agreements as an example. They require Asset Tokenization Studio, testnet deployment and real lifecycle management. ([ETHGlobal](https://ethglobal.com/events/ethonline2026/prizes/hedera "ETHGlobal"))

We go substantially beyond their starter example.

Hedera ATS handles:

- Treasury A issuance
- Treasury B issuance
- ERC-3643/1400 compliance
- ownership
- freezes
- transfer restrictions
- collateral lifecycle

Then our repo contract/state machine implements:

```text
POST COLLATERAL
      ↓
ACTIVE REPO
      ↓
REQUEST SUBSTITUTION
      ↓
VERIFY REPLACEMENT
      ↓
ATOMIC SWITCH
```

Hedera removal score:

5/5.

Remove Hedera and the entire tokenized collateral lifecycle we're competing on disappears.

Potential track:

### Hedera, Tokenization of Anything

$6,000 pool, up to three teams receive $2,000. ([ETHGlobal](https://ethglobal.com/events/ethonline2026/prizes/hedera "ETHGlobal"))

---

# 2. Chainlink, confidential eligibility decision

This is where the product becomes much more interesting than Hedera's example.

A lender doesn't necessarily want this public:

```text
Goldman collateral policy:
US Treasury <2yr: 2.1%
2-5yr: 3.7%
specific issuer cap: ...
counterparty X adjustment: ...
portfolio concentration threshold: ...
```

Publishing the whole underwriting/risk book onchain is unrealistic.

Chainlink CRE Confidential Workflows lets sensitive parts of a workflow run inside a TEE while controlling what gets revealed outside it. Their current challenge specifically calls out private risk thresholds, privacy-preserving policy enforcement and confidential financial/compliance computation. ([ETHGlobal](https://ethglobal.com/events/ethonline2026/prizes/chainlink "ETHGlobal"))

So:

```text
Treasury B
+
market/NAV information
+
PRIVATE lender policy
        ↓
Chainlink CRE TEE
        ↓
ALLOW / DENY
policy commitment
decision receipt
        ↓
Hedera substitution
```

The public chain learns enough to enforce the decision.

It does not learn the whole lender policy.

Remove Chainlink:

Either:

- reveal the sensitive policy publicly, or
- trust our server to claim the replacement was eligible.

That's a real regression.

Chainlink removal score:

5/5 if we build this properly.

Potential track:

### Chainlink, Best Confidential Workflow

$2,000 pool, up to two teams receive $1,000. The confidential computation must be meaningful and core to the application, exactly what this architecture gives us. ([ETHGlobal](https://ethglobal.com/events/ethonline2026/prizes/chainlink "ETHGlobal"))

---

# 3. Privy, institutional authority

Then there is another real problem.

Who is allowed to replace $1 million of collateral?

It shouldn't be:

```text
connect MetaMask
click substitute
```

Institutional workflows require people and policies.

Privy's B2B track explicitly wants organization wallets, policies, team permissions, quorum approvals, intents and automated business operations. ([ETHGlobal](https://ethglobal.com/events/ethonline2026/prizes/privy "ETHGlobal"))

So we represent two actual parties:

```text
Borrower Org
Treasury operator
        +
Risk approver

Lender Org
Collateral operator
        +
Policy signer
```

A substitution could require:

```text
Borrower proposes
        ↓
Chainlink verifies hidden eligibility
        ↓
Lender quorum approves
        ↓
Privy signs execution
        ↓
Hedera atomically switches collateral
```

Privy supports EVM-compatible chains generally, including custom EVM networks, so Hedera's EVM surface can be configured rather than forcing the financial workflow onto another chain. ([Privy Docs](https://docs.privy.io/basics/react/advanced/configuring-evm-networks?utm_source=chatgpt.com "Configuring EVM networks - Privy Docs"))

Potential track:

### Privy, Best B2B Financial Product

$2,500.

Their current requirements line up almost one-for-one with us: business use case, functional financial operation and a control such as policies, signers, quorum or intents. ([ETHGlobal](https://ethglobal.com/events/ethonline2026/prizes/privy "ETHGlobal"))

---

# So one operation uses all three

This is the important distinction from sponsor stacking.

We're not doing:

```text
Hedera page
Chainlink page
Privy login
```

We're doing:

```text
            PRIVY
   who has authority?
              │
              ▼
          proposal
              │
              ▼
          CHAINLINK
does private lender policy
accept replacement collateral?
              │
          allow/deny
              │
              ▼
           HEDERA
lock replacement + release
old collateral without
closing financing
```

Each sponsor answers a different question:

| QuestionSponsor                                                |           |
| -------------------------------------------------------------- | --------- |
| What asset is being pledged and where does its lifecycle live? | Hedera    |
| Does the substitute meet confidential risk rules?              | Chainlink |
| Who is authorized to request/approve the operation?            | Privy     |

Take any one out and a material guarantee disappears.

That's what I should have been optimizing for from the beginning.

---

# Why this is a much stronger product

First, it's connected to an existing financial workflow.

We're not inventing "onchain collateral substitution" because a hackathon wants tokenization.

DTCC already runs the function in traditional repo markets. Their current description says dealers reclaim securities by replacing them with equivalent collateral while keeping the repo intact. ([DTCC](https://www.dtcc.com/clearing-and-settlement-services/ficc-gov/repo-subs?utm_source=chatgpt.com "Repo Collateral Substitution"))

And their March 2026 digital-securities work explicitly identifies seamless digital collateral substitution as an interoperability problem whose improvement could increase liquidity and reduce funding costs. ([DTCC](https://www.dtcc.com/dtcc-connection/articles/2026/march/04/-/media/interoperable-digital-asset-securities-white-paper.pdf?utm_source=chatgpt.com "5.3 Collateral management: Substituting one digital twin for another"))

So the product wedge is:

```text
existing institutional operation
            ↓
tokenized programmable version
```

That's exactly the familiar-first pattern we want.

## It also has a broader company

Start:

Repo collateral substitution.

Expand:

```text
Collateral Switch
      │
      ├─ Repo
      ├─ Securities lending
      ├─ Derivatives margin
      ├─ Prime brokerage
      ├─ Treasury collateral
      └─ Tokenized credit
```

The eventual product is a collateral operating layer where assets can be pledged, evaluated, substituted, released and recalled subject to private institutional policies.

That's a serious B2B infrastructure company thesis.

---

# The demo can be excellent

We don't start by explaining repo mechanics for two minutes.

Start with:

> "You borrowed $900k against a $1m Treasury. Now you need that Treasury back. Normally you can't simply remove the thing securing your loan."

Then show:

### Screen 1

```text
ACTIVE FINANCING

Loan
$900,000 USDC

Collateral
US Treasury A
$1,000,000

Coverage
111.1%
```

### Request

```text
Replace Treasury A

with

Treasury B
$1,020,000
```

Then:

```text
Private lender policy
██████████████████

Evaluated confidentially
```

CRE returns:

```text
ELIGIBLE
Policy commitment: 0x...
```

Privy:

```text
2 / 2 approvals
```

And Hedera:

```text
SUBSTITUTION SETTLED

Treasury B → locked
Treasury A → returned

Loan closed? NO
Financing interrupted? NO
```

Then we immediately attack it.

Treasury C:

```text
REJECTED
INSUFFICIENT ELIGIBLE COVERAGE

Treasury A remains locked
Loan remains secured
```

That refusal is the winning moment.

---

# The scientific proof is unusually clean

Your skill requires a baseline, counterfactual and ablation rather than "look, it works."

### Baseline

Traditional naive tokenized workflow:

1. return old collateral
2. close/unwind state
3. transfer replacement
4. open/update financing

Or another multi-step contract where collateral is independently released and deposited.

### Treatment

Collateral Switch:

```text
verify replacement
+
obtain authority
+
atomic collateral transition
```

We measure real things, not invented percentages:

- number of state transitions
- transaction legs
- intermediate undercollateralized states
- failed partial states
- approvals required
- collateral continuity
- policy disclosure
- replay resistance

The strongest invariant:

> At no point may the borrower receive Treasury A unless an eligible Treasury B is already committed to the financing state.

Then adversarial cases:

- insufficient-value replacement
- wrong asset class
- frozen ATS token
- expired valuation
- prohibited issuer
- concentration limit breached
- unauthorized operator
- missing quorum
- stale CRE decision
- replayed decision
- duplicate substitution
- replacement transfer failure

If any of those releases the old collateral, we failed.

That's a serious security demonstration.

---

# And the 100-run question works

Instead of one hand-picked pair:

Generate a frozen cohort of collateral-substitution requests across:

- values
- haircuts
- maturity buckets
- issuers
- concentrations
- compliance status
- freezes
- policy expiries
- signer combinations

Run the exact same pipeline.

Something like:

```text
40 valid replacements
30 policy violations
10 authorization failures
10 stale-data cases
10 boundary cases
```

Those are target cohort shapes, not claimed results.

Then report whatever actually happens.

Your skill says repeated runs should create a meaningful evidence set, rather than repeating one demo 100 times.

---

# Competition footprint

This gives us exactly the three partner selections we want:

| SponsorTrackAvailable prizeOur fit |                            |                              |       |
| ---------------------------------- | -------------------------- | ---------------------------- | ----- |
| Hedera                             | Tokenization of Anything   | $6,000 pool, max $2,000/team | 5/5   |
| Privy                              | Best B2B Financial Product | $2,500                       | 4.5/5 |
| Chainlink                          | Best Confidential Workflow | $2,000 pool, max $1,000/team | 5/5   |

So the theoretical sponsor haul from those three specific tracks for one team is $5,500, assuming ETHGlobal permits awards across those sponsors and we actually place in all three.

More important, it gives us an overall-finalist-caliber product because the integrations combine into one mechanism instead of three bounties stapled together.

---

# I checked the obvious competing directions too

This changes my ranking.

### Agent service trust / SLA

Hedera + Graph + Bazantic sounds attractive.

Kill.

AgentRouter already built an inference marketplace with x402, provider staking, verification and slashing. A2A, AgentGate and multiple other recent submissions also occupy agent discovery/payment/trust territory. ([ETHGlobal](https://ethglobal.com/showcase/agentrouter-deqhv?utm_source=chatgpt.com "AgentRouter | ETHGlobal"))

### Private treasury / FX

Arc + Chainlink + Privy.

Tempting, but much more crowded. Recent ETHGlobal work already contains private finance, agent treasuries and Chainlink confidential underwriting. Even Kreditos is already combining Privy and Chainlink confidential financial decisioning. ([ETHGlobal](https://ethglobal.com/showcase/kreditos-f7y3w?utm_source=chatgpt.com "Kreditos | ETHGlobal"))

### ENS + Hedera + Graph agent reputation

Absolutely kill.

Assay already has real Hedera settlement, ENS state and live Graph verification in one agent trust system. ([ETHGlobal](https://ethglobal.com/showcase/assay-26egq?utm_source=chatgpt.com "Assay | ETHGlobal"))

### Tokenized repo collateral substitution

I searched the ETHGlobal corpus specifically for this mechanism and didn't find an obvious existing project whose core product is mid-life repo collateral replacement while keeping the financing open.

And Hedera's sponsor itself is explicitly asking for tokenized repo collateral. ([ETHGlobal](https://ethglobal.com/events/ethonline2026/prizes/hedera?utm_source=chatgpt.com "ETHGlobal"))

That's exactly the type of negative space we want.

---

# Revised ranking

1. Collateral Switch, Hedera + Chainlink + Privy
   CONDITIONAL LOCK
2. Graph + Chainlink + Privy private covenant enforcement
   REVISE, good product but much closer to generic private risk automation
3. Freehold, ENSv2
   Strong ENS-specific bounty attack, but no longer my best overall ETHOnline choice
4. Arc + Chainlink + Privy private FX/treasury
   KILL due to crowding
5. Hedera + Graph + x402 agent economy
   KILL due to extreme crowding

And this time the Product Lock isn't unconditional.

Before we freeze Collateral Switch, I'd make it pass five kill gates:

1. Hedera ATS can actually issue/manage the two collateral instruments we need on testnet.
2. We can implement substitution so old collateral can never be released before replacement collateral is secured.
3. Chainlink CRE really evaluates a private lender policy inside its confidential handler and its result genuinely gates settlement.
4. Privy's organization/policy/quorum path can execute the real Hedera EVM operation, not just provide login UX.
5. No prior ETHGlobal or sponsor reference implementation already implements essentially the same repo-substitution mechanism.

If those survive, this is the first idea in our exploration that I would be comfortable putting all three sponsor slots behind.
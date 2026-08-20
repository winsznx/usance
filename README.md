# Usance

**The clearing layer that makes tokenized assets usable as capital.**

Tokenization proves an asset exists. It does not tell a lender what rights the holder owns, who
owes them, how redemption works, or how much of the position could actually be recovered under
stress. Those answers live in documents, and today nothing turns them into enforceable financial
capacity.

Usance does. It reads the real evidence behind a tokenized asset, extracts structured claims from
it, commits a versioned **Asset Passport** onchain, derives a conservative **recognised collateral
value** from deterministic policy, and lets the holder finance against it on X Layer — with limits
the contract enforces and capacity that moves on its own when the evidence changes.

> **AI interprets reality. Deterministic code controls money.**
>
> A model can read a prospectus and propose that redemption is supported. It cannot set a
> loan-to-value ratio, move collateral, create debt, or approve a withdrawal — not because it is
> asked not to, but because no such function is reachable from anything it produces.

**Usance Sentinels** extend that principle to autonomy. A Sentinel watches your account and acts on
its own — repaying to hold a safety buffer, say — but only through a bounded mandate you sign. It
observes, plans and asks; deterministic policy and your mandate decide. It cannot widen its own
permissions, cannot withdraw collateral, and cannot let an AI-only reading raise your risk. See
`docs/SENTINELS_ARCHITECTURE.md` and invariants I-60…I-74 in `spec/invariants.md`.

---

## Try it in two minutes

```bash
make doctor        # confirm the toolchain
make bootstrap     # install everything from a clean checkout
make test          # 17 contract tests + 36 TypeScript tests, no network needed
make demo-local    # http://localhost:3000
```

Then open **http://localhost:3000/simulate** — the full mechanism computed live from the frozen
canonical scenarios, no wallet and no deployment required.

---

## What is actually real

This section is the point of the README. Every claim below is reproducible from a fresh clone.

### Verified live

| Claim | How to check it yourself |
|---|---|
| X Layer mainnet is chain 196, testnet 1952 | `make verify-integrations` |
| Chainlink Data Feeds are live on X Layer and Usance reads them | `make verify-integrations` reads three feeds onchain |
| LayerZero V2 endpoint id on X Layer is 30274 | `make verify-integrations` |
| The risk pipeline is deterministic and reproducible | `make test-differential` |
| Solidity, TypeScript and the spec transcription agree to the wei on 22 scenarios | `make test-differential` |
| ERC-8021 builder-code attribution is correctly encoded | `pnpm --filter @usance/xlayer test` |
| Deposit → borrow → refuse-above-limit → repay → withdraw works end to end | `cd contracts && forge test --match-contract Lifecycle` |
| An evidence change moves capacity and blocks new risk with no manual state edit | `forge test --match-test test_passportUpdateChangesCapacityAndBlocksNewRisk` |

### Not available, and not faked

| Integration | Status | Consequence in the product |
|---|---|---|
| ChainGPT extraction | No API key configured | Extraction runs single-path; those Passports are **capped** by policy and cannot unlock corroboration-gated capabilities |
| Exchange OS / TradeZone | No builder access granted | `/app/protect` and `/app/trade` render as unavailable with the reason shown. No synthetic fill is ever presented as an execution |
| xStocks on X Layer | Exact contract address unverified | No xStocks asset is registered. The rebasing corporate-action accounting is implemented and tested against a fixture token |
| Chainlink Data Streams | **Not deployed on X Layer at all** | Nothing routes through it. The adapter is retained for the day it exists |
| Circle CCTP | X Layer is not a supported domain | Not a dependency of any path |

The internal planning material recorded Chainlink **Data Streams** as confirmed on X Layer. It is
not. Chainlink's own registry lists X Layer with `supportedFeatures: ["feeds"]`, and every X Layer
product carries `deliveryChannelCode: "DF"`. Usance builds on Data Feeds instead. The correction
and its evidence are in [`docs/INTEGRATIONS.md`](docs/INTEGRATIONS.md).

**No contracts are deployed yet.** No funded deployer key is available in this environment, so
`deployments/manifest.ts` is empty and `/app` says so in plain language rather than rendering an
empty portfolio that looks like a working account. `make deploy-testnet` is ready and takes a
`DEPLOYER_PRIVATE_KEY`.

---

## How it works

```
real issuer evidence
   → content-hashed and committed        EvidenceRegistry
   → structured claims extracted         (AI proposes; it has no authority)
   → Asset Passport committed            PassportRegistry, versioned, Merkle-rooted
   → deterministic policy applied        RiskPolicyRegistry + RiskMath
   → recognised collateral value         min(haircut mark, stressed exit, redemption floor)
   → deposit on X Layer                  CollateralVault
   → borrow within an enforced limit     ClearingHouse + FinancingEngine
   → evidence changes                    new Passport version
   → new risk epoch                      capacity falls automatically
   → new risk is refused onchain         no keeper, no manual edit
```

### Recognised value, worked through

$1,000 of a tokenized T-bill is not $1,000 of borrowing power:

| Step | Value | Why |
|---|---:|---|
| Market value | $1,000.0000 | quantity × oracle price |
| After five haircuts | $980.1309 | volatility, liquidity, issuer, settlement, crosschain — applied in a fixed order |
| Stressed exit value | $999.0000 | what this size would actually fetch, from the exit curve |
| Redemption floor | $990.0000 | what the issuer's terms guarantee |
| **Recognised collateral** | **$980.1309** | the most conservative of the three |
| Borrow limit | $833.1113 | × 85% initial LTV |

Those exact figures are asserted in `contracts/test/Lifecycle.t.sol`, in
`fixtures/canonical/risk-scenarios.json`, and by the TypeScript library that renders them in the
browser. If any of the three disagreed by one wei, `make test-differential` would fail.

---

## Repository

```
spec/            the constitution — accounting, invariants, state machines, threat model
fixtures/        frozen conformance scenarios shared by all implementations
contracts/       Solidity core + adapters, Foundry tests
packages/domain  the same risk maths in TypeScript, for previews only
packages/xlayer  chain config, ERC-8021 builder codes
apps/web         the product surface
docs/            integration verification record
scripts/         fixture generation, live integration verification
```

Start with [`spec/accounting.md`](spec/accounting.md). It is the document every implementation
obeys, and it is where rounding direction, identifier derivation and the valuation formula are
frozen.

---

## The three-implementation rule

The browser must never invent a financial number. Three independent implementations of the risk
pipeline exist, and they are proven identical on every canonical scenario:

| Implementation | Path | Role |
|---|---|---|
| Solidity | `contracts/src/libraries/RiskMath.sol` | onchain authority |
| TypeScript | `packages/domain/src/risk.ts` | browser preview, no authority |
| Python | `scripts/gen_fixtures.py` | direct transcription of the spec; generates the fixtures |

`make test-differential` regenerates the fixtures from the spec, compares them byte-for-byte with
what is committed, then runs both the Solidity and TypeScript conformance suites against them.

---

## Commands

| Command | What it does |
|---|---|
| `make doctor` | Verify the toolchain |
| `make bootstrap` | Install everything from a clean checkout |
| `make test` | Every deterministic test, no network |
| `make test-differential` | Prove the three implementations agree (invariant D-01) |
| `make verify-integrations` | Re-run the Phase 0 checks against live endpoints |
| `make demo-local` | The walkthrough at `localhost:3000` |
| `make deploy-testnet` | Deploy to X Layer testnet (needs `DEPLOYER_PRIVATE_KEY`) |
| `make build` | Compile contracts and build the web app |

---

## Known gaps

Stated plainly, because a limitations section that only lists things you have already fixed is
not a limitations section:

1. **Not deployed.** No funded key in this environment. The deploy script is written and the
   manifest pipeline exists, but no address has been broadcast.
2. **The Rust reference engine is not built.** `spec/accounting.md` names it as the third
   implementation. Python currently fills that role as a direct spec transcription. The
   differential property holds; the language does not match the plan yet.
3. **Mandates, intents and liquidation are specified but not implemented.** `MandateRegistry`,
   `IntentBook` and `LiquidationManager` have frozen interfaces and invariants (I-19 through
   I-31) and no Solidity yet. The core lifecycle was finished first deliberately.
4. **Remote collateral is designed, not built.** LayerZero endpoint ids are verified and the saga
   is specified; the escrow contracts are not written.
5. **The web app covers landing, onboarding and the walkthrough.** Deposit, borrow, repay and
   withdraw are implemented and tested at the contract layer with full state coverage, but their
   dedicated routes are not built out.
6. **No E2E suite yet.** Playwright is specified in the plan and not written.

Items 3 through 6 are ordinary remaining work. Item 1 is a credential. Item 2 is a deviation from
the plan that is recorded rather than hidden.

---

## Licence

Contracts are BUSL-1.1. Specifications and documentation are CC BY 4.0.

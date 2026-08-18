# Decisions

Architecture decisions that a reader would otherwise have to reverse-engineer, or that contradict
the planning material. Each records what was decided, what it displaced, and what evidence forced
it. Newest first.

A decision belongs here when it changes what an implementer must do. Routine choices live in code
comments where they can be read next to the thing they explain.

---

## D-015 — A validation artifact is valid only if it proves its own freshness

**Decision.** Every generated verification artifact carries a `$provenance` block —
`generatedAt`, `gitCommit`, and where applicable `chainId`, `deploymentDigest`, `inputDigest`,
`generatedBy` — and every consumer checks it. A missing artifact is a failed run, never a clean
one. Artifacts are written to a temporary path and renamed, so a failed run cannot leave the
previous successful artifact looking current.

**Why.** The same failure shipped three times in one session, and each time a gate reported success:

| Artifact | What happened | What the gate said |
|---|---|---|
| `deployments/manifest.ts` | Described contracts superseded by a redeploy | "deployment is live and wired" |
| `proof/passport-*.json` | Cited a PassportRegistry that had been replaced | receipt rendered normally |
| Slither JSON | Slither refuses to overwrite an existing `--json` file, so the gate re-read the previous run | "0 new findings", with an injected `tx.origin` check and a `selfdestruct` in the tree |

In all three the consumer asked "does a file exist?", found one, and stopped. None of them asked
"does this describe the world I am checking?"

`generatedAt` is deliberately not the load-bearing field. A timestamp says when a file was written,
not what it was written from. The digests are what actually detect drift, and a wall-clock bound is
only a backstop for artifacts that describe something changing continuously.

**Displaces.** The implicit convention that a committed artifact is current because it is committed.

**Evidence.** `scripts/_artifact.mjs`, `services/evidence/test/artifact-freshness.test.ts` (8 tests),
and the bytecode comparison in `scripts/live-xlayer.mjs`, which now fails when the manifest points
at a contract this checkout does not compile to.

---

## D-014 — Unconfigured oracle freshness refuses new risk

**Decision.** `ClearingHouse.settlementFreshness` is a `{configured, maxAgeSeconds}` pair. An
unconfigured policy blocks new borrowing and leaves every risk-reducing path open. `maxAge == 0` is
rejected by the setter; opting out requires calling `clearSettlementFreshness`, which advances the
epoch.

**Why.** The previous version used `maxAge == 0` to mean "no bound", which made *never configured*
and *deliberately unbounded* the same state — and the shared reading was the permissive one. Every
deployment was one forgotten transaction away from lending against a feed that had stopped
publishing.

The bound itself is measured, not guessed. `make characterize-feeds` walks 23 rounds of each
Chainlink feed on X Layer mainnet:

| | |
|---|---|
| Documented heartbeat | 86,400s |
| Worst observed gap | 86,479s |
| USDC/USD median gap | 86,419s |
| USDT/USD median gap | 86,419s |

Two findings follow. A threshold set at the documented heartbeat would reject honest feeds, because
the worst real gap is 79 seconds past it. And the settlement-relevant pairs publish *only* on
heartbeat — they never trip a deviation threshold — so a settlement price is roughly a day old at
almost all times. Any threshold guessed downward from intuition would have bricked borrowing
permanently.

The enforced bound is two heartbeats: a feed must miss a full publication cycle before new risk is
refused.

**Displaces.** "The bound defaults to zero, because a guessed threshold on a chain whose feed
cadence nobody has characterised produces outages that look like protocol failures." That reasoning
was right about guessing and wrong about the default. The answer was to measure, not to disable.

**Evidence.** `artifacts/oracles/xlayer-mainnet-feeds.json`,
`contracts/test/OracleFreshness.t.sol` (14 tests, 6 mutations verified).

---

## D-013 — Route naming follows the canonical PRD, not the build prompt

**Decision.** Routes follow `internal/usance-prd-canonical.md` §6.3 where the two sources
disagree.

**Why.** The build prompt §7 and the canonical PRD §6.3 specify different route maps for the same
screens, and the prompt itself says the canonical PRD is the primary product source.

| Screen | Build prompt | Canonical PRD (used) |
|---|---|---|
| Add collateral | `/app/deposit` | `/app/collateral/add` |
| Protect | `/app/protect` | `/app/intent/new?goal=protect` |
| Trade | `/app/trade` | `/app/intent/new?goal=trade` |
| LP surface | `/app/earn` | `/earn` |
| Developer entry | `/docs` | `/developers` |
| Account health | `/app/risk` | folded into `/app` risk panel |

The PRD's intent routes are the better design: Protect and Trade compile into the same
`ExecutionPlan` through the same authorization pipeline, so giving them separate top-level routes
would duplicate that surface and invite the two from drifting apart. `/earn` sits outside `/app`
because a liquidity provider is a different persona, not a mode of the capital-user dashboard.

**Open.** If the shorter prompt names are preferred for the demo, they should be added as
redirects rather than as second implementations. Neither exists yet.

---

## D-012 — The canonical fixture set spans 6, 8 and 18 decimals

**Decision.** `fixtures/canonical/risk-scenarios.json` carries six mixed-decimal scenarios
(S23–S28) at non-round prices, in addition to the original 18-decimal set.

**Why.** Every one of the original 22 scenarios used 18-decimal assets, which divide evenly.
Mutation testing showed four separate mutations surviving the *entire* suite in every
implementation: the issuer/settlement haircuts swapped, market value rounded up, the
concentration cap rounded up, and debt rounded down. Those are four of the decisions
`spec/accounting.md` explicitly freezes, and the conformance set could not see any of them.

All four now die in both Solidity and Rust, verified by applying them. A conformance set that
cannot detect a violation of the spec it conforms to is decoration.

---

## D-011 — Two tests that could not fail

**Decision.** `test_controllerExposesNoRiskIncreasingFunction` asserts reachability with
arity-correct calldata and a positive control. `testFuzz_noMandatePermitsWithdrawal` gives the
agent its own collateral and proves it can move that while the owner's stays untouched.

**Why.** The first called each forbidden signature with zero arguments; every signature takes at
least one, so the ABI decoder reverted on short calldata whether or not the function existed. It
passed against a controller implementing all nine. The second asserted that an address holding no
collateral could not withdraw collateral.

Both have been checked by deliberately introducing the failure they claim to catch. A test whose
own doc comment says "this fails the moment somebody adds one" should be run against a version
where somebody did.

---

## D-010 — A guardian cannot disable the settlement asset's price feed

**Decision.** `ChainlinkFeedAdapter` has a `protectedFeed` set. Governance marks the settlement
feed protected at deploy time; guardians are refused on protected feeds.

**Why.** Disabling a *collateral* feed only restricts: the price degrades to invalid, new risk is
blocked, and every exit stays open. Disabling the *settlement* feed did the opposite — it made
`_settlementPrice()` revert, which took `repay()` and `availableBorrow()` with it. That is a
guardian action that increases user risk by removing the exit, which `spec/threat-model.md` §6
says is not a power guardians have. The asymmetry was invisible because both go through the same
setter.

---

## D-009 — The usd18 / settlement-token boundary lives in ClearingHouse

**Decision.** `LiquidityVault` books are denominated exclusively in settlement-token units.
`FinancingEngine` reports interest and write-offs in USD and writes nothing to the vault.
`ClearingHouse` converts at every boundary, and is the only holder of the vault's `CLEARING` role.

**Why.** Debt is denominated in USD (so collateral maths stays coherent through a depeg) while the
vault holds tokens. The conversion has to happen somewhere, and only `ClearingHouse` holds an
oracle. The previous arrangement had `FinancingEngine` pushing a usd18 delta straight into
`accruedReceivables`, which `totalAssets()` sums against a 6-decimal token balance: thirty days of
interest on a $5,000 loan inflated NAV by roughly 271,000,000x and made every lender withdrawal
revert while `maxWithdraw` still reported a healthy figure.

Two things follow. `FinancingEngine` no longer needs the `CLEARING` role at all, so the role's
blast radius shrinks to one contract. And any future component that wants to move vault cash has
to state its unit at the boundary, because the vault's functions now name theirs.

This supersedes the second half of **D-004**: the role check stays, but only `ClearingHouse` holds
the role.

---

## D-008 — The deployer is generated locally and is not funded

**Decision.** `scripts/deployer.mjs` generates a deployment key into `.env` (gitignored) and
reports its funding status. No key is committed. No deployment has been broadcast.

**Why.** A repository that expects a human to hand-manage a deployment key ends up with that key
in git history. Generating into a gitignored file, printing only the address, and failing loudly
with the exact shortfall makes the funding blocker reproducible rather than tribal knowledge.

**Current state.** Deployer `0xBA8132637cbFCE8d76991E1D681aa2e29f204b05` holds 0 OKB on X Layer
testnet. `make deployer` exits 4 with the faucet URL. Everything else in the build is unaffected
and continues to run.

---

## D-007 — `make test-live-xlayer` treats "not deployed" as success

**Decision.** The live smoke test exits 0 with an explanatory message when no deployment exists,
and non-zero only when a recorded deployment fails a check.

**Why.** Conflating "we have not deployed" with "deployment is broken" trains people to ignore a
red build. The script distinguishes them, and checks wiring rather than only bytecode presence,
because a deployed-but-unwired protocol passes a bytecode check and does nothing.

---

## D-006 — The web app refuses to render a portfolio without a deployment manifest

**Decision.** `deployments/manifest.ts` is a generated TypeScript module that is empty until a
broadcast. When a chain has no entry, `/app` states that plainly instead of rendering zeroes.

**Why.** An empty portfolio and a working portfolio with no balance are visually identical and
mean completely different things. Rendering the former as the latter is the most quietly
dishonest thing a DeFi front end can do. A static JSON import was rejected because a missing file
would be a build failure rather than a legitimate state.

---

## D-005 — Interest rate is derived from the stored index, not the projected one

**Decision.** `FinancingEngine.currentRateBps()` computes utilisation from `totalBorrowsStored()`
(the last-accrued index) rather than from the projected index.

**Why.** Deriving the rate from the projected index makes `currentIndex()` and `currentRateBps()`
mutually recursive. This was a real bug: it stack-overflowed the moment any time passed between
interactions, and it took a `-vvvv` trace to find because the revert surfaced as a bare
`EvmError: Revert` several frames up. The economics agree with the mechanics — a rate applies
over the interval that begins where the previous one stopped.

---

## D-004 — `LiquidityVault` is authorised by role, not by a single stored address

**Decision.** The vault checks `Authority.CLEARING` rather than a stored `clearingHouse` address.

**Why.** Both `ClearingHouse` (which moves cash) and `FinancingEngine` (which recognises interest)
must call the vault. The original single-address design locked `FinancingEngine` out, and the
symptom only appeared once enough time had passed for interest to accrue. `CollateralVault`
deliberately keeps the tighter single-address check: it holds user assets, it has exactly one
legitimate caller, and tightest-possible is the right default for custody.

---

## D-003 — ERC-8021 decoding recovers the suffix boundary by candidate scan

**Decision.** `hasBuilderSuffix()` checks only the fixed 17-byte tail. `decodeBuilderCodes()`
recovers the code by testing each candidate length and requiring the length byte to be
self-consistent and the payload to be printable ASCII.

**Why.** Schema 0 encodes `<length> ‖ <code>` with the length byte **first**, but the suffix is
specified as parsed backwards from the end of calldata. After stripping the marker and schema id
there is no delimiter marking where the caller's own calldata ends and the suffix begins, so a
naive backwards read of the length byte is wrong. The first implementation had exactly that bug.

Encoding is what matters for attribution, and encoding follows the specification exactly.
Consumers needing certainty should read the emitted event rather than re-parse calldata.

---

## D-002 — The redemption floor participates in the valuation `min()` conditionally

**Decision.** Recognised value is `min(haircutMark, stressedExit)`, and the redemption floor joins
that set **only when the Passport says redemption is supported**.

**Why.** The planning material writes it as an unconditional
`min(haircutMark, stressedExit, redemptionFloor)`. Taken literally, an asset with no redemption
path has a floor of zero and is therefore worth zero as collateral, which would exclude most
tokenized assets including every one Usance intends to admit first. The conditional form is
identical whenever redemption exists and non-binding when it does not. Nothing else changes.

Recorded rather than silently "fixed" because it is a deviation from a frozen document.

---

## D-001 — X Layer uses Chainlink **Data Feeds**, not Data Streams

**Decision.** `ChainlinkFeedAdapter` reads push-based `AggregatorV3Interface` feeds.
`ChainlinkStreamsAdapter` is retained as an interface with fixture tests, is registered in no
deployment, and no asset routes through it.

**Why.** The canonical PRD records Data Streams as "Confirmed on X Layer mainnet + testnet". That
is wrong. Chainlink's own network registry describes X Layer as:

```json
"xlayer": {
  "label": "X Layer",
  "title": "X Layer Data Feeds",
  "supportedFeatures": ["feeds"],
  "rddUrl": "https://reference-data-directory.vercel.app/feeds-ethereum-mainnet-xlayer-1.json"
}
```

`supportedFeatures` contains `feeds` and not `streams`. Every X Layer product in the registry
carries `deliveryChannelCode: "DF"` (Data Feeds), never `"DS"`.

**Evidence.** 26 Data Feeds are published for X Layer mainnet. Three were read back live from the
chain on 2026-08-17 and returned fresh rounds. `make verify-integrations` reproduces this.

**Consequence.** The protocol abstraction is unchanged — `IOracleAdapter` never mentioned either
product. Only the adapter implementation differs. X Layer also publishes an L2 Sequencer Uptime
feed, which the adapter consumes: a price nobody can arbitrage against is not a price to lend
against, and that gate would not have existed under the Data Streams assumption.

**Do not reintroduce the old assumption.** If Chainlink later ships Data Streams on X Layer,
re-verify against the live registry first and record a superseding decision here.

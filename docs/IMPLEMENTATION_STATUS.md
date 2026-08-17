# Implementation status

What exists, what is proven, and what is still owed. Reconciled against the code on 2026-08-17.

Reproduce every number here with `make test`, `make test-differential` and
`make verify-integrations`.

**Proof levels**

| Level | Meaning |
|---|---|
| `SPECIFIED` | Written down in `spec/`. No code. |
| `UNIT_TESTED` | Implemented, with tests that would fail if it broke. |
| `INTEGRATION_TESTED` | Exercised end to end across contracts through the real deployment harness. |
| `LIVE_TESTNET` | Running on X Layer testnet with a recorded transaction. |
| `LIVE_MAINNET` | Running on X Layer mainnet. |
| `EXTERNAL_INTEGRATION` | Verified against a live third-party system. |
| `BLOCKED_EXTERNAL` | Cannot progress without a credential, approval or funds we do not hold. |

Nothing in this repository is above `INTEGRATION_TESTED` except the read-only integration checks,
because **no contract has been deployed**. That is a funding blocker, not a code blocker.

---

## Protocol core

| Subsystem | Path | Tests | Proof | Gap |
|---|---|---|---|---|
| Risk pipeline | `contracts/src/libraries/RiskMath.sol` | 28-scenario conformance + mutation-verified | `INTEGRATION_TESTED` | — |
| Rust reference engine | `crates/risk-core` | 102 | `UNIT_TESTED` | — |
| TypeScript preview | `packages/domain/src/risk.ts` | 29 | `UNIT_TESTED` | — |
| Python spec transcription | `scripts/gen_fixtures.py` | generates the fixtures | `UNIT_TESTED` | — |
| Asset registry | `contracts/src/core/AssetRegistry.sol` | via Lifecycle | `INTEGRATION_TESTED` | — |
| Evidence registry | `contracts/src/core/EvidenceRegistry.sol` | source-class ordering | `UNIT_TESTED` | no offchain pipeline feeding it |
| Passport registry | `contracts/src/core/PassportRegistry.sol` | via Lifecycle | `INTEGRATION_TESTED` | — |
| Risk policy + epochs | `contracts/src/core/RiskPolicyRegistry.sol` | validation + timelock | `INTEGRATION_TESTED` | — |
| Collateral vault | `contracts/src/core/CollateralVault.sol` | Lifecycle + Adversarial | `INTEGRATION_TESTED` | negative-rebase loss allocation, see I-34 |
| Liquidity vault | `contracts/src/core/LiquidityVault.sol` | Lifecycle + Regression | `INTEGRATION_TESTED` | withdrawal queue not built |
| Financing engine | `contracts/src/core/FinancingEngine.sol` | Lifecycle + Regression | `INTEGRATION_TESTED` | — |
| Clearing house | `contracts/src/core/ClearingHouse.sol` | 16 Lifecycle + 8 Regression | `INTEGRATION_TESTED` | — |
| Mandate registry | `contracts/src/core/MandateRegistry.sol` | 56 | `UNIT_TESTED` | not wired into ClearingHouse |
| Intent book | `contracts/src/core/IntentBook.sol` | within Mandate suite | `UNIT_TESTED` | no duplicate-observation guard on `recordFill` |
| Emergency controller | `contracts/src/core/EmergencyController.sol` | 31 Adversarial | `UNIT_TESTED` | not in the deploy script; three powers have no consumer |
| Chainlink adapter | `contracts/src/adapters/ChainlinkFeedAdapter.sol` | Adversarial + Regression | `EXTERNAL_INTEGRATION` (reads verified) | not deployed |
| Liquidation manager | — | — | `SPECIFIED` | not built |
| Remote collateral | — | — | `SPECIFIED` | not built |
| Venue adapters | — | — | `SPECIFIED` | blocked on Exchange OS access |

## Offchain

| Subsystem | Path | Proof | Gap |
|---|---|---|---|
| X Layer chain config | `packages/xlayer/src/chains.ts` | `EXTERNAL_INTEGRATION` | — |
| ERC-8021 builder codes | `packages/xlayer/src/builder-code.ts` | `UNIT_TESTED` (13) | code not registered with X Layer |
| Evidence service | — | `SPECIFIED` | not built |
| Evidence and audit schemas | `packages/schemas/src/` | `UNIT_TESTED` | — |
| ChainGPT client | `packages/chaingpt/src/client.ts` | `EXTERNAL_INTEGRATION` | — |
| ChainGPT extractor | `packages/chaingpt/src/extractor.ts` | `EXTERNAL_INTEGRATION` | one of two paths; nothing consumes it yet |
| Deterministic parser extractor | `packages/chaingpt/src/parser-extractor.ts` | `UNIT_TESTED` | needs no API |
| ChainGPT news observations | `packages/chaingpt/src/observations.ts` | `EXTERNAL_INTEGRATION` | `assetIds` always empty; nothing routes them yet |
| ChainGPT contract auditor | `packages/chaingpt/src/auditor.ts` | `EXTERNAL_INTEGRATION` | see the CI section for what it does and does not cover |
| Contract audit gate | `scripts/chaingpt-audit.mjs` | `EXTERNAL_INTEGRATION` | — |
| API service | — | `SPECIFIED` | not built |
| Indexer | — | `SPECIFIED` | not built |

The ChainGPT rows say the **providers** are live, and nothing more. A key is configured and all
three surfaces answer; the auditor was exercised end to end during this pass by `make
audit-contracts`, and the extraction and news surfaces are recorded in `docs/INTEGRATIONS.md`
against the same date. The pipeline that would turn an extraction into a committed Passport, fetch
through canonicalise, extract along two independent paths, corroborate and commit, is a separate
line item and none of these rows says anything about it.

## Product surface

| Route | State |
|---|---|
| `/` | built |
| `/status` | built |
| `/simulate` | built — computes the real pipeline over the canonical scenarios |
| `/app` | built — connect, network, session, deployment-aware empty state |
| `/app/borrow` | built — dual-limit quote, epoch-stamped, degrades honestly |
| `/assets`, `/assets/:id` | not built |
| `/app/collateral/add`, `/repay`, `/withdraw` | not built (contract layer is complete and tested) |
| `/app/activity`, `/alerts`, `/mandates`, `/settings` | not built |
| `/earn`, `/institutional`, `/developers` | not built |
| `/proof/:receiptId` | not built |

Shared layer that the remaining routes need is built: `lib/abi.ts`, `lib/tx.ts` (attribution,
staged submission, protocol-error decoding), `components/action.tsx`, `lib/integration-status.ts`.

---

## Invariants

**26 of 34 enforced, plus the differential conformance property D-01.** Full matrix with test
names in [`spec/invariants.md`](../spec/invariants.md).

The 8 still planned are I-02, I-05, I-11, I-15, I-16, I-17, I-21, I-22 — all belonging to
subsystems that do not exist yet (remote collateral, liquidation, the evidence pipeline), except
I-15 which is true by construction today (no extractor holds any role, and no contract accepts
extractor output) but has no test.

---

## Defects found and fixed this cycle

Adversarial review of the parallel build streams found five real defects in code written earlier,
one of which would have locked lender funds. Each has a regression test in
`contracts/test/Regression.t.sol`.

| ID | Severity | Defect |
|---|---|---|
| R-01 | **Critical** | `FinancingEngine` pushed a usd18 interest delta into the token-denominated `LiquidityVault`, inflating NAV ~271,000,000x. Every lender withdrawal reverted while `maxWithdraw` reported a healthy number. Also: repayments passed usd18 into `totalPrincipal`, so the first repayment of any size wiped the vault's recorded principal, and the interest branch of `onRepaid` was unreachable because the caller hardcoded zero. |
| R-02 | Medium | A guardian could disable the settlement asset's price feed, which made `_settlementPrice()` revert and took `repay()` with it — a guardian action that removed the user's exit, contradicting `spec/threat-model.md §6`. |
| R-03 | Low | A borrow below one settlement-token unit rounded to zero tokens out while still recording debt. Violated I-03. |
| R-04 | Low | The full-clear branch of `onRepay` returned before its `emit Repaid`, so indexers never observed a loan closing. |
| R-05 | Low | `RiskMath` subtracted timestamps unsigned, so ordinary L2 clock skew panicked inside `evaluate()` and took every read, borrow and repayment with it — while TypeScript and Python computed a signed difference and gated nothing. A three-way divergence the fixtures could not see. |

### Test-integrity defects

Two tests provably could not fail, and one fixture-set weakness hid four spec violations:

- `test_controllerExposesNoRiskIncreasingFunction` called each forbidden signature with zero
  arguments. Every signature takes at least one, so the decoder reverted on short calldata whether
  or not the function existed. Rewritten as an arity-correct reachability test with a positive
  control, and verified to fail when a forbidden function is added.
- `testFuzz_noMandatePermitsWithdrawal` asserted that an address holding no collateral could not
  withdraw. Rewritten so the agent holds its own collateral and can demonstrably move it, while
  the owner's balance stays untouched.
- **All 22 original canonical fixtures used 18-decimal assets**, which divide evenly. Four
  mutations survived every implementation's full suite: haircut order swapped, market value
  rounded up, concentration cap rounded up, debt rounded down. Six mixed-decimal scenarios
  (S23–S28, at 6 and 8 decimals with non-round prices) were added. All four mutations now die in
  both Solidity and Rust, verified by running them.

---

## Continuous integration

`.github/workflows/ci.yml`. Every action is pinned to a major version, and no deterministic job
needs the network after its dependencies are installed.

| Job | Runs | Blocks a merge |
|---|---|---|
| Lint and typecheck | `make lint` | yes |
| Contracts | `forge fmt --check`, `forge build --sizes`, `forge test` under the `ci` profile | yes |
| TypeScript | `pnpm -r typecheck`, `pnpm -r test`, `pnpm build` | yes |
| Rust reference engine | `cargo test --workspace` | yes |
| Differential conformance (D-01) | `make test-differential` | yes |
| Clean-room reproducibility | fresh checkout in an empty directory, no caches, `make bootstrap` then `make test` then `make test-differential` | yes |
| ChainGPT contract audit | `make audit-contracts` | yes on `main`; elsewhere a missing key or a partial run is tolerated, a finding never is |
| Static analysis | Slither | no, its false-positive rate here is untriaged |
| E2E browser suite | nothing | reports **skipped**, never success |
| Live integration verification | `make verify-integrations` | no, third-party endpoints |

### The audit gate

`scripts/chaingpt-audit.mjs` sends every file under `contracts/src/{core,adapters,libraries,
interfaces}` to the ChainGPT auditor through `ChainGptContractAuditor`, writes
`artifacts/security/chaingpt/<commit>.json` validated by `auditReportSchema` (gitignored), compares
findings against `.chaingpt-suppressions.json`, and exits non-zero on a finding at or above the
severity floor, on partial coverage, and on `AUDIT_UNAVAILABLE`. `--allow-unavailable` collapses
the last two to a pass and is what CI passes on every branch except `main`.

Before it audits anything it audits `fixtures/audit-control/ReentrantVault.sol`, which sends Ether
with a low-level call and decrements the balance afterwards. If that produces no finding the gate
reports itself broken and no branch may tolerate it. Everything between the gate and the model can
fail silently into an empty finding list, and an empty finding list is what a clean contract looks
like too.

### What the audit does and does not cover

First live run over the current tree: **16 files audited, 0 skipped, 0 findings at any severity**,
positive control alive at HIGH. Read that with three qualifications.

1. **The provider stops analysing large inputs.** Measured on 2026-08-17 by injecting one unguarded
   external call before a balance decrement into real files of increasing size: reported at 8,620
   characters of source, silent on the identical defect at 9,651, answering faster than it answered
   the small inputs. Eight of the sixteen files are above that line, including `ClearingHouse.sol`
   (21,610), `IntentBook.sol` (17,726) and `MandateRegistry.sol` (32,856). On those files
   `NO_FINDINGS` means the provider did not look. The run artifact records each file's size and
   lists the oversized ones so the number can never be read as coverage.
2. **`parseFindings` can discard real findings.** `packages/chaingpt/src/auditor.ts` returns an
   empty list as soon as `NO_FINDINGS` appears anywhere in the response, and the model frequently
   appends that line *after* reporting findings: five of the seven responses that contained
   findings during this pass also carried it. The parser is right to be strict and wrong to check
   that token before parsing the finding lines. Open defect, and the reason the control exists.
3. **A model is not an audit.** Nothing here substitutes for the Forge suites, Slither, or review.
   It is a cheap third opinion whose failure modes are now visible instead of silent.

### Remaining CI gaps

- The e2e job is gated off behind the `E2E_ENABLED` repository variable. It reports skipped, which
  is honest, and there is still no browser suite behind it.
- The clean-room job has not yet executed on a GitHub runner. `make bootstrap` was corrected during
  this pass because a bare `forge install` reinstalls nothing when dependencies are vendored with
  `--no-git`, so a fresh clone reached `forge test` with an empty `lib/`.
- `forge-std` is installed unpinned in CI and in `make bootstrap`, so a clean-room build is
  reproducible against everything except that dependency.

---

## Blockers

| Blocker | Prevents | Needed |
|---|---|---|
| Deployer unfunded | Every `LIVE_TESTNET` proof | Test OKB to `0xBA8132637cbFCE8d76991E1D681aa2e29f204b05` |
| No Exchange OS access | Protect, Trade, venue reconciliation | An approved builder application |
| xStocks address unverified | Admitting a real tokenized equity | Issuer confirmation of the X Layer deployment |
| Builder code unregistered | Attribution being credited | Registration with X Layer |

None of these blocks the remaining engineering work.

`CHAINGPT_API_KEY` used to be on this list and is not any more. A key is configured, the Web3 LLM,
News and Smart Contract Auditor surfaces all answer, and `make audit-contracts` runs against the
live API. What that removes is a credential blocker. It does not make the evidence pipeline exist,
and the ChainGPT rows above are worded to keep those two facts apart.

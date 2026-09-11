# Hedera ATS transaction gas policy

## The observed failure

`InstitutionalFacility.abortCommittedSubstitution()` calls through
`HederaAtsCollateralAdapter.release()` into the Series B ATS security token's Diamond
`releaseHoldByPartition` facet — five call frames deep by the time it reaches the internal
hold-execution routine.

`eth_call`-based simulation (`viem.simulateContract`, and the `eth_estimateGas` it uses internally)
reported this call as safe at an estimated gas of **462,086**. A real transaction broadcast at
that exact limit reverted (`CONTRACT_REVERT_EXECUTED`) with **zero partial state mutation** —
confirmed via the Hedera mirror node's `contracts/results` `state_changes` (every `value_written`
was `null`). The mirror node's `contracts/results/{tx}/actions` trace showed the actual point of
failure: a facet call at depth 5 with gas supplied exactly equal to gas consumed (138,600 ==
138,600), returning the literal string `"INSUFFICIENT_GAS"`.

Three independent historical successful releases over the identical call architecture
(`Adapter.release -> releaseHoldByPartition`) used far more gas than this failed estimate:

| call | gas_limit | gas_used |
|---|---|---|
| historical release 1 | 609,933 | 468,020 |
| historical release 2 | 682,946 | 541,753 |
| historical release 3 | 754,965 | 586,053 |
| **failed abort (this incident)** | **462,086** | 451,533 (full revert) |

The failed transaction's entire gas limit was lower than even the smallest historical success's
gas *used*. Retrying with an explicit manual gas of 900,000 succeeded, using only 385,071.

This is a concrete, evidence-backed estimator gap for calls that traverse this many ATS Diamond
facet hops — not a generic claim that "Hedera is unreliable," and not something retried blindly:
the first failure was diagnosed via the mirror node's authoritative trace before any retry was
attempted.

## The policy

`apps/web/lib/hedera-ats-gas-policy.ts`:

```
raw estimate (diagnostics only, never the cap)
  -> evidence-backed floor, per method
  -> validate floor < current block gas limit
  -> selected gas
  -> simulate with selected gas
  -> broadcast with the SAME selected gas
```

Floors, from live historical `gasUsed` with headroom:

| method | floor | basis |
|---|---|---|
| `abortCommittedSubstitution` | 900,000 | proven successful live at this limit (used 385,071) |
| `commitReplacement` | 1,150,000 | ceil(max historical gasUsed 900,215 × 1.25) |
| `releaseOld` | 900,000 | above all three historical successes (max used 586,053; live run at this limit used 678,211) |

`selectHederaAtsGas` never lowers the floor based on a low estimate, and flags
(`estimatorExceededFloor`) when the estimator's own output has grown past the floor — a signal to
revisit the floor, not to trust the estimator instead.

## What this does not change

Contract semantics are untouched. This is purely how the operator-side script/API chooses the gas
number it puts in a transaction; `_assertReleasable` and every other on-chain check are exactly as
frozen. A transaction that fails simulation at the selected gas still stops — the policy makes gas
sizing reliable, not release itself.

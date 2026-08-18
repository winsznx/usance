# Architecture

Usance turns documents into financial capacity without ever letting a document reach a state
change. Everything below follows from that one sentence.

```
evidence → claims → Passport → asset admission → risk policy → recognised value → capacity
```

Reading left to right, each arrow narrows what the next stage can express. By the time anything
reaches money, the interface is a handful of integers.

## The two worlds and the boundary between them

**The evidence world** ingests real documents, canonicalises them, extracts structured claims, and
corroborates those claims across independent extraction paths. It holds no key, imports no wallet
client, and contains no function that broadcasts a transaction. `services/evidence/src/commit.ts`
is where it stops: it produces calldata for something else to sign.

**The money world** is Solidity. It never sees a document. It receives asset ids, version numbers,
32-byte roots, a redemption flag, a basis-point floor and a boolean.

That argument list is the entire attack surface between them. There is no string, no free-form
field, no bytes blob and no callback. "Document content cannot influence control flow" is not a
policy anybody enforces at review time; it is a claim about the width of a struct, and the struct
is in one file.

## Asset Passport

A versioned commitment to what an asset **is** — redemption terms, transfer restrictions, backing
model, corporate-action mechanism. Never what it is **worth**. Prices come from Chainlink feeds and
risk parameters come from governance, and keeping those apart is what stops an evidence pipeline
from becoming a pricing oracle.

Versions are strictly sequential, so history cannot be rewritten or back-filled and a receipt
citing "Passport v39" refers to exactly one thing forever.

`redemptionSupported` and `redemptionFloorBps` sit on the header rather than behind the claims root,
because the risk pipeline reads them on every valuation and must not need a Merkle proof to price.

**Evidence must exist before the Passport that rests on it.** The caller cites evidence ids;
`PassportRegistry` checks each against `EvidenceRegistry` and recomputes the Merkle root from them.
A root that does not follow from committed evidence is not expressible. Ids arrive strictly
ascending, which the caller already knows and the contract would otherwise burn gas rediscovering;
strict ascent also proves distinctness, so one document cannot be cited twice to manufacture a
different root from a single source.

## Corroboration

Claims are grouped by `independenceGroup`, not by call. Two prompts against one model is one path
wearing two hats.

- `CORROBORATED` — two or more groups agree.
- `SINGLE_SOURCE` — one group produced a reading. The Passport is capped.
- `CLAIM_CONFLICT` — groups disagree on a material field.

`CLAIM_CONFLICT` is a discriminated-union variant with no `candidate` key, so committing one is a
type error rather than a runtime check. The corroborator counts paths that **produced a reading**,
never paths attempted, so a provider that fails degrades the Passport's privileges instead of
quietly lowering the evidence standard.

## Risk Epoch

A monotone counter that stamps every risk decision. Quotes cite an epoch, and a transaction quoted
under one epoch reverts under another. Anything that changes what the protocol believes — a new
Passport, a policy change, an oracle swap, a relaxed staleness bound — advances it.

The user-visible consequence is deliberate: leave a tab open long enough and the transaction is
refused rather than executed under rules nobody showed you.

## Recognised value

Market value is not collateral value. Recognition is:

1. Mark the position at the oracle price.
2. Apply five haircuts in a frozen order: market, liquidity, issuer, settlement, cross-chain.
   Sequential, not summed. The order is load-bearing and specified in `spec/accounting.md`.
3. Take `min(haircutMark, stressedExit)`, and `redemptionFloor` too where the asset supports one.

The gap between market and recognised is not a fee and goes nowhere. It is the part of the value the
protocol will not lend against because it could not realise it quickly under stress. `/app/collateral/add`
shows it before anybody signs, because surfacing it afterwards makes the protocol look like it
shortchanged the user.

## Four implementations, one answer

The valuation and capacity pipeline exists four times:

| Implementation | Role |
| --- | --- |
| `contracts/src/libraries/RiskMath.sol` | Authority. Pure, reads no storage. |
| `crates/risk-core` | Rust reference, zero dependencies. |
| `packages/domain` | TypeScript, preview only. Never authoritative. |
| `scripts/gen_fixtures.py` | Transcription of the spec, used to generate fixtures. |

All four agree to the wei across 28 canonical scenarios. S23–S28 exist because the original 22 were
all 18-decimal and every division came out even, which hid four spec violations that mutation
testing then killed.

`MerkleLib.sol` is pinned to `packages/schemas` the same way, by vectors the TypeScript side
generates. A transcribed vector would be a third implementation.

## Authority

| Role | Can |
| --- | --- |
| `GOVERNANCE` | Set oracles, policies, settlement asset, staleness bounds |
| `GUARDIAN` | Restrict — pause a feed, restrict a Passport. Risk-reducing only |
| `ADMISSION` | Register assets, commit evidence and Passports |
| `CLEARING` | Move cash in the liquidity vault. Held only by ClearingHouse |
| `LIQUIDATOR` | Liquidate |

Two constraints matter more than the table:

**A guardian cannot close the exit.** The settlement feed is `protected`, so the power that pauses
a collateral feed cannot brick repayment.

**The deploy key surrenders `ADMISSION` before the script returns.** A deploy key that keeps
admission is a standing backdoor. `contracts/test/Deployment.t.sol` runs the real script and reads
the resulting role table, because unit tests construct contracts directly and never execute the
thing that decides who holds authority over a live protocol.

## Risk-reducing actions are never gated

Repayment works in every account state and under any epoch. Withdrawal is gated only while debt is
outstanding, because only debt makes it risk-increasing; a debt-free account owns its collateral
outright, and a state machine that refuses to hand it back has stopped being custody-free.

The settlement-price staleness check follows the same rule: enforced on borrowing, deliberately not
on repayment. A contract that refuses repayment because a feed went quiet has locked the exit.

## Receipts

Every recorded action produces a receipt with the transaction hashes needed to check it. `CONFIRMED`
is schema-refused without a successful transaction, and a hash that is not a full 66 characters is
dropped rather than padded — a padded hash is a fabricated one wearing the right shape.

Reverted transactions appear on receipts. In this protocol a refusal that reached the chain is the
strongest evidence there is: it is the difference between a disabled button and a contract saying
no.

## Layout

```
contracts/          Solidity. The authority.
crates/risk-core/   Rust reference implementation.
packages/schemas/   Zod schemas, identifier derivation, Merkle.
packages/domain/    Preview-only TypeScript risk math, UI formatting.
packages/chaingpt/  Extraction client, chunking, auditor.
packages/xlayer/    Chain metadata, ERC-8021 builder codes.
services/evidence/  Ingestion, extraction, corroboration, calldata, receipts.
apps/web/           Next.js. Proof explorer and the account flows.
fixtures/canonical/ Differential scenarios and Merkle vectors. Generated.
spec/               The frozen constitution.
proof/              Records written by the scripts that submitted the transactions.
scripts/            Deploy, commit, reconcile, verify.
```

---

## Authority

```
Owner
  │  delegates a bounded subset, signed EIP-712
  ▼
Mandate ──────────► Agent
  │                   │  proposes and executes, within limits
  │                   ▼
  └──────────► ClearingHouse
                      │  protocol policy still has final veto
                      ▼
                 money moves
```

The constitution:

```
AllowedAction = ProtocolAllows ∧ MandateAllows
```

Never `∨`. A mandate can only narrow what the protocol already permits. `executeDelegated` calls
`MandateRegistry.authorize`, which reverts with the exact bound that was hit, and then runs the same
internal mechanics an owner's own call runs. There is no branch where one check satisfies the call
alone.

Authorization inputs are read from live protocol state. An agent that could supply its own projected
debt could pass any ceiling by understating it.

**An agent cannot withdraw user collateral.** Enforced twice, deliberately redundantly. The mandate
action vocabulary contains no outflow verb, and `ClearingHouse` reverts on every action its
delegated switch does not name — including any member added to the enum later. An enum nobody will
widen is a promise about future commits; a switch that refuses everything it does not name is a
rule. An owner who signs a mandate granting every bit in the vocabulary still cannot delegate an
outflow.

Owners never need a mandate to use their own account. Mandates exist for delegated authority only.

**Currently delegable:** `REPAY`, `ADD_COLLATERAL`. Both reduce risk or add value, and the agent
funds them from its own balance.

**Currently refused:** `BORROW`, `TRADE`, `HEDGE`, `CLOSE`. The registry checks their caps
correctly, but no venue execution path is wired, so granting them would authorise an act with
nowhere to go.

# Usance Sentinels — live proof (X Layer testnet)

**Chain:** X Layer Testnet, chainId `1952` · explorer `https://www.oklink.com/x-layer-testnet`
**Deployer / owner / publisher:** `0xBA8132637cbFCE8d76991E1D681aa2e29f204b05`
**Authority (existing core):** `0x263c72eabe2d0d323ea9dce71c80c75f673d5a38`

This records a **live, on-chain proof of the Sentinel contract layer**: the two registries are
deployed additively beside the already-live Usance core (no core redeploy, D-020), a template is
committed immutably, an instance pins it, and a mismatched-manifest registration is refused as a
mined revert. Every hash below is a real testnet transaction.

## Deployed (additive — core untouched)

| Contract | Address | Deploy tx |
|---|---|---|
| SentinelTemplateRegistry | `0xd8e1c67cf2b3ae98e414d937653a51556432c275` | `0x1e5788489bbf546428dff458c9c8c550d6d1beb19efc383694be9a17cf146609` |
| SentinelInstanceRegistry | `0x882c941a94cab3d1c40ec5ac5d1d7d3499436d08` | `0x5d57685a12d4dd2e0434bf2042e52ae479edfe0d23abd0d91c70bb174ae7795f` |

Both are ~4.5 KB, well under EIP-170, and hold no role on any money contract.

## Exercised on-chain

**Positive — a versioned template and a pinned instance.**

| Step | Result | Tx |
|---|---|---|
| `commitTemplate` T1 Safety Buffer v1 (RISK_REDUCING_ONLY, actions REPAY+ADD_COLLATERAL, risk-state trigger) | mined, status `0x1` | `0xa096089b032ad571e3c2988429bc57b959d73c3e9f908cb768682eec55fe9b73` |
| `registerInstance` pinning templateId + manifest hash | mined, status `0x1` | `0x203c2288c4c36cc013199cae226b2283d47d9e1c5ad5a28c6f27b8fda4f047e3` |

- templateId: `0x0dbe0105712f0a5adb4df2b9b70ca24cbb5ed045d5fe2533c92591f1eea40dc4`
- instanceId (from the `InstanceRegistered` event): `0xb7124e9653e1372ae726976086d2dd6213140014a13d122d622b4a85194961c1`

**Negative — a mined refusal (I-62, pin integrity).**

| Step | Result | Tx |
|---|---|---|
| `registerInstance` with a **mismatched manifest hash** | **mined revert**, status `0x0`, `ManifestMismatch` (selector `0xe07a5886`) | `0x97a68428aa879197c5cda8b363a4a8c45683edea6babebca3f6aa4bf2a11ba4d` |

The refusal is a real mined transaction that reverted — not an off-chain check. It proves an
instance cannot bind a template whose committed manifest it does not exactly match.

## What this proves, and what it does not

**Proven live on chain:** the Sentinel registries exist on X Layer testnet; a template is committed
with immutable, sequential versioning; an instance pins `(templateId, version, manifestHash)`; and a
mismatched pin is refused as a mined revert (I-62). Combined with the offline test suites
(`contracts/test/Sentinel.t.sol`, `services/sentinel/test/*`), the contract-layer invariants
I-61/I-62/I-68 are demonstrated against the live chain.

## The autonomous run (§58) — live

The flagship: a Sentinel reduced the owner's debt **with no human sending the transaction**, driven
by the engine through live viem adapters (`services/sentinel/src/live/xlayer.ts`), reproducible with
`pnpm --filter @usance/sentinel exec vite-node scripts/live-proof.mts`.

| Field | Value |
|---|---|
| Run | `0xc29b11e6a87dd3de63dc5fa7f21545f2acd6b766a17dcdad5c02fbb8e3d1731c` → COMPLETE |
| Owner | `0xBA8132637cbFCE8d76991E1D681aa2e29f204b05` |
| Agent executor (distinct) | `0xCe80551383e738705eDB9844f604Bf9138Dc01E8` |
| Trigger | RISK_STATE · DETERMINISTIC_ONCHAIN |
| Plan | REPAY $0.01, risk-reducing |
| Autonomous REPAY tx | `0xb037f143ffe9b39f23b348e23f079518d40a9d74394aa008e25d740a1831df61` (block 38767411) |
| Debt | 0.02913 → 0.01913 tUSD |
| Receipt | CONFIRMED (`SENTINEL_RUN_EXECUTED`) |

The engine ran the full loop — TRIGGER_OBSERVED → SNAPSHOT_PINNED → PLAN_READY → AUTHORIZATION_CHECKING
→ AUTHORIZED → SUBMITTED → FILLED → RECONCILED → COMPLETE — reading live state and checking
`ProtocolAllows ∧ MandateAllows` before the bounded agent submitted the repay through
DelegationGateway. Full record: `proof/live-sentinel.json`; claim promoted to `LIVE_TESTNET` in
`proof/claims.json`.

New borrowing on this account is separately refused with `AccountNotHealthy` (the testnet mock feeds
are stale after two days, so the protocol gates *new* risk). That is why the Sentinel reduced a
standing debt rather than creating one: REPAY is risk-reducing and remains available while new risk
is gated — exactly the situation a Safety Buffer Sentinel exists for.

## Still offline, not faked

The runtime is proven end-to-end offline against a mock chain in `services/sentinel/test/engine.test.ts`
(duplicate-trigger single-effect, execution-unknown retains budget, epoch-race block, weak-trigger
asymmetry, crash-resume). The live run above exercises the same engine against real adapters for one
REPAY; the broader trigger classes and venue actions remain offline-only until those venues exist.

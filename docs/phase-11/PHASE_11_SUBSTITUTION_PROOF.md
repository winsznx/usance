# Phase 11 institutional substitution — canonical live proof manifest

One durable economic operation, proven end to end through the authenticated web-orchestration
stack over the frozen Phase 06/07 Hedera facility. No secrets below — public evidence only
(addresses, hashes, tx hashes, timestamps).

## Identity

| | |
|---|---|
| operationId | `aef33739-0c28-45c1-9f79-e29345cda36d` |
| requestId | `0xb1d927f704bd47533a34d800609827fec3ad95c94620b2843e35ac4a67809526` |
| facilityId | `0x6534fdf67d36afeeb7118c7d81c7f4e06ab548735483ca249afcf12e6f75b1ee` |
| InstitutionalFacility | `0x6B0A0c10450E11C86e7b6b9A69068e43B28Ef8B7` (Hedera testnet, chain 296) |
| economic intent | Series A → Series B, 150,000 units, RiskEpoch 2 |
| final durable state | `COMPLETED`, version 56 |

## Proof-level legend

- **LIVE_TESTNET** — a real transaction confirmed on Hedera testnet or Sepolia
- **LIVE_SIMULATION** — a real `cre workflow simulate` run of the actual Go CRE Confidential
  Workflow, reporter-signed; not a deployed DON
- **HISTORICAL_PROOF** — a fact established in an earlier phase's proof artifact, re-verified live
  before being relied on again in this operation
- **CURRENT READ** — a read-only chain/mirror-node observation taken at report time

## Chronology

| step | proof level | evidence |
|---|---|---|
| ENS authority (Sepolia EACRegistry role) | HISTORICAL_PROOF, re-verified LIVE_TESTNET each use | `docs/ethonline-2026/proof/ensv2-authority.json` |
| org authentication (SIWE-shaped session) | LIVE_TESTNET | institutional auth challenge/verify, this operation's `USANCE_API` events |
| Privy 2-of-2 org approval (1st package) | LIVE_TESTNET | authority tx `0x5c2b2f69a8e5c75f58fef7109762dd00ea9b2e9c8b39706a7d5abc2a12ae9a89` |
| CRE confidential lender-policy ALLOW (1st) | LIVE_SIMULATION | policy tx `0xb7debdc9e41ae37215a8a14cf2759a0e35d4bb70cc404799767a4ec6180c5cd0` |
| requestSubstitution (1st) | LIVE_TESTNET | `0xcec1bf95f5a861da6b98017e8fa8fd11197752bb7c76bac4345ebe7cfb0e1de9` |
| commitReplacement (1st, Series B committed) | LIVE_TESTNET | `0x5e59813b903c39efd1227828cf618fca490db6d923ddb309c0a6ea641613aefb` |
| release blocked — settlement price stale | LIVE_TESTNET (simulate-only revert, decoded) | `PriceUnusable(settlementAssetId)`, no tx broadcast; durable event `RELEASE_BLOCKED` |
| abort attempt 1 — under-gassed | LIVE_TESTNET (reverted, zero state mutation) | `0x76efa45503611713546523ed66117a30bc70c4fd29355133a2f3ee5342e84e98` |
| gas forensic diagnosis | CURRENT READ (Hedera mirror node `contracts/results/.../actions`) | classification `GAS_EXECUTION_FAILURE`, confidence HIGH |
| abort attempt 2 — manual gas 900,000 | LIVE_TESTNET | `0xca010e03741ab9cb51a5bb95ee21d3382be2f1834efd309f50fe3f48c42a73c9` |
| settlement test-fixture price refresh | LIVE_TESTNET (numeric value unchanged) | `0x50aa4c99f9ec8933c76fdfe2c40f3158c3a51b9f6c6f897b782a0113074b5c3d` |
| fresh authority package (2nd) | LIVE_TESTNET | tx `0xd8d7a20e2ff46cf5590aa1abcd60e9e49c6190a912912058a9b839e677f00a29` |
| fresh policy package (2nd, CRE ALLOW) | LIVE_SIMULATION | tx `0xd2ad97c71b1a9b42da75907afe67c0559cb4a1df98aa53ae99d86433d8bf3e76` |
| requestSubstitution (2nd) | LIVE_TESTNET | `0x9efa559e54ab0d7378092eee483e5412432d7f1a94180e85b534e89f1926dce4` |
| commitReplacement (2nd, explicit gas 1,150,000) | LIVE_TESTNET | `0x2cd4a70ab2c40caf22ba73a10d9ca1ae16d87973d5ed6293f96a03a145f1b85d` |
| release blocked — replacement collateral price stale | LIVE_TESTNET (simulate-only revert, decoded) | `CoverageFailed(owedUsd18≈100048.13, recognisedUsd18=0)`, no tx broadcast; durable event `RELEASE_BLOCKED_REPLACEMENT_PRICE_STALE` |
| Series B test-fixture price refresh | LIVE_TESTNET (numeric value unchanged) | `0xa1209b13e7262d223631a26874d94e36205333288fb3059a991a7486cc698f87` |
| releaseOld — final, explicit gas 900,000 | LIVE_TESTNET | `0x37924db3ee4c712e7f2cd3a5c00200703f243a7e63f12b655e06f4fd018f55da`, gas used 678,211 |

## Final financial state (CURRENT READ at completion)

| | |
|---|---|
| facility status | ACTIVE |
| current collateral adapter | AdapterB (`0xC5E77C98165633c1B093b8bf76d1b923856dFf42`) |
| Series A committed | 0 |
| Series B committed | 150,000 |
| outstanding financing | ~100,048.25 settlement units — open |
| substitution state | NONE (cleared) |
| durable operation | `COMPLETED`, version 56 |

## Explicitly not claimed

- Chainlink CRE is **LIVE_SIMULATION**, not a deployed DON — never promoted.
- 0G integration status is tracked separately and unaffected by this proof; see the 0G phase docs
  for its own current status.
- X Layer production admission still respects the Phase 09 external-semantics blocker; this proof
  makes no claim about it.
- Base Sepolia canary status is unaffected by and unrelated to this Hedera-facility proof.

`docs/ethonline-2026/proof/hedera-facility-deployment.json` remains the contract-address source of
truth; its `policyCommitment` field is a known-stale leftover from initial deploy — the live
on-chain configured value (read via `EthOnlinePolicyVerifier.facilityPolicy`) is authoritative, not
that file's field.

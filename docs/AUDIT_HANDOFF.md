# Audit handoff

Written for someone with no development history, who intends to break this. Everything here is
checkable from a fresh clone.

**Commit** `3c16434a01460557f1c11efe48b366f9b6e885ff`
**Chain** X Layer testnet, 1952
**Claims** 39 (1 EXTERNAL_INTEGRATION, 4 INTEGRATION_TESTED, 18 LIVE_TESTNET, 7 NOT_YET_PROVEN, 9 UNIT_TESTED)

---

## 1. What Usance is, in one paragraph

AI reads issuer documents and produces structured claims. Deterministic code decides what those
claims are worth as collateral. The two never mix: no function reachable from an extractor sets a
risk parameter, and the interface between them is the argument list of `commitPassport` — asset id,
version, evidence ids, two roots, an expiry, a bool, a bps value, a bool. No string, no bytes blob,
no callback.

## 2. Deployed contracts

| Contract | Address |
|---|---|
| `authority` | `0x263c72eabe2d0d323ea9dce71c80c75f673d5a38` |
| `assetRegistry` | `0x70d4fcd5414ed20538f1778f7028dc949409958d` |
| `evidenceRegistry` | `0xdba478bef267df507bd0726d54ac5daa0177ffdf` |
| `passportRegistry` | `0x3d5ce1e17451134e6748b896e6f0ab1dbae0cd50` |
| `riskPolicyRegistry` | `0xc1e338ab59b450738108e8643ea73e2696c8d552` |
| `oracleAdapter` | `0x11d4a1ed14f8883a6ca40ff01d9543cd7cc09ebc` |
| `collateralVault` | `0x68a29192aeac5415d991b0f72edf1ded135bcb7a` |
| `liquidityVault` | `0xf5a5ca0981c575a2a49e016ea7d0f69c67dd1771` |
| `financingEngine` | `0x002fc00ca45afd710ad333e4375402bb55e19327` |
| `clearingHouse` | `0xa38c072f7970d70f00c5ad9b911c222357255cc0` |
| `feeController` | `0x44fe9a83186c4c9fc20f14342b10b59861ad1961` |
| `mandateRegistry` | `0x71dd68dfc114be35d5fdb524aa21b9d699e9cf5b` |
| `delegationGateway` | `0x1fe2f202d0ce10d20f3a8470c4cab51d45993659` |
| `intentBook` | `0x35eaa2f92045eb6ced6817a296a7ddf701854442` |

Labelled testnet stand-ins (NOT any issuer's token):

| | |
|---|---|
| `settlementToken` | `0x14494c714cb18f24a5fe68c6136203781abb2676` |
| `settlementFeed` | `0x5222271f7a2b712fb9b1f662f4a68faaab36dc89` |
| `collateralToken` | `0x17837c668aa0aba07b0e9129a7f849afb9c73c9b` |
| `collateralFeed` | `0xeb6c32d451bde299b58bf9e9e69f48dd3199134a` |
| `sequencerFeed` | `0x1227648cb4db2085ae1b7b9c9f6887f58f5b125d` |
| `collateralAssetId` | `0x61745a589d0f9875ca3eaeae7588162918edea2e1e85670ff4703c9d75a140d8` |

`make test-live-xlayer` compares deployed runtime bytecode against what this checkout compiles. If
it passes, the addresses above are this source.

## 3. Trust assumptions

These are where an auditor should start, because they are what the system cannot defend against.

1. **Chainlink feeds are honest.** A compromised aggregator misprices collateral directly. Usance
   bounds staleness and gates on sequencer uptime; it does not detect a lying-but-fresh feed.
2. **The extraction model can be wrong.** Defended structurally rather than by trusting the model:
   corroboration counts independence groups, a single group caps the Passport, and a conflict is a
   type error. A model that is confidently wrong *and* corroborated by a second independent group
   would still commit.
3. **Governance is trusted for admission.** GOVERNANCE can admit assets and set policy. It cannot
   raise a fee ceiling (constants), cannot un-revoke a mandate, and cannot reach the exit.
4. **The deploy key is trusted for exactly one transaction.** It surrenders ADMISSION before the
   script returns; asserted by running the real deploy and reading the role table.
5. **X Layer finality.** The indexer confirms behind head; the depth is a parameter, not a proof.

## 4. Privileged roles

| Role | Can | Cannot |
|---|---|---|
| GOVERNANCE | admit assets, set policy, set fees within constant ceilings, replace oracle | exceed a ceiling, un-revoke a mandate, withdraw user collateral |
| GUARDIAN | pause collateral feeds, pause mandates | disable a protected settlement feed, resume a mandate it paused, close the exit |
| ADMISSION | commit evidence and Passports | move money |
| CLEARING | reserve capacity, act on behalf via `actOnBehalf` | withdraw collateral (no such function exists) |
| LIQUIDATOR | run liquidation routes | liquidate a healthy account |
| `canBumpEpoch` | advance the risk epoch | anything else; it takes no argument and moves no money |

## 5. Economic invariants worth attacking

```
collateral seized (market) = debt retired + keeper incentive + protocol fee + route loss
repairPerDollar            = 1 - (1 + t)m
recognised                 = min(haircutMark, stressedExit[, redemptionFloor])
AllowedAction              = ProtocolAllows AND MandateAllows
```

The third has a deliberate deviation: the redemption floor participates in the `min` only when
redemption is supported. `spec/accounting.md` records why.

## 6. High-risk code paths

Ranked by what a bug there would cost.

1. `ClearingHouse._settleLiquidation` — three-way split, value conservation, rounding residual.
   Dust deliberately lands on the borrower's debt rather than in a fee.
2. `LiquidityVault` share accounting and the withdrawal queue — `queuedFunded` and
   `queuedLiabilities` must never let the same unit be offered to two parties.
3. `FinancingEngine` index accrual — the usd18/token boundary. This already produced a defect that
   inflated NAV by ~271,000,000x while `maxWithdraw` reported healthy.
4. `DelegationGateway.execute` — the conjunction. An early return between the two checks would make
   it a disjunction.
5. `RiskMath` haircut order — frozen and load-bearing; reordering changes every recognised value.
6. `MandateRegistry._reasonFor` — every bound an agent could exceed.
7. `Projections.apply` — idempotency. A handler that accumulates instead of assigning corrupts
   silently.

## 7. Things that look like bugs and are not

- A liquidation can be valid, reduce debt, reduce collateral, and leave the account in
  `MARGIN_CALL`. Seizing collateral removes borrowing capacity as well as debt.
- A double reservation release does not revert; it saturates. A reconciler retrying after an
  ambiguous receipt must not be punished.
- `withdraw` reverting on a vault with deployed capital is correct. The queue is the remedy.
- An unconfigured freshness policy blocks borrowing. That is the fail-closed default.

## 8. Reproducing

```
make test                     231 Forge
make test-differential        Solidity/Rust/TypeScript/Python agree to the wei
make test-indexer             19
make lint
make build
make slither                  fails on any untriaged finding
make test-e2e                 126 Playwright, desktop + Pixel-class
make test-artifact-freshness  5 stale-artifact attacks, all must be rejected
make test-live-xlayer         deployed bytecode == built bytecode
make clean-room               fresh clone, deterministic gates
```

Mutation testing is not automated. The mutations verified so far are recorded in commit messages;
each was applied, the suite was confirmed to fail, and the mutation reverted.

## 9. What is NOT proven

Read `docs/MASTER_COMPLETION_CHECKLIST.md` for the full list. The load-bearing gaps:

- Autonomous BORROW, TRADE, HEDGE, CLOSE are refused at the gateway. The registry checks their caps
  correctly; no venue path is wired.
- No external venue execution of any kind. Exchange OS needs credentials; OKX DEX has no X Layer
  testnet deployment.
- LayerZero remote collateral is not implemented.
- Explorer source verification has not been run.
- Live revocation has not been proven onchain.
- The indexer projects mandates and account activity only.
- No mainnet deployment, and no real issuer token has ever been custodied.

## 10. Attack ideas the author has not tried

Offered because they are the gaps in my own testing rather than a checklist I have already cleared.

- Reentrancy through a malicious ERC20 as the settlement asset. Every path assumes a well-behaved
  token; fee-on-transfer and rebasing are untested.
- Precision attacks on the exit curve at tier boundaries, where recognised value steps.
- Griefing the withdrawal queue by inserting many small requests ahead of a large one, given the
  16-step-per-call bound.
- Mandate digest malleability across a chain id change.
- Forcing `CONFIRMATION_UNKNOWN` accumulation until reconciliation is unusable.
- Whether `_accrueAndRecognise` ordering can be exploited within a single block.

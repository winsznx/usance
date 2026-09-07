# spec/ethonline-institutional.md — the ETHOnline institutional adapters

Status: **frozen** for Phase 07. Additive to the frozen Phase 06 facility. It changes no Phase 06
interface (`ICollateralAdapter`, `IAuthorityVerifier`, `IPolicyVerifier`) and no deployed core.
`DECISIONS.md` D-027.

This document answers: **how the four ETHOnline sponsors participate in "replace eligible
collateral without unwinding an active financing facility" without any of them becoming Usance's
financial authority.**

`InstitutionalFacility` remains the sole authority for debt, facility status, committed collateral,
substitution state, old-collateral release and settlement. The sponsors provide custody, authority
evidence and policy computation; the facility validates and finalises.

---

## 1. Roles

| Sponsor | Primitive | Phase 06 seam | What it materially decides |
|---|---|---|---|
| **Hedera ATS** | security token + **Hold** facet + ComplianceByPartition | `ICollateralAdapter` (`HederaAtsCollateralAdapter`) | whether the replacement units are irreversibly held for the facility, and whether the replacement asset passes ATS compliance |
| **ENSv2** | hierarchical registry + Enhanced Access Control | authority evidence digest inside `EthOnlineAuthorityVerifier` | whether an account currently holds the delegated collateral-operations role for the organisation |
| **Privy** | server wallet + key quorum / policy-gated signer + intent | `IAuthorityVerifier` (`EthOnlineAuthorityVerifier`) | whether the organisation actually signed *this* `FacilityDecision` |
| **Chainlink CRE** | Confidential Workflow (TEE handler) | `IPolicyVerifier` (`EthOnlinePolicyVerifier`) | whether the replacement candidate passes the lender's private policy |

Home domain: **Hedera testnet** (chain 296, Cancun EVM). ENSv2 lives on Sepolia; it is external
evidence, never a facility-state domain (I-75).

## 2. Hedera ATS collateral adapter

Commitment is an **ATS Hold** (`IHoldByPartition.createHoldFromByPartition`), never an invented
`lock()`:

```
Hold {
  amount:              units
  expirationTimestamp: 0        // never expires => the holder cannot reclaim
  escrow:              adapter  // only the adapter may release / execute before expiry
  to:                  holdDestination  // a facility-controlled address, fixed at deploy
  data:                abi.encode("USANCE_FACILITY_COMMIT", facility, from)
}
```

Once held: the borrower cannot transfer the units, cannot reclaim them, and only the
adapter-as-escrow — driven by the facility — can move them. That is "irreversibly attributable to
this facility before old collateral becomes releasable".

| `ICollateralAdapter` | ATS mapping |
|---|---|
| `commit(facility, from, units)` | `canTransferByPartition` (compliance, load-bearing) → `createHoldFromByPartition` → credit the **measured** held-balance delta (I-33) |
| `committedOf(facility)` | Σ `getHoldForByPartition(holdId).amount_` — authoritative on-chain ATS state, never cached |
| `reconcile(facility)` | re-read the holds → `COMMITTED` / `NOT_COMMITTED`; `reconciliationPending` (set when an out-of-band ATS query was inconclusive) → `UNKNOWN`, which releases nothing (I-97) |
| `release(facility, rightfulOwner, units)` | `rightfulOwner == holder` → `releaseHoldByPartition` (back to the borrower); otherwise (default) → `executeHoldByPartition` to `holdDestination`, settled onward by the facility. No caller-supplied recipient. |
| `transferable()` | `canTransferByPartition` probe on `holdDestination` |

## 3. Authority verifier — ENS + Privy, independently required

```
EthOnlineAuthorityVerifier
  configureFacility(facilityId, orgApprover, expectedEnsDigest)     [governance, once]
  revokeEnsRole(facilityId)                                          [governance; EAC role revoked on Sepolia]
  submitApproval(FacilityDecision d, bytes32 ensEvidenceDigest, bytes privySignature)   [relayer]
      requires: d.expiry > now
                d.nonce > highestNonce[(facilityId, operation)]      (strictly monotone)
                ensEvidenceDigest == expectedEnsDigest AND !ensRoleRevoked
                ECDSA.recover(keccak(abi.encode("USANCE_ORG_APPROVAL_V1", d.hash(), ensEvidenceDigest)),
                              privySignature) == orgApprover
      => approved[d.hash()] = true
  verify(d, b) -> (ok, decisionHash)
      ok iff d matches b (facilityId, operation, subject, requestId, epoch, policyVersion)
           AND d.expiry > now
           AND approved[d.hash()] AND !isRevoked(d.hash())
  isRevoked(h) = _revoked[h] OR facilityAuthority[decisionFacility[h]].ensRoleRevoked
```

`ensEvidenceDigest` is `keccak` of the pinned ENSv2 EAC observation: name, canonical hierarchy,
ENSv2 contract/version, resource id, required role, resolved account, Sepolia block, decision
timestamp, expiry rule. Recomputed off-chain by the relayer, checked here. Never stored as
`ensApproved = true` (§12).

The Privy signer is the organisation's key quorum aggregate (or a policy-gated signer if the
account cannot provision a quorum — §15). A generic "Approve Usance" signature does not recover to
`orgApprover` because the signed message is the full decision hash plus the ENS digest (§17).

## 4. Policy verifier — Chainlink CRE confidential verdict

```
EthOnlinePolicyVerifier
  configureFacility(facilityId, creReporter, expectedPolicyCommitment, expectedWorkflowVersion)  [governance]
  submitVerdict(d, allow, policyCommitment, workflowVersion, reasonCode, expiry, creReportSig)   [relayer]
      requires: policyCommitment == expectedPolicyCommitment
                workflowVersion  == expectedWorkflowVersion
                expiry > now
                d.nonce > highestNonce[(facilityId, operation)]
                ECDSA.recover(keccak(abi.encode("USANCE_CRE_POLICY_V1", d.hash(), allow,
                              policyCommitment, workflowVersion, reasonCode, expiry)),
                              creReportSig) == creReporter
      => verdict[d.hash()] = {allow, policyCommitment, workflowVersion, reasonCode, expiry}
  verify(d, b) -> (ok, decisionHash)
      ok iff d matches b AND verdict.present AND verdict.allow AND verdict.expiry > now
  permitsCurrentEpoch(h, pinned, current) = epochCarveOut[h]   (governance-set, only after CRE re-attests)
```

The CRE Confidential Workflow evaluates the replacement candidate against the lender's private
thresholds inside a TEE and emits a DON-signed public report carrying only ALLOW/DENY + the bound
fields + a disclosure-safe reason code. The private thresholds are never published (§23). CRE does
**not** return an LTV or override RiskMath (§20) — `InstitutionalFacility._assertReleasable` still
runs the deterministic public checks after `verify` passes.

CLI simulation is the qualifying path (the ETHOnline track accepts it, and Confidential Workflows
is private beta). Live-network deployment, if account-team enrollment lands, changes nothing on
chain — the report signature check is identical.

## 5. Trust boundary

The Hedera facility **cannot read ENSv2 Sepolia state or a CRE result trustlessly** (§13, §21).
The path, with trust marked:

- **Cryptographically verified on Hedera:** the Privy signature over the decision hash; the CRE
  report signature.
- **Verified by sponsor infrastructure:** ENS role validity (ENS contracts, Sepolia); Privy quorum
  threshold (Privy TEE); CRE enclave execution (CRE DON).
- **Attested by an Usance relayer:** the binding of the Sepolia ENS observation into the
  Hedera-side authority decision. The relayer cannot forge an approval (the Privy signature covers
  the ENS digest), but it chooses which Sepolia block to pin — a liveness / censorship trust, not
  a safety one. The ENS and CRE artifacts are independently inspectable on Sepolia / in CRE logs.
- **Merely displayed:** the confidential policy's human-readable name.

No "trustless ENS verification on Hedera" language appears anywhere.

## 6. No silent fallback (§27)

There is no path where ENS unavailable → local DB, Privy unavailable → deployer key, CRE
unavailable → default ALLOW, or ATS unavailable → fixture. Each absence fails closed: the
substitution cannot reach `OLD_RELEASED`, the old collateral stays committed, and the receipt
records which dependency refused.

## 7. Receipts

The substitution receipt (`usanceReceiptSchema`, the Phase 06 institutional `receiptKind` values)
composes the sponsor evidence — it does not replace it:

```
SUBSTITUTION_REQUESTED / REPLACEMENT_COMMITTED / COLLATERAL_RELEASED
  workflowId   = facilityId
  intentId     = requestId
  accountId    = borrower
  financialAssetId = old / replacement assetId
  + linked provenance:
      ENS authority evidence  (name, resource, role, Sepolia block, digest)
      Privy approval          (wallet id, control type, threshold, decision hash)
      CRE policy verdict      (workflow id/version, policy commitment, reason code, expiry)
      ATS commit tx (HashScan) / old-release tx (HashScan)
      RiskEpoch, before/after collateral, final facility state
```

## 8. What does not change

- No Phase 06 interface. `ICollateralAdapter`, `IAuthorityVerifier`, `IPolicyVerifier`, the
  `FacilityDecision` / `DecisionBinding` structs — byte-for-byte unchanged.
- No deployed core. X Layer 1952 untouched.
- `InstitutionalFacility` bytecode unchanged — the adapters are separate contracts it reads
  through the frozen interfaces.
- Nothing deploys until `docs/ethonline-2026/TESTNET_RESOURCE_PLAN.md` resources are supplied.

# ETHOnline 2026 — the live Privy organisational approval

Status: **`LIVE_TESTNET`**. The `FacilityDecision` organisational approval is a real secp256k1
signature from a Privy server wallet that is owned by a two-key quorum. It is load-bearing:
a substitution completes only when that signature recovers to the configured `orgApprover`, and
producing it requires both quorum keys. Proof:
`docs/ethonline-2026/proof/privy-org-signer.json` and
`docs/ethonline-2026/proof/privy-approval-lifecycle.json`.

## 1. What Privy decides

Whether the organisation actually authorised **this** `FacilityDecision`. This is the second of
the two independent inputs to `EthOnlineAuthorityVerifier`; the first is the ENSv2 EAC evidence
digest (`ENS_AUTHORITY.md`). Neither alone approves anything.

## 2. The signer

| | |
|---|---|
| Provider | Privy server wallets (`@privy-io/node` 0.34.0) |
| Key quorum | `mvoortbd9hvtdo2beafjkdjj` — two P-256 authorization keys, `authorization_threshold: 2` |
| Server wallet | id `xaiohupaiqzxqdk9a8hkgtha`, chain type `ethereum`, `owner_id` = the quorum |
| Wallet address | `0xAfdD4312ef4D5F9fd3085F50a4aE4C1F67970d43` — the `EthOnlineAuthorityVerifier` `orgApprover` |
| Secrets | the two P-256 private keys live only in `packages/ethonline/.privy-org.json` (gitignored) |

The wallet's private key never leaves Privy. A signature is produced by
`POST /v1/wallets/{id}/rpc { method: "secp256k1_sign", params: { hash } }`, and Privy runs that
only after the request carries a `privy-authorization-signature` satisfying the quorum. With one
key the API returns `401 … does not match the wallet's authorization threshold`.

## 3. What is signed

```
orgApprovalHash = keccak256(abi.encode(
  "USANCE_ORG_APPROVAL_V1",
  decisionHash,                 // keccak256 of the full FacilityDecision (operation-bound)
  ensEvidenceDigest             // the pinned ENSv2 EAC digest, 0x7cd9fd47…df935
))
```

The Privy wallet signs `orgApprovalHash` on secp256k1. `EthOnlineAuthorityVerifier.submitApproval`
runs `ECDSA.recover(orgApprovalHash, signature) == orgApprover`. Because the signed message is the
exact decision hash plus the ENS digest, a generic "approve Usance" signature does not recover to
`orgApprover` — proven in step 3 below.

Privy's `secp256k1_sign` returns a 65-byte `r‖s‖v` signature with `v = 0x1b/0x1c`, directly
consumable by OpenZeppelin `ECDSA.recover` with no normalization.

## 4. The lifecycle, proven live

`node --env-file=.env packages/ethonline/src/privy/privy-approval-lifecycle.mjs`. Proof:
`docs/ethonline-2026/proof/privy-approval-lifecycle.json`.

| # | Step | Where | Result |
|---|---|---|---|
| 1 | ENSv2 EAC role re-granted (a prior run had revoked it) so both inputs are live | Sepolia | `0x91cc079d…`, `hasRoles` → true |
| 2 | `configureFacility(facilityId, 0xAfdD…0d43, ensDigest)` — `orgApprover` is now the Privy wallet | Hedera | `0x7f2a545d…` |
| 3 | **negative control A** — org approval signed by a NON-Privy key (the operator's own key): `submitApproval` reverts `WrongSigner` | Hedera | reverted |
| 4 | **negative control B** — Privy `secp256k1_sign` requested with only ONE quorum key: Privy returns `401` (threshold 2) | Privy API | refused |
| 5 | positive — SUBSTITUTE A→B, org approval from `signSecp256k1` over `orgApprovalHash` with BOTH quorum keys; recovers to `0xAfdD…0d43` | Hedera | `submitApproval` `0xc5cf9f78…` |
| 6 | CRE ALLOW verdict | Hedera | `0x238bd7d6…` |
| 7 | `requestSubstitution` → `commitReplacement` (**B held while A still held**, `committedOf(A)=committedOf(B)=150000`) → `releaseOld` | Hedera | `0xf4d60844…` / `0x933f8212…` / `0x2c18ec14…` |

Result: `PASS — a non-Privy signature is refused on chain, one quorum key is refused by Privy, and
a real substitution completed only under a dual-key Privy approval.`

## 5. No silent fallback

If the quorum will not sign (one key unavailable, policy denies), `submitApproval` is never called
with a valid signature, `approved[decisionHash]` stays false, `requestSubstitution` cannot pass
`IAuthorityVerifier.verify`, and the old collateral stays committed. There is no deployer-key
fallback path.

## 6. What is real here

- **Real:** the Privy key quorum and server wallet; the dual-key authorization requirement enforced
  by Privy; the secp256k1 signature over the decision hash + ENS digest; the on-chain
  `WrongSigner` rejection of a non-Privy signature; the substitution that completed only under the
  quorum signature.
- **Operator-played, replaced next:** the Chainlink CRE policy verdict is still the operator's key
  in this run. CRE replaces that signature next; the verifier contract does not change.

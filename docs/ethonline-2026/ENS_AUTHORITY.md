# ETHOnline 2026 — the live ENSv2 institutional authority

Status: **`LIVE_TESTNET`**. The ENSv2 Sepolia Enhanced Access Control delegation is real and it
materially gates the live Hedera institutional facility. Proof:
`docs/ethonline-2026/proof/ensv2-authority.json` (Sepolia) and
`docs/ethonline-2026/proof/ens-authority-lifecycle.json` (the end-to-end run).

## 1. What ENS decides

Whether an account currently holds the delegated collateral-operations role for the organisation.
That fact is one of the two independent inputs to `EthOnlineAuthorityVerifier` (the other is the
Privy organisational signature over the exact `FacilityDecision`). Neither alone activates or
substitutes anything. If the ENS role is gone, no new substitution can be approved.

## 2. The name and the hierarchy

| Field | Value |
|---|---|
| Name | `usance-institutional.eth` |
| Registry | ENSv2 `ETHRegistry` (beta) `0xbdc85dd5b15d7ecb354cd7cb6f2c50b4f2c4f0e2` |
| Registrar | ENSv2 `ETHRegistrar` `0xa88553f454b77203b0d036a05c894d555eaaa2cc` |
| Resolver | `PublicResolverV2` `0xe7b9a25607e02da8145e4eb1836ca539e53f11f7` (resolved fresh at register time, not cached) |
| Source of addresses | `ensdomains/contracts-v2` @ `97a57293`, `contracts/docs/addresses/sepolia.md` (deployed 2026-07-30) |
| Registration tx | `0x15e3f49d5efeff01e91b79b6dcbac8e5a0d2a3ce1df47f67e4c29f1cd9b13731` |
| Chain | Sepolia (11155111) |

`usance-institutional.eth` is a 2LD registered directly in the ENSv2 `ETHRegistry` under `.eth`.
The name resource is the institutional namespace the organisation controls; delegating rights over
it is delegating administrative control of that namespace.

`usance.eth` was not available on the beta registrar, so a clearly-labelled institutional test name
was registered instead (Phase 07 brief, user instruction — "a clearly labelled test name if it is
not").

## 3. Resource derivation

ENSv2 `PermissionedRegistry` scopes every role to a `uint256` resource. For a freshly registered
name (EAC version 0) the resource is the labelhash with its low 32 bits cleared:

```
labelhash = keccak256("usance-institutional")
          = 0x167907432aa259f1aa12bae6694a339f338148f53dea1f92d020493fffceefa9
resource  = LibLabel.withVersion(labelhash, 0)          // replaces the low 32 bits with the version
          = 0x167907432aa259f1aa12bae6694a339f338148f53dea1f92d020493f00000000
```

Read back live from `ETHRegistry.getState(labelhash).resource`. `grantRoles` / `hasRoles` /
`revokeRoles` accept the bare labelhash and resolve the versioned resource internally. The version
increments if the name is ever unregistered, which gives a re-registered name a fresh permission
scope — so a stale grant cannot survive a re-registration. This is **not** `ROOT_RESOURCE` (0); the
delegation is bound to exactly this one name.

## 4. The role

| | |
|---|---|
| Role bitmap | `0x1100000` |
| Constants | `RegistryRolesLib.ROLE_SET_SUBREGISTRY` (`1 << 20`) `|` `RegistryRolesLib.ROLE_SET_RESOLVER` (`1 << 24`) |
| Resource | the `usance-institutional.eth` name resource (§3) |
| Grantable by | the name owner — the owner receives `REGISTRATION_ROLE_BITMAP` at registration, which includes both these roles plus their admin roles, so the owner can delegate them |
| Account granted | `0x06622c6a328cc0a54C906Fde66Bc597B7FA904C1` — the Usance treasury operator (the same key that is the Privy org-approval signer on Hedera) |
| Grant tx (Sepolia) | `0x308f946bb135ec1a6ac1661f85919a40aafb918b7ad88868225f8eadae0c8208` |
| Revoke tx (Sepolia) | `0x5bc85b62af1286eee627c25e0abcb3200383fe1492dc5fc060c14721820b2f11` (block 11655232) |

### Why this role proves the authority Usance needs

`ROLE_SET_SUBREGISTRY` and `ROLE_SET_RESOLVER` are the two rights that let an account **redirect
the name**: point it at a different child registry or a different resolver. An account that holds
both controls where `usance-institutional.eth` resolves and what lives beneath it. That is the
strongest name-scoped administrative authority the ENSv2 `PermissionedRegistry` exposes short of
transferring ownership. `ROLE_REGISTRAR` (`1 << 0`) is Root-only and cannot be delegated on a name
resource, so it is not a candidate. Delegating SET_SUBREGISTRY + SET_RESOLVER on the exact
institutional name is the concrete on-chain fact that stands in for "this operator is authorised to
run collateral operations for the organisation".

## 5. The authority evidence digest

`EthOnlineAuthorityVerifier.configureFacility(facilityId, orgApprover, expectedEnsDigest)` pins a
digest of the ENS observation. The Privy org-approval signature covers `(decisionHash,
ensEvidenceDigest)`, so the digest is bound into every approval and cannot be swapped.

```
digest = keccak256(abi.encode(
  "USANCE_ENS_AUTHORITY_V1",
  "usance-institutional.eth",
  0xBDC85dD5b15D7ecb354cd7cb6f2c50b4f2c4F0E2,          // ENSv2 ETHRegistry
  "ENSv2-beta-sepolia / contracts-v2@97a57293",
  uint256(resource),                                    // 0x1679...00000000
  uint256(0x1100000),                                   // the role bitmap
  0x06622c6a328cc0a54C906Fde66Bc597B7FA904C1,           // the delegate
  uint256(11655198)                                     // the Sepolia grant block, pinned
))
= 0x7cd9fd471a1559739b850769e64bd95fc77fb5629daf8576b5e0b059ba7df935
```

The pinned Sepolia block is a liveness/censorship trust, not a safety one (spec §5): the relayer
chooses which block to observe, but it cannot forge an approval because the Privy signature binds
the digest. The full human-readable observation (block hash, timestamps, freshness rule) is in
`ensv2-authority.json`.

## 6. The lifecycle, proven live

`node --env-file=.env packages/ethonline/src/hedera/ens-authority-lifecycle.mjs`. Proof:
`docs/ethonline-2026/proof/ens-authority-lifecycle.json`.

| # | Step | Where | Tx |
|---|---|---|---|
| 1 | delegate holds `ROLE_SET_SUBREGISTRY|ROLE_SET_RESOLVER` on the name | Sepolia (read) | `hasRoles` → true |
| 2 | `configureFacility` with the real ENS digest | Hedera | `0xebbea178…` |
| 3 | org approval for SUBSTITUTE B→A, signed over the real ENS digest | Hedera | `0xb202957b…` |
| 4 | CRE ALLOW verdict | Hedera | `0xca9a8929…` |
| 5 | `requestSubstitution` (B→A) | Hedera | `0xd813b310…` |
| 6 | `commitReplacement` — **A held while B still held** (`committedOf(A)=150000`, `committedOf(B)=150000`) | Hedera | `0xe9576b3b…` |
| 7 | `releaseOld` — B returned to the borrower, A is the collateral | Hedera | `0x71c1007c…` |
| 8 | revoke `ROLE_SET_SUBREGISTRY|ROLE_SET_RESOLVER` from the delegate | Sepolia | `0x5bc85b62…` (block 11655232, `hasRoles` → false) |
| 9 | `authorityV.revokeEnsRole(facilityId)` | Hedera | `0xe1bc06e9…` |
| 10 | a NEW substitution's `submitApproval` **reverts `EnsRoleIsRevoked`**; `authorityV.verify(newDecision)` → false | Hedera | reverted |
| 11 | the completed B→A substitution is **not rolled back** — facility still `ACTIVE`, collateral still series A at 150000 units, before and after the revoke | Hedera (read) | — |

Result: `PASS — real ENS delegation gated a live substitution; revoking it on Sepolia blocked the
next one; the completed substitution stayed on chain.`

## 7. Historical validity after revocation

`EthOnlineAuthorityVerifier.revokeEnsRole` sets `ensRoleRevoked = true`, which makes `isRevoked`
return true for every outstanding decision of that facility and makes `submitApproval` fail closed.
It does **not** touch facility state. The B→A substitution had already reached `OLD_RELEASED`
before the revoke: `releaseOld` ran, the receipt was emitted, the facility transitioned. Those
effects are immutable on Hedera. `ens-authority-lifecycle.json` records `facilityStatus` and
`committedOf` for series A identical before and after the Sepolia revoke — `notRolledBack: true`.
The contract comment on `revokeEnsRole` states this directly: "A substitution that already released
the old collateral is unaffected."

## 8. What is real here

- **Real:** the ENSv2 name, its EAC resource, the SET_SUBREGISTRY + SET_RESOLVER grant and revoke
  on Sepolia; the digest binding into the Hedera authority verifier; the live substitution that
  only completed while the role was held; the refusal once it was revoked.
- **Operator-played, replaced next:** the Privy org-approval signature is still the operator's key
  in this run (it signs over the *real* ENS digest now). Privy replaces that signature next; the
  verifier contract does not change.

# ETHOnline 2026 — sponsor capability matrix

Status as of **2026-09-07**. Compiled from current official documentation and the ETHOnline 2026
prize page, not from the Product Lock or earlier research. Each row is re-verified against the
actual SDK/contracts at the point of implementation; a claim here that is not yet backed by code
in this repo is marked `DOC-ONLY`.

Contradiction handling (Phase 07 brief §0): **A** = external API changed, architecture holds, adapt
behind the seam. **B** = capability gone, report blocker. **C** = satisfying the sponsor needs a
locked financial invariant changed, STOP with RFC. None of the rows below are **C**.

---

## Hedera — Asset Tokenization Studio ($6,000 track)

| Field | Value |
|---|---|
| Exact primitive | ATS security token (Diamond pattern, modular facets) + the **Hold** facet for collateral commitment + a compliance facet (ControlList / KYC allowlist, freeze, pause) |
| Current version / SDK | `@hashgraph/asset-tokenization-*` from `github.com/hashgraph/asset-tokenization-studio` — monorepo `packages/ats/sdk` (TypeScript) and `packages/ats/contracts` (Solidity). Facets: **ERC-1400, ERC-3643, Hold, Clearing**, plus compliance/ControlList/freeze/pause. `DOC-ONLY` for exact function signatures — resolved against the installed SDK in step 4. |
| Network / environment | Hedera **testnet**, chain id **296**, JSON-RPC relay `https://testnet.hashio.io/api`. EVM: **Cancun** (TSTORE/TLOAD/MCOPY/PUSH0 supported since mainnet 0.50.0 / full EVM compatibility July 2026; blob opcodes not supported — Usance uses none). |
| Official source | `hedera.com/product/asset-tokenization-studio`, `docs.hedera.com/hedera/open-source-solutions/asset-tokenization-studio-ats`, `docs.tokenization-studio.hedera.com`, `hedera.com/blog/hedera-integrates-erc-3643-token-standard-into-asset-tokenization-studio` |
| Credential / access requirement | A Hedera testnet account (`0.0.x`) + testnet HBAR (faucet: `portal.hedera.com`). No commercial gate. |
| Production status | ATS is production on Hedera mainnet; ERC-3643 support shipped Nov 2025. `LIVE`. |
| What Usance uses it for | The **replacement collateral asset (B)** and the **currently-committed asset (A)** are ATS security tokens. `ICollateralAdapter.commit` maps to the ATS **Hold** primitive (escrowed, attributable to the facility) or, if Hold cannot express irreversible facility attribution, a custody transfer into a facility-controlled Hedera address. `committedOf` reads authoritative on-chain held/locked balance. Compliance control (transfer restriction / freeze) is the load-bearing negative: an ineligible asset C cannot be committed. |
| What it does NOT prove | It does not prove Usance's coverage math, the substitution invariant, or that the lender's private policy is satisfied. ATS attests custody and compliance state only. |
| Failure mode | Adapter `canCommit` / `commit` reverts or `committedOf` under-reports → `SUBSTITUTION_REJECTED_*` / `REPLACEMENT_INSUFFICIENT`, facility stays ACTIVE, **old collateral stays locked**. `reconcile` returns `UNKNOWN` on a timeout → `COMMITMENT_UNKNOWN`, still locked. |
| Proof artifact | ATS issuance tx, token address/id, chosen standard, compliance setup tx, `commit` (Hold/transfer) tx, `release` tx, HashScan links, facility txs, before/after held balances → `docs/ethonline-2026/proof/hedera-*.json` + receipt. |
| Removal regression | `test`: with the Hedera adapter unavailable / reverting, `commitReplacement` cannot advance to `REPLACEMENT_COMMITTED`, so `releaseOld` reverts and A is never released. |
| Qualification requirement | Use ATS to issue/manage a tokenised asset; deploy + demo on Hedera testnet; public repo, HashScan-verified contracts where applicable; ≤5-min demo video showing issuance, configuration, lifecycle. Bonus: compliance controls (we use them), oracle pricing (see Chainlink price note), upstream contribution to ATS (see `CONTRIBUTIONS.md`). |

---

## ENS — Best Use of ENSv2 ($4,500 track) + Continuity ($500)

| Field | Value |
|---|---|
| Exact primitive | **ENSv2 beta** hierarchical registry + **Enhanced Access Control (EAC)** role-based delegation + **Permissioned Resolver**. Usance uses EAC resource-scoped roles to model "this account may authorise collateral operations for this facility's organisation". |
| Current version / SDK | ENSv2 beta on **Sepolia**. Interfaces are explicitly **beta / not final**. Candidate Sepolia addresses (to be re-pinned against `docs.ens.domains/learn/deployments#sepolia-ensv2-beta` at implementation): RootRegistry, ETHRegistry, UniversalResolverV2, PermissionedResolverImpl. `DOC-ONLY` for the exact EAC ABI (`grantRoles`/`revokeRoles`/`hasRoles`, resource ids, `ROOT_RESOURCE`, roles bitmap). |
| Network / environment | **Sepolia** only. This is external authority evidence — **not** a facility-state domain. |
| Official source | `docs.ens.domains/ensv2/overview`, `docs.ens.domains/ensv2/enhanced-access-control`, `docs.ens.domains/learn/deployments`, `ens.domains/blog/post/ensv2-beta-public-testing`, `ethglobal.com/events/ethonline2026/prizes/ens` |
| Credential / access requirement | A Sepolia wallet + Sepolia ETH (faucet). Registration of `usance.eth` (or a beta test name) on the ENSv2 Sepolia app. |
| Production status | Beta on Sepolia. Not on mainnet. `LIVE_TESTNET` (beta). |
| What Usance uses it for | Institutional namespace (`<org>.usance.eth`, `facility-<id>.<org>.usance.eth` — exact hierarchy pinned against ENSv2 name-ownership constraints). EAC resource-scoped role delegation: the org owner grants a facility/treasury role to a specific account; that account's approval is one required input to a substitution's authority path. Human-auditable facility naming. |
| What it does NOT prove | ENS proves **who currently holds a public delegated role**. It is **not** the signer, **not** the lender, **not** legal-identity verification. It does not prove the organisation actually approved a specific financial action — that is Privy (§18 keeps them distinct). |
| Failure mode | Role absent / revoked / wrong resource / stale observation / resolver unreachable → authority evidence invalid → a **new** substitution request cannot be authorised. A historically-completed substitution stays valid (§33). |
| Proof artifact | Name, canonical hierarchy, ENSv2 contract+version, resource id, required role, resolved account, Sepolia tx/block, decision timestamp, expiry rule → authority-evidence record + the revocation negative test. |
| Removal regression | `test`: revoke the EAC role → authority resolution fails → the facility's `IAuthorityVerifier` rejects the SUBSTITUTE decision → `releaseOld` unreachable. |
| Qualification requirement | Built on ENSv2 beta / Sepolia; functional demo (no hard-coded values); video or live demo; open source. Continuity $500: integrate ENSv2 into an existing project showing the new registry hierarchy / EAC / Permissioned Resolvers unlock a use case — Usance is exactly this. |

---

## Privy — Best B2B Financial Product ($2,500 track)

| Field | Value |
|---|---|
| Exact primitive | Privy **server wallet** owned by an **authorization key** or a **key quorum** (m-of-n, threshold enforced in Privy TEE infra) + a **policy** on the signer + **intents** (transaction requests submitted for signature). |
| Current version / SDK | `@privy-io/server-auth` / `@privy-io/node` (server), current docs updated through July 2026. Key quorums, signers, policies, intents all documented as available. `DOC-ONLY` for the exact quorum-creation + intent-approval calls — resolved once `PRIVY_APP_ID` / `PRIVY_APP_SECRET` are set (capability probe, §15). |
| Network / environment | Privy is chain-agnostic wallet infra. Hedera EVM (chain 296) treated as a custom EVM chain — **verified against Privy's custom-chain support before signing** (§16). Must not default to Ethereum/Sepolia. |
| Official source | `docs.privy.io/wallets/using-wallets/signers/overview`, `docs.privy.io/security/wallet-infrastructure/policy-and-controls`, `docs.privy.io/controls/authorization-keys/owners/types`, `ethglobal.com/events/ethonline2026/prizes/privy` |
| Credential / access requirement | `PRIVY_APP_ID` + `PRIVY_APP_SECRET` (free dashboard app), plus any authorization-key config. **Set in the local shell, never pasted in chat, never committed.** |
| Production status | Server wallets, policies, signers GA. Key quorums documented GA (threshold in TEE). Capability probe (§15) confirms what this specific account can do before quorum is claimed. |
| What Usance uses it for | The **organisational approval** of the exact `FacilityDecision` for a substitution. The Privy-controlled key (quorum if available, else a policy-gated signer — §15) signs an approval that binds `facilityId, operation=SUBSTITUTE, subjectAssetId, subjectInstrumentRef, requestId, pinnedEpoch, policyVersion, expiry, nonce, ENS authority evidence digest, decisionVersion`. A generic "Approve Usance" is insufficient (§17). |
| What it does NOT prove | Privy proves **the organisation approved this specific action**. It does not prove the approver holds a valid public role (ENS), and it does not evaluate the lender's policy (CRE). |
| Failure mode | Approval absent / wrong signer / wrong facility / wrong request / replay / expiry / wrong chain / API timeout → the authority path's Privy leg fails → substitution not authorised. **No fallback signer** (§27). |
| Proof artifact | Wallet id/address, control type, threshold if real, intent/request identifiers, approved/rejected result → Privy evidence record (no secrets). |
| Removal regression | `test`: with no Privy approval present, `IAuthorityVerifier.verify` fails the SUBSTITUTE decision → `releaseOld` unreachable. |
| Qualification requirement | Privy as a central component; create/use ≥1 Privy wallet; a B2B use case; ≥1 functional B2B workflow (approval/treasury); ≥1 Privy control (policy / signer / key quorum / intent). We use a key quorum or a policy-gated signer plus an intent — all controls. |

---

## Chainlink — Best Confidential Workflow ($2,000 track) + Continuity ($500)

| Field | Value |
|---|---|
| Exact primitive | **CRE Confidential Workflow** — a workflow with a TEE handler (`handlerInTee` in TS / `cre.HandlerInTee` in Go). The confidential section evaluates the replacement collateral candidate against the lender's **private policy inputs** (thresholds, allow/deny lists) held as CRE secrets, inside the enclave. Public output crosses back to the Workflow DON for a consensus-signed report. |
| Current version / SDK | CRE SDK (TS / Go), Confidential Workflows. `DOC-ONLY` for the exact handler signatures and report format — resolved against the CRE CLI + SDK in step 7. |
| Network / environment | **CRE CLI simulation** (accepted by the ETHOnline track: "Demonstrate successful execution via CRE CLI simulation **or** live CRE network deployment"). Live CRE network deployment needs account-team enrollment (Confidential Workflows is **private beta**). |
| Official source | `docs.chain.link/cre/concepts/confidential-workflows`, `docs.chain.link/cre/guides/workflow/using-confidential-workflows/making-workflow-confidential`, `docs.chain.link/cre/account/confidential-workflows-access`, `ethglobal.com/events/ethonline2026/prizes/chainlink` |
| Credential / access requirement | CRE CLI + a CRE login/config for simulation. Live deployment: Chainlink account-team enrollment → tracked as `PRIVY`-style `BLOCKED_EXTERNAL` for the *live network* leg only if enrollment does not land; **CLI simulation is the qualifying path and needs no enrollment**. |
| Production status | CRE is GA; **Confidential Workflows is private beta**. Chainlink Confidential Compute early access planned early 2026. |
| What Usance uses it for | The **confidential lender policy decision** — one required policy input to a substitution. CRE returns `ALLOW`/`DENY` + facility/request binding + policy version/commitment + expiry + a disclosure-safe reason code + attestation metadata. |
| What it does NOT prove | CRE does **not** become the risk engine. Usance still runs deterministic public checks: exact asset identity, committed amount, oracle freshness, RiskEpoch, coverage, the substitution invariant. CRE cannot return an LTV that overrides RiskMath (§20). |
| Failure mode | CRE `DENY` / expired / wrong binding / workflow unavailable / malformed result / stale policy version → `IPolicyVerifier.verify` fails → substitution not authorised. **Absence/unknown defaults to DENY** (§27), never ALLOW. |
| Proof artifact | Workflow id/version, confidential-section description, public policy commitment, decision, request binding, execution/attestation reference, expiry, timestamp, what stays private → CRE evidence record. Confidential thresholds are **never** published. |
| Removal regression | `test`: with no CRE decision (or a DENY), `IPolicyVerifier.verify` fails the SUBSTITUTE decision → coverage check never runs → `releaseOld` unreachable. |
| Qualification requirement | CRE Workflow using Confidential Workflows; register+use a confidential TEE handler; the confidential portion processes ≥1 sensitive input inside the enclave, meaningfully integrated into core functionality; demonstrate via CRE CLI simulation or live deployment with logs/evidence. Continuity $500: a meaningful upgrade using Chainlink tech in an existing project. |

---

## Cross-cutting: how the external decisions reach the Hedera facility

The Hedera facility **cannot trustlessly read ENSv2 Sepolia state or a CRE result** (§13, §21). The
authority/policy evidence path, with the trust boundary marked:

```
ENSv2 Sepolia          → canonical EAC resolution           [verified by ENS contracts on Sepolia]
       ↓ pinned as authority evidence (name, resource, role, block, expiry)
Privy org control      → signs the exact FacilityDecision    [enforced by Privy TEE / key quorum]
       ↓                  binding + the ENS-evidence digest
CRE Confidential WF     → ALLOW/DENY on the private policy    [attested by CRE DON consensus / enclave]
       ↓ public signed report / attestation
Usance relayer/service → assembles the FacilityDecision +    [ATTESTED BY AN USANCE SERVICE —
       ↓                  the AuthorityDecision              this is where trust enters; the ENS
Hedera IAuthorityVerifier / IPolicyVerifier                   and CRE artifacts are independently
       → validates the exact cryptographic decision /         inspectable on Sepolia / in CRE logs]
         approved-signer path against the DecisionBinding
Hedera InstitutionalFacility._assertReleasable()
       → re-checks committed amount, freshness, coverage, the invariant
       → releases old collateral
```

**Cryptographically verified on Hedera:** the Privy signer's signature over the `FacilityDecision`
hash; the CRE report signature (if the CRE→Hedera delivery path supports authenticated delivery —
`DOC-ONLY`, resolved in §21; if not, the CRE result is relayed and its independent inspectability
in CRE logs is the accountability, stated plainly, not called "trustless").
**Verified by sponsor infrastructure:** ENS role validity (ENS contracts, Sepolia); Privy quorum
threshold (Privy TEE); CRE enclave execution (CRE DON).
**Attested by an Usance relayer:** the binding of the Sepolia ENS observation into the Hedera-side
authority decision. This relayer cannot forge an approval (the Privy signature covers the ENS
digest) but it chooses *which* ENS block to pin — a liveness/censorship trust, not a safety one.
**Merely displayed:** the confidential policy's human-readable name.

No language such as "trustless ENS verification on Hedera" appears anywhere in the codebase or
proofs.

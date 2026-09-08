# ETHOnline 2026 — the Chainlink CRE confidential lender policy

Status: **`LIVE_SIMULATION`**. The confidential lender-policy decision is produced by a real CRE
Confidential Workflow run through `cre workflow simulate` (the qualifying path — deploying to a DON
needs approval CRE grants separately). The verdict is load-bearing: a substitution completes only
when the workflow returns ALLOW, and its DENY on a private-policy breach refuses the next one.
Proof: `docs/ethonline-2026/proof/cre-workflow.json`, `cre-policy-lifecycle.json`.

## 1. What CRE decides

Whether the substitution candidate passes the lender's **private** policy (issuer concentration,
minimum internal rating, single-substitution size, issuer allowlist). CRE is not the risk engine —
`InstitutionalFacility._assertReleasable` still runs every deterministic public check (exact asset
identity, committed amount, oracle freshness, RiskEpoch, coverage). An `IPolicyVerifier` pass is
necessary, never sufficient (§20).

## 2. The workflow

`packages/ethonline/usance-cre/lender-policy` — CRE Go SDK `cre-sdk-go v1.19.0`.

- **Trigger:** `http-trigger@1.0.0-alpha`. The request body is the exact substitution decision plus
  the candidate attributes.
- **Confidential:** the handler is registered with `cre.HandlerInTee(..., cre.OneOfTees{cre.Nitro{
  Regions: []cre.NitroRegion{cre.NitroUsWest2}}})`, so it runs in an AWS Nitro enclave. The lender's
  thresholds are a CRE secret (`LENDER_POLICY`) fetched via `runtime.GetSecret` inside the enclave;
  they never reach the DON or chain.
- **Output:** `{ allow, reasonCode, policyCommitment, workflowVersion }`.

### The policy commitment

```
policyCommitment = keccak256("USANCE_CRE_LENDER_POLICY_V1" || canonicalJSON(privatePolicy))
```

computed in-enclave. Only this 32-byte hash is public. `EthOnlinePolicyVerifier` is configured with
it; the workflow returns it on every run; `cre-policy-lifecycle.mjs` independently recomputes it
from its copy of the policy and asserts all three match
(`0x0f5b4e3de26fee27c24c28d5f0767c687ec17c5a54dacf400b253f8d02d3f0b0`). That equality is the proof
the verdict was evaluated against the committed policy.

## 3. From verdict to chain

`cre workflow simulate` runs the TEE handler locally and prints the verdict. The CRE reporter key
(`0x41B8B4595dd0237Ac442e24C867B05d99ed01F9e`) signs

```
keccak256(abi.encode("USANCE_CRE_POLICY_V1", decisionHash, allow, policyCommitment,
                     workflowVersion, reasonCode, expiry))
```

and calls `EthOnlinePolicyVerifier.submitVerdict`. `submitVerdict` checks the commitment and
workflow version match the configured values, the expiry is in the future, the nonce is strictly
monotone per (facility, operation), and the signature recovers to `creReporter`.

In a production DON deployment the workflow writes the report through the CRE Forwarder and the
Forwarder carries the DON's aggregated signature; the CLI simulation substitutes this single
reporter signature. The verifier contract does not change between the two.

## 4. The lifecycle, proven live

`node --env-file=.env packages/ethonline/src/cre/cre-policy-lifecycle.mjs`. Proof:
`docs/ethonline-2026/proof/cre-policy-lifecycle.json`.

| # | Step | Result |
|---|---|---|
| 1 | ENS EAC role live on Sepolia (all prior sponsors still required) | `hasRoles` → true |
| 2 | `EthOnlinePolicyVerifier.configureFacility(facilityId, reporter, policyCommitment, 1)` | `0x0080e90c…` |
| 3 | **positive** — `cre workflow simulate` for series A candidate within the private limits → ALLOW (`ELIGIBLE`); reporter-signed `submitVerdict` `0x65e6af19…`; Privy dual-key approval `0xcdd008a4…`; `requestSubstitution` → `commitReplacement` (**A held while B still held**, `committedOf(A)=committedOf(B)=150000`) → `releaseOld` | SUCCESS |
| 4 | **negative** — `cre workflow simulate` for a series B candidate with issuer exposure over the private max → **DENY (`ISSUER_CONCENTRATION`)**; reporter-signed `submitVerdict(allow=false)` `0xf87aaed2…`; Privy approval still submitted `0x4abde6d5…` (only CRE is the blocker); `requestSubstitution` **reverts** at `IPolicyVerifier.verify` | refused |
| 5 | completed substitutions not disturbed — facility ACTIVE, collateral series A, 150000 committed | unchanged |

Result: `PASS — the CRE confidential workflow's ALLOW drove a real substitution and its DENY (on a
private-policy breach) refused the next one; completed substitutions untouched.`

## 5. No silent fallback

Absence, DENY, or an expired verdict all fail closed in `EthOnlinePolicyVerifier.verify` (§27). A
DENY makes `requestSubstitution` revert before any collateral moves. There is no default-ALLOW path.

## 6. What is real here

- **Real:** the CRE Confidential Workflow (Go, `HandlerInTee`, Nitro constraint); the HTTP trigger;
  the private policy as a CRE secret read in-enclave; the in-enclave `policyCommitment`; the
  deterministic ALLOW/DENY evaluation; the on-chain `submitVerdict` signature check and the
  `requestSubstitution` revert on DENY.
- **Simulation substitute:** `cre workflow simulate` stands in for a deployed DON; a single reporter
  key signs the verdict where a deployed workflow's Forwarder would carry the DON signature.
- **Test input (unchanged):** the mark price (`HederaTestOracleAdapter`, §24). The candidate
  attributes in the HTTP payload are supplied by the relayer from facility state.

# lender-policy — Usance confidential lender-policy CRE workflow

A CRE **Confidential Workflow** (AWS Nitro TEE handler) that decides whether a collateral
substitution candidate passes the lender's **private** policy. Full write-up:
`../../../../docs/ethonline-2026/CRE_POLICY.md`.

- Trigger: `http-trigger@1.0.0-alpha`. Body = the substitution decision + candidate attributes.
- Confidential: `cre.HandlerInTee(..., cre.Nitro{us-west-2})`. The lender thresholds are the CRE
  secret `LENDER_POLICY`, read via `runtime.GetSecret` inside the enclave.
- Output: `{ Allow, ReasonCode, PolicyCommitment, WorkflowVersion }`. `PolicyCommitment` is
  `keccak256("USANCE_CRE_LENDER_POLICY_V1" || canonicalJSON(policy))` computed in-enclave — the only
  public projection of the private policy.

## Simulate

```bash
export LENDER_POLICY_ALL='{"version":1,"maxIssuerExposureUsd18":"...","maxSubstitutionUsd18":"...","minRatingNotch":12,"allowedIssuers":["USANCE-ISSUER-A","USANCE-ISSUER-B"]}'
cre workflow simulate ./lender-policy --target staging-settings --trigger-index 0 \
  --http-payload ./decision.json --non-interactive
```

`decision.json`:

```json
{
  "decisionHash": "0x…32 bytes…",
  "facilityId": "0x…",
  "candidateAssetId": "0x…",
  "issuerId": "USANCE-ISSUER-B",
  "requestedUnits": 150000,
  "markPriceUsd18": "1000000000000000000",
  "issuerExposureUsd18": "100000000000000000000000",
  "ratingNotch": 15
}
```

The orchestration script `packages/ethonline/src/cre/cre-policy-lifecycle.mjs` drives this end to
end and posts the reporter-signed verdict to `EthOnlinePolicyVerifier` on Hedera.

## Test

```bash
go test ./lender-policy/
```

`binary.wasm` is a build artifact (`cre workflow build ./lender-policy`), gitignored.

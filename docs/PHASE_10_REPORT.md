# Phase 10 report — 0G evidence intelligence

## Status

- 0G provider integration: **UNIT_TESTED** through an injected Direct transport; no live network/provider call claimed.
- TEE/provider attestation: **NOT_YET_PROVEN** live; provenance represents TeeML/TeeTLS and response-integrity states precisely.
- Storage: **UNIT_TESTED** adapter; no public document uploaded to 0G.
- Passport impact: proposed structured claims only. No 0G code can commit a Passport.
- Financial authority: **NONE**.

## Inference architecture

```text
evidence bytes/hash → 0G Direct request → provider/model provenance
→ structured claims → deterministic schema/quote/source validation
→ independence-aware corroboration/conflict → unsigned Passport proposal
```

The only downstream output is existing evidence-pipeline calldata. No 0G package imports a
financial contract, signer, PassportRegistry writer, or financial action interface.

## NVDAx conflict case

The reproducible [fixture](../proof/zerog/nvdax-multiplier-conflict.fixture.json) records issuer API
multiplier `1` and onchain multiplier `1.000918075849099600 WAD`. It produces
`CLAIM_CONFLICT` / `PRODUCTION_ADMISSION_BLOCKED_EXTERNAL`, with `financialEffect: RESTRICT_ONLY`.
It does not claim a real 0G response or production admission.

## Security boundary

0G is structurally unable to control `PassportRegistry`, `EvidenceRegistry`, `RiskPolicyRegistry`,
`ClearingHouse`, `PortfolioRevolvingCredit`, `InstitutionalFacility`, all collateral vaults,
settlement, RiskEpoch, or wallet signing. Unavailable, malformed, expired, wrong-unit, unsupported,
or conflicting intelligence can only be rejected/restricted; repayment and other risk-reducing
operations have no 0G dependency.

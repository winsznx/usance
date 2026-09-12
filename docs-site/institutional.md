---
description: How an organization holding tokenized real-world assets replaces collateral without unwinding financing.
---

# Institutional collateral replacement

Usance is a capital operations layer for organizations holding tokenized real-world assets. The
primary wedge: turn a tokenized asset into working capital without selling it, and keep that
capital in place while the underlying collateral changes.

This page documents the institutional surface: a term-secured credit facility that lets a borrower
swap its posted collateral for a different eligible asset — real Series A tokenized security for
real Series B — while financing stays open the entire time. Old collateral is never released until
the replacement is provably secured.

## Product surfaces

- **Capital Account** — the facility itself: outstanding financing, posted collateral, status.
- **Capital Request** — a durable, authenticated request to replace collateral, tracked end to end
  from creation through completion or a paused safety block.
- **Policy Engine** — a confidential lender-policy evaluation that must return an eligible verdict
  before a replacement can proceed. The policy's thresholds stay private; only its evaluation
  result and a commitment to the policy are public.
- **Capital Router** — the sequencing that guarantees new collateral is committed before old
  collateral is released, never the reverse.
- **Evidence / Audit** — every organizational approval, policy verdict, and collateral movement is
  backed by a verifiable on-chain transaction, surfaced with clear provenance rather than buried in
  raw hashes.

## How a replacement works

1. An authenticated organization operator requests a specific replacement asset and amount.
2. The facility resolves current organizational authority and records an organization-level
   approval.
3. A confidential lender-policy evaluation runs against the proposed replacement; only an eligible
   verdict allows the request to proceed.
4. The replacement collateral is committed while the original collateral is still held — both are
   secured simultaneously.
5. Only after the facility's own safety checks confirm the replacement is sufficient does it
   release the original collateral. If a safety check does not pass, the original collateral stays
   secured and the release simply waits — this is a safety control working as intended, not a
   failure.
6. Financing remains open throughout every step.

## Current integration status

| Component | Role | Status |
| --- | --- | --- |
| Hedera ATS | Security lifecycle and collateral hold operations | **Live testnet** |
| ENS | Public, delegated institutional role evidence | **Live testnet** |
| Privy | Organizational approval and quorum signing | **Live testnet** |
| Chainlink CRE | Confidential lender-policy evaluation | **Live simulation** — a real Chainlink CRE Confidential Workflow, run via the CRE simulator and reporter-signed; not yet a deployed Decentralized Oracle Network (DON) |

Usance is the facility and financial-safety authority throughout: it is the sole party that decides
whether a replacement is eligible to complete, informed by — but never delegating that decision to
— any of the integrations above.

## What this is not

This is a testnet proof of a real mechanism, not a production institutional product yet. Test
securities and test settlement tokens are used throughout; nothing here represents a live
institution account or real capital.

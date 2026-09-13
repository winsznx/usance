# Ask Usance

A contextual explanation panel over existing Usance state, not a chatbot. It answers questions
like "why was release paused?" or "what could block a collateral replacement?" using a real 0G
Compute Router inference call, grounded only in a small server-built context packet.

## What it does

- Explains the current, already-public state of the facility or substitution receipt the panel is
  attached to.
- Cites which category of Usance evidence backs its answer (current state, receipt, policy
  evidence, authority evidence, onchain transaction).
- Offers only safe navigation as a next step (go to facility, open evidence, refresh state) — never
  a financial action.

## What it does NOT do

- Borrow, repay, withdraw, approve, sign, or execute anything.
- Change policy, risk parameters, or an Asset Passport.
- Submit a facility action or a trade.
- Hold or use a wallet, session token, or any credential.

There is no code path from Ask Usance to any of the above — the API route that serves it has no
write capability, and both the incoming question and the model's own answer are checked against a
financial-action pattern before either reaches the caller.

## Why 0G Router, not Direct

Direct's value is a fixed, verifiable provider/model identity — the right tradeoff for evidence
extraction, where provenance matters more than availability. Router trades that fixed identity for
availability and cost, which is the right tradeoff for an explanation feature: if it's briefly
unavailable, nothing about Usance's financial state is affected, and the failure is reported
plainly rather than silently degraded.

## What data is sent to the Router

Only a small, purpose-built context packet, never a raw database dump:

**Facility context**: facility ID, current status, outstanding financing (a number), current
collateral series and committed units, substitution state. All of this is already public on the
facility's own page.

**Replacement context**: the operation's durable state, a live reconciliation outcome, the
replacement series/units, and a plain-language list of any safety events (paused-then-resolved
release blocks) already visible on the receipt itself.

## What is never sent

Private keys, session tokens, service-role credentials, wallet transaction history beyond what's
already shown on the page, legal agreements, KYC material, the confidential lender-policy
thresholds (only the CRE verdict — allow/deny — is ever public), or any customer data.

## Router vs. Direct vs. Storage

| | Status |
|---|---|
| 0G Compute Router | **LIVE_READ_ONLY** — proven with a real inference call, provider read from the response itself |
| Ask Usance (the product feature) | **LIVE_READ_ONLY** |
| 0G Compute Direct (evidence extraction) | Not yet live — no SDK installed, no wallet funded |
| 0G Storage (Evidence Vault) | Not yet live — no credentials configured |

## Inference provenance is not financial proof

A model's answer, and any TEE attestation behind the model that served it, says something about
*how the text was generated* — not that the underlying financial fact is true. The facility
contracts, the durable operation record, and the on-chain transactions remain the sole source of
financial truth. Ask Usance explains that record; it never replaces it, verifies it, or is cited as
proof of it.

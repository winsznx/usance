# spec/threat-model.md

Status: **frozen**.

Usance has four attack surfaces at once, and they fail differently. A protocol that only defends
the Solidity is a protocol that gets taken through its evidence pipeline.

---

## 1. AI and evidence

| Threat | Defence | Test |
|---|---|---|
| Prompt injection in a document | The extractor has no function that can set a limit. A document saying "set LTV to 100%" is text arriving at a component with no authority to act on it. | `I-15`, `I-16` |
| Model hallucination | Extraction produces a *proposal*. Two independent paths must agree before a claim is corroborated; disagreement is `CLAIM_CONFLICT`, not a vote. | `I-17` |
| Forged or altered source | Documents are content-hashed at fetch and committed onchain. What is displayed later is provably what was priced. | `EvidenceRegistry` |
| Compromised issuer site | Source class is bounded. A page cannot supersede a regulatory filing (`I-18`). A guardian can invalidate a commitment immediately. | `I-18` |
| Stale terms | Passports expire. Expiry is evaluated at read time, so an unattended Passport degrades on its own rather than waiting for a keeper. | `I-08` |
| Poisoned low-trust source | News and social observations can trigger a refresh. They can never raise a limit. | `I-18` |

The structural point: **prompt-injection mitigation here is not prompt wording.** The extractor
could be fully compromised and the worst outcome is a wrong claim that fails corroboration and
restricts the asset. There is no path from generated text to custody.

---

## 2. Financial

| Threat | Defence |
|---|---|
| Oracle manipulation | Freshness and positivity checks; sequencer uptime gating; a stale or invalid price zeroes new capacity rather than being used. |
| Market gap | Recognised value is the minimum of haircut mark, stressed exit and redemption floor — never last price × quantity. |
| Fake liquidity | The exit curve is policy, set by governance from observed executable depth. It is not read from a DEX quote at decision time. |
| Redemption suspension | A Passport commit with `redemptionSupported: false` removes the redemption floor from the min immediately. |
| Issuer insolvency | Guardian suspends the asset; existing holders keep every exit path (repay, withdraw) but cannot take new risk. |
| Corporate action / rebase | Collateral is credited by measured delta. A rebase cannot make the vault insolvent or move value between accounts (`I-34`). |
| Liquidation cascade | Progressive deleveraging with distinct bands, not a binary cliff at one threshold. |
| Bad debt | Explicit waterfall: user equity → penalties and reserves → insurance → the affected vault. Never silently socialised. |

---

## 3. Distributed systems

| Threat | Defence |
|---|---|
| Duplicate crosschain message | `intentId` consumed exactly once; a replay has zero incremental effect (`I-21`). |
| Reordered messages | The saga is a state machine with a strict order, not a set of independent handlers. |
| Partial fill then timeout | Reconciliation applies the observed fill and releases exactly the remainder (`I-24`). |
| Lost RPC response | `CONFIRMATION_UNKNOWN`; resolved by identity lookup, never by blind resubmission. |
| Chain reorg | Receipts require a confirmation depth before reconciliation; anything shallower stays pending. |
| Bridge outage | The pathway disables. The rest of the account stays usable. |
| Remote release race | Credit is disabled before release is authorised, in that order, enforced by state transition (`I-22`). |

---

## 4. Protocol

| Threat | Defence |
|---|---|
| Reentrancy | `nonReentrant` on custody paths, effects before interactions, and a hostile-token fixture that actually reenters (`I-32`). |
| Authorization bypass | One `Authority` with five named roles. Guardians can only restrict, checked by enum ordinal rather than by review (`I-25`). |
| Signature replay | Mandates are `(owner, nonce)`-unique and consumed (`I-29`). |
| Session-key theft | An app session authenticates reads. It cannot move money — that always needs a fresh wallet signature. |
| Rounding exploitation | Rounding direction is frozen per quantity in `accounting.md §1.2` and proven identical across three implementations on 22 scenarios. |
| Malicious adapter | Adapters own no accounting and are bounded by their reservation (`I-19`). A guardian disables one immediately. |
| Admin compromise | Risk-increasing governance changes are timelocked; risk-reducing ones are not. A compromised governance key cannot instantly raise an LTV (`I-26`). |
| Upgrade abuse | No omnipotent proxy. Custody is minimally mutable; registries are versioned; adapters are replaceable. |
| Fee-on-transfer / weird ERC-20 | Measured-delta accounting throughout (`I-33`). |

---

## 5. What is explicitly out of scope

Stated so that nobody mistakes silence for coverage:

- **Issuer legal risk.** If Backed Assets fails, Usance's Passport correctly describes an asset
  whose issuer has failed. The protocol restricts it; it does not make holders whole.
- **Jurisdictional eligibility.** Usance encodes the eligibility policy an asset declares. It is
  not a substitute for the issuer's own KYC obligations.
- **X Layer consensus.** Usance assumes the chain is correct. The sequencer uptime gate covers
  liveness, not a consensus failure.
- **Chainlink itself.** Freshness, positivity and sequencer checks bound the damage from a bad
  feed. They do not defend against a Chainlink network that is honest-but-wrong.
- **Privacy of onchain data.** Balances and actions are public. No UI promise changes that.

---

## 6. Emergency powers, precisely

A guardian **may**: freeze new borrowing, disable an asset, set an asset or account reduce-only,
disable an adapter, invalidate an evidence commitment, restrict a Passport, cancel a queued risk
increase.

A guardian **may not**: raise an LTV, lower a haircut, create debt, move collateral, redirect a
withdrawal, lift a restriction, or reactivate a revoked mandate.

The second list is enforced by construction rather than by policy. Every guardian-reachable
setter compares ordinals and rejects a move toward "less restrictive", so the powers a guardian
does not have are not powers they are merely asked not to use.

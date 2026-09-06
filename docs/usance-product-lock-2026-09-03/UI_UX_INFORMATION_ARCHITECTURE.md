# UI_UX_INFORMATION_ARCHITECTURE.md

## 1. UX principle

Usance is one product with role-specific workspaces.

Do not make a capital user navigate an institutional repo terminal.

Do not make an institution use a consumer “borrow” card for a multi-party facility.

## 2. Public navigation

Top level:

- Assets
- Capital
- Collateral
- Sentinels
- Earn
- Developers
- Status

Primary CTA: **Open Usance**

Landing headline:

> **Make tokenized assets usable as capital.**

Subhead:

> Understand what an asset represents, see what it can safely support, and use it across credit, collateral and automated capital operations.

Do not lead with chain logos.

## 3. Public asset page

`/assets/[instrumentId]`

Always distinguish:

- instrument name;
- issuer;
- network/domain;
- underlying reference;
- rights;
- custody/backing;
- income/corporate actions;
- redemption;
- eligibility;
- market state;
- usable capital capabilities.

If two tokens reference Apple, they must appear as two instruments, not one merged “AAPL” row.

Advanced panel:

- Passport version;
- evidence root;
- RiskEpoch;
- oracle route;
- liquidity route;
- adapter versions.

## 4. Capital workspace

Routes:

- `/app`
- `/app/assets/[instrumentId]`
- `/app/collateral/add`
- `/app/borrow`
- `/app/repay`
- `/app/withdraw`
- `/app/positions`
- `/app/activity`
- `/app/activity/[receiptId]`
- `/app/alerts`
- `/app/mandates`
- `/app/sentinels`
- `/app/settings`

Dashboard answers:

1. What do I own?
2. How much is usable?
3. What do I owe?
4. What currently binds capacity?
5. What requires action?

Use plain terms first:

- Market value
- Usable collateral
- Available credit
- Debt
- Safety buffer

RiskEpoch is advanced detail, not the headline.

## 5. Institutional workspace

New namespace:

- `/institutional`
- `/institutional/facilities`
- `/institutional/facilities/new`
- `/institutional/facilities/[facilityId]`
- `/institutional/facilities/[facilityId]/collateral`
- `/institutional/facilities/[facilityId]/substitute`
- `/institutional/approvals`
- `/institutional/settlements`
- `/institutional/assets`
- `/institutional/policies`
- `/institutional/counterparties`

### Facility detail

Show:

- status;
- home domain;
- borrower;
- lender;
- settlement asset;
- principal/debt;
- collateral;
- coverage;
- next permitted action;
- current approval/policy requirements;
- settlement history.

Hero action when eligible:

**Replace collateral**

Not “Execute substitution transaction.”

## 6. Collateral substitution UX

Step 1 — Current facility

“Your financing stays open during an eligible replacement.”

Step 2 — Choose replacement

Display exact instrument identity, not ticker only.

Step 3 — Checks

- public authority;
- organizational approval;
- lender policy;
- asset eligibility;
- coverage;
- transfer state.

Step 4 — Review

Explicit:

- what enters;
- what leaves;
- coverage before/after;
- fees;
- what can fail;
- what happens if it fails.

Step 5 — Settlement timeline

`Replacement committed` must visibly precede `Old collateral released`.

## 7. Authority UX

### ENS

Display:

- institution name;
- role;
- expiry;
- namespace;
- “public authority checked at block …”

### Privy

Display:

- organization wallet;
- quorum status;
- approval progress.

Never conflate ENS role with wallet signature.

## 8. Confidential policy UX

Do not show private rules.

Show:

- policy version/commitment;
- decision;
- expiry;
- public reason class;
- confidential-compute proof status if available.

Copy:

> Lender policy accepted this replacement.

or

> Replacement does not satisfy the current lender policy. Existing collateral remains unchanged.

## 9. 0G provenance UX

On evidence/Ask Usance:

- model/provider;
- inference route;
- TeeML/TeeTLS/no attestation;
- inputs;
- source quotes;
- uncertainty;
- financial boundary.

Example:

> 0G TeeTLS proves this response was routed through the expected provider path. It does not prove the issuer statement is true. Usance still checks the source, corroboration and deterministic policy separately.

## 10. Sentinels UX

Keep current “alive but not theater” principle.

Show:

- ARMED/PAUSED/BLOCKED;
- exact goal;
- mandate;
- budget;
- trigger;
- last run;
- next check;
- receipt.

No glowing AI orb.

## 11. Domain presentation

Domain/network matters but is secondary to instrument and facility.

Show a small badge:

`Base` / `X Layer` / `Hedera`

Do not present chain switching as the product.

When a user starts a facility, the home domain is explicit and cannot silently change.

## 12. Errors/recovery

Every blocked action says:

- what is blocked;
- why;
- whether funds are safe;
- what the user can do;
- whether retry is safe.

Never generic “Transaction failed.”

## 13. Mobile

Mobile prioritizes:

- review;
- approve;
- repay;
- add collateral;
- Sentinel pause/revoke;
- facility substitution approval;
- proof inspection.

Complex portfolio/facility creation may use full-screen workspace.

## 14. Copy lock

Preferred:

- “Usable collateral”
- “Available credit”
- “Replace collateral”
- “Existing collateral stays locked”
- “Authority expired”
- “Lender policy rejected this replacement”
- “Market is closed; new risk is restricted”
- “AI analysis informed the Passport proposal; policy controls the limit”

Avoid:

- “AI-powered RWA verification”
- “universal stock”
- “execute”
- “smart collateral”
- “omnichain loan”
- “verified by AI”

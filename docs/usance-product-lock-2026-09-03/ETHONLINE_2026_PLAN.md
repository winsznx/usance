# ETHONLINE_2026_PLAN.md

## Product

### Usance Collateral

> **Programmable collateral operations for tokenized real-world assets.**

Hero mechanism:

> **Replace eligible collateral without unwinding an active financing facility.**

## Why it belongs in Usance

Tokenized assets become useful when they can support financing. Real financing needs mid-life collateral operations, not just “deposit once and wait.”

Collateral substitution is a recognized institutional operation: a borrower needs an asset back but the financing should remain open.

## Golden facility

```text
Facility F-1042
Borrower: Acme Treasury
Lender: Northstar Capital
Settlement: test facility currency
Collateral: ATS Treasury A
Status: ACTIVE
```

Borrower proposes ATS Treasury B.

## Critical path

### 1. ENSv2 — public institutional authority

Resolve:

- institution;
- facility descriptor;
- operator role;
- expiry/revocation;
- home-domain contract.

For sensitive role checks use current canonical hierarchy functions rather than stale cached resolution.

Output: `NamespaceAuthorityReceipt`.

### 2. Privy — organizational signing/quorum

The operation must be authorized by the configured organization wallet/quorum/policy.

Output: `InstitutionalApprovalReceipt`.

### 3. Chainlink CRE — confidential lender policy

Inputs:

- proposed replacement;
- facility snapshot;
- public authority context;
- market/risk inputs;
- private lender policy.

Output:

- allow/deny;
- public decision code;
- policy commitment;
- input digest;
- decision expiry;
- proof/receipt supported by the final current CRE primitive.

**Do not hard-code an ETHOnline-specific TEE API until the current qualification requirements are published.**

### 4. Hedera ATS — consequential asset lifecycle

ATS Treasury B is committed.

Only then may ATS Treasury A be released.

Facility remains ACTIVE.

Output: onchain settlement tx + HashScan proof.

## Atomicity invariant

Old collateral is not releasable unless:

- replacement identity is exact;
- transfer restrictions pass;
- replacement is committed/locked;
- policy decision is fresh and matches the facility;
- required organizational approval is fresh;
- post-switch coverage is valid.

### Best path

One Hedera transaction executes replacement-lock + old-release under a facility contract/module.

### Acceptable fallback

Two-phase escrow:

`REPLACEMENT_PENDING → REPLACEMENT_COMMITTED → OLD_RELEASED`

`OLD_RELEASED` has no transition from `REPLACEMENT_PENDING`.

## Negative twin

Treasury C fails confidential lender policy.

Expected:

- decision `REJECTED`;
- old collateral unchanged;
- facility remains ACTIVE;
- no release transaction;
- receipt shows exact failing policy class without revealing private policy.

## Sponsor-removal regressions

### Remove ENS

Usance cannot prove the presented operator still has the institution's public delegated authority.

### Remove Privy

Usance lacks the required controlled organization authorization/quorum.

### Remove Chainlink CRE

Either private lender policy must be revealed or Usance must trust a private server assertion. Demonstrated confidential-policy guarantee disappears.

### Remove Hedera ATS

The actual tokenized-security lifecycle and consequential settlement disappear.

## Adversarial cases

- revoked ENS role after proposal;
- Privy quorum not met;
- stale CRE result;
- CRE result replayed for another facility;
- replacement transfer fails;
- ATS asset paused;
- ATS asset frozen/restricted;
- insufficient replacement value;
- policy version changes;
- duplicate request;
- two substitutions race;
- worker crashes after replacement lock but before receipt;
- RPC returns stale state;
- authority service outage;
- facility settles while substitution pending;
- old collateral release attempted directly.

## Proof campaign

Positive, negative, boundary and incomplete-information cases.

Repeat each end-to-end run from a clean state.

Every sponsor gets a raw receipt.

## UI

Institutional workspace:

- Facilities;
- Facility detail;
- Collateral;
- Substitute;
- Approvals;
- Policy result;
- Settlement timeline;
- Proof.

Hero flow should be understandable without explaining every sponsor first.

## Continuity hygiene

Before hack starts:

- exact baseline commit;
- tests;
- deployment/proof digest;
- `PREEXISTING.md`.

During event:

- all ETHOnline work tagged/manifested;
- sponsor-specific proofs;
- no preexisting core work presented as new.

## Success definition

A judge can see:

1. active facility;
2. current collateral;
3. proposed replacement;
4. real ENS role;
5. real Privy approval;
6. real confidential policy decision;
7. real ATS settlement;
8. same financing still ACTIVE;
9. negative replacement refused without releasing old collateral.

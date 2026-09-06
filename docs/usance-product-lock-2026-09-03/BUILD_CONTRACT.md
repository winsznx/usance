# BUILD_CONTRACT.md

## Purpose

This file governs Claude/Codex implementation after Product Lock approval.

**Do not implement from old PRDs without first reconciling them against this Product Lock.**

## 1. First action in every implementation session

Run:

```bash
git status --short
git rev-parse HEAD
git log --oneline -20
```

Then load:

- `PRODUCT_LOCK.md`;
- `USANCE_MASTER_PRD.md`;
- `ARCHITECTURE.md`;
- `SECURITY_AND_THREAT_MODEL.md`;
- `MIGRATION_PLAN.md`;
- current specs/invariants;
- current checklist/proof ledger.

If code disagrees with documents, record the conflict before editing.

## 2. Task ledger

Before code, generate a dependency-ordered checklist with small checkboxes.

A task is complete only when:

- code exists;
- test exists;
- user/operator path exists where required;
- failure state exists;
- proof/docs updated where required.

No “feature complete” by file existence.

## 3. Constitutional rules

Never trade away:

1. one facility = one authoritative domain;
2. instrument identity != ticker;
3. AI has no financial authority;
4. `ProtocolAllows ∧ MandateAllows`;
5. no agent collateral withdrawal;
6. missing evidence can only restrict;
7. stale epoch cannot authorize new risk;
8. unknown execution reconciles; no blind retry;
9. generated proof artifacts cannot be manually edited into currency;
10. emergency guardian restricts only;
11. external venues are adapters;
12. ClearingHouse does not receive new unrelated features.

## 4. Proof levels

Use only:

- `SPECIFIED`;
- `UNIT_TESTED`;
- `INTEGRATION_TESTED`;
- `LIVE_TESTNET`;
- `LIVE_MAINNET`;
- `EXTERNAL_INTEGRATION`;
- `BLOCKED_EXTERNAL`;
- `NOT_YET_PROVEN`.

Every public claim maps to `proof/claims.json`.

## 5. External integration policy

For every provider:

- pin exact docs/version;
- capability-probe;
- record network;
- record addresses;
- record access level;
- record proof;
- define timeout/failure;
- never silently fall back while retaining stronger claim.

## 6. Competition isolation

Competition-specific files may configure/demo an existing product module, but must not fork the protocol.

Each competition folder records:

- baseline commit;
- preexisting work;
- new work;
- eligible tracks;
- sponsor-critical path;
- deployment evidence;
- receipts;
- limitations;
- demo script.

## 7. Mainnet gate

No mainnet real-capital deployment until all launch-gate items in the Master PRD are PASS.

A deploy script must refuse mainnet when:

- test fixture asset;
- fake oracle;
- unverified settlement asset;
- missing caps;
- unsafe role ownership;
- unconfigured freshness;
- test signer;
- proof/drift mismatch.

## 8. Stop conditions

Stop and report rather than invent when:

- a sponsor capability does not exist;
- an address cannot be verified;
- a legal/economic asset property is unknown;
- a current contract cannot satisfy an invariant without redesign;
- a required production signer/capital source is unavailable.

Hard does not mean blocked.

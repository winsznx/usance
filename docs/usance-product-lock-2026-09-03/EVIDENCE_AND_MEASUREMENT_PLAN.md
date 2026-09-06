# EVIDENCE_AND_MEASUREMENT_PLAN.md

## 1. Principle

Every important displayed number and public claim should trace to:

- authoritative chain state;
- generated projection with provenance;
- immutable evidence;
- or an explicit external source.

No screenshot-only truth.

## 2. Claim ledger

Each claim:

```json
{
  "claimId": "...",
  "claim": "...",
  "level": "LIVE_TESTNET",
  "domain": "xlayer",
  "artifact": "...",
  "deploymentDigest": "...",
  "inputs": [],
  "limitations": []
}
```

No claim is promoted by editing prose.

## 3. Artifact freshness

Every generated artifact has:

- input digests;
- generator version;
- deployment digest;
- source block/range;
- schema version.

Consumer rejects stale artifact.

## 4. Product metrics

### Capital

- recognized collateral;
- financed notional;
- originations;
- repayments;
- active facilities;
- capital velocity;
- utilization.

### Risk

- binding constraint frequency;
- Passport conflicts;
- RiskEpoch changes;
- NO_NEW_RISK / MARGIN_CALL duration;
- liquidation recovery;
- bad debt.

### Liquidity

- executable exit coverage;
- slippage by notional;
- withdrawal queue;
- lender utilization;
- recovery route success.

### Operations

- p50/p95/p99 API latency;
- indexer lag;
- RPC disagreement;
- reconciliation latency;
- unknown-execution backlog;
- external-provider uptime;
- Sentinel stuck runs.

### Ecosystem

Per domain:

- attributed users;
- attributed writes;
- financing cycles;
- DEX/venue activity genuinely caused by facilities;
- issuer assets admitted;
- repeat borrowers.

## 5. Capital velocity

Preferred metric:

```text
CapitalVelocity
=
(settled financing + financed execution volume)
/
average recognized collateral
```

This is not a reward for circular volume.

Exclude:

- self-trades;
- wash transactions;
- duplicate retries;
- failed/unknown execution until reconciled;
- purely internal accounting events.

## 6. ETHOnline proof plan

### Positive

Treasury A pledged → Treasury B approved/committed → Treasury A released → facility remains active.

### Negative

Treasury C rejected → old collateral untouched.

### Boundary

Replacement exactly at minimum coverage.

### Stale

expired CRE decision rejected.

### Authority

revoked ENS role or missing Privy quorum rejected.

### Failure

ATS transfer failure leaves old collateral.

### Sponsor removal

Run with each sponsor path deliberately absent and show exact lost guarantee.

## 7. Base mainnet proof plan

Before public capital:

- official B20 contract provenance;
- Passport;
- corporate-action fixture;
- portfolio risk;
- lender deposit;
- borrower deposit;
- USDC borrow;
- repayment;
- withdrawal;
- liquidation rehearsal;
- Sentinel risk-reduction action;
- public receipt.

## 8. X Layer proof plan

- exact xStock admission;
- multiplier accounting;
- native USDC financing;
- Builder Code attribution;
- OKX route proof where available;
- Sentinel/intent reconciliation;
- current deployment/bytecode proof.

## 9. 0G provenance UX

Show separately:

- **Evidence integrity:** exact source bytes/hash.
- **Inference provider:** provider/model.
- **Verification mode:** TeeML / TeeTLS / none.
- **Provider attestation:** status.
- **Response integrity:** status.
- **Claim corroboration:** single-source/corroborated/conflict.
- **Financial effect:** informational only / resulted in Passport proposal / deterministic policy consequence.

Never label the whole card “verified AI.”

## 10. Repeated evidence campaign

For any load-bearing mechanism, run:

- deterministic seed;
- ≥ repeated positive/negative cases;
- mutation/ablation;
- live external call where required;
- stored raw responses;
- a failed external call;
- clean-room replay.

## 11. Launch dashboard

Public `/status` should eventually display:

- current domains;
- current deployment hashes;
- oracle/session freshness;
- indexer lag;
- evidence provider status;
- current incidents;
- proof ledger counts.

Do not show fake uptime history before it exists.

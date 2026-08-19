# Runbooks

Each says what you see, what it means, what is safe, and — the part most runbooks omit — what is
*unsafe*, because the tempting action during an incident is usually the one that turns a degradation
into a loss.

---

## RPC degraded or disagreeing

**Symptoms.** Reads time out, or a read straight after a receipt returns pre-transaction state.

**Diagnosis.** The endpoint is load-balanced. A node that has not applied a block answers with stale
state rather than erroring — this has already produced a proof run that reported a successful
repayment as having changed nothing.

**Safe.** Pin post-state reads to the receipt's block number. Fall back to the secondary endpoint.
Serve cached projections and label them with their block height.

**Unsafe.** Re-sending a transaction because a read suggests it did not land. The read is the thing
that is wrong. Confirm against the receipt, or against `CONFIRMATION_UNKNOWN` reconciliation.

**Recovery proven when.** Two consecutive reads at the same block height agree.

---

## Indexer stalled

**Symptoms.** Indexer lag grows; mandate and activity pages go stale.

**Diagnosis.** Check the cursor. If it refuses to start with `DeploymentChanged`, the contracts were
replaced and the projections describe a retired deployment — that is the guard working, not a fault.

**Safe.** Restart; the cursor resumes from the last confirmed block and duplicates are no-ops. For a
redeployment, start a fresh cursor and index the old deployment separately as history.

**Unsafe.** Deleting the cursor to "unstick" it against the same deployment. You lose the reorg
boundary and replay from the deployment block with no record of what was already served.

**Recovery proven when.** Lag returns under threshold and `/api/ready` reports ready.

---

## ChainGPT unavailable

**Symptoms.** Extraction returns 504, or the gateway times out on dense documents.

**Diagnosis.** Measured behaviour: 6,000 chars of real filing with 11 fields takes ~38s; 25,713
chars returns 504 after 81s. The limit is output generation over information-dense text, not input
size.

**Safe.** Let the Passport become `singleSource`. Degrading privileges is the designed response.

**Unsafe.** Retrying until something comes back and treating it as a second independent path. An
attempted extraction is not a successful reading, and corroboration counts readings.

**Recovery proven when.** A bounded live run returns claims with verifiable quotes.

---

## Workflow stuck

**Symptoms.** Workflows sitting in `EVIDENCE_COMMIT_SUBMITTED` or `CONFIRMATION_UNKNOWN`.

**Safe.** Run reconciliation. It asks the chain whether the commitment exists and advances or
returns to pending accordingly.

**Unsafe.** Re-submitting because a receipt never arrived. That is how the same evidence gets
committed twice. The chain is the authority; local state never is.

**Recovery proven when.** The workflow reaches a terminal state, or `RECONCILIATION_REQUIRED` with
attempts exhausted — which is a human's problem, not a retry's.

---

## Confirmation-unknown accumulation

**Symptoms.** Rising count of intents in `EXECUTION_UNKNOWN`.

**Safe.** Reconcile against the venue. Reservations stay held.

**Unsafe.** Releasing reservations to free capacity. A timeout after submission does not mean the
execution failed, and releasing capital that may already be committed is how one outage becomes two
positions.

---

## Deployment drift

**Symptoms.** `make test-live-xlayer` reports a byte-count mismatch.

**Diagnosis.** The repository compiles something the chain does not run.

**Safe.** Redeploy coherently, regenerate the manifest, re-establish Passport and policy state,
regenerate proof, archive the superseded records under `proof/historical/`.

**Unsafe.** Editing a proof record to point at the new contracts. Historical proof stays historical;
rewriting it to match the present destroys evidence that was accurate when written.

---

## Oracle stale or unconfigured

**Symptoms.** Borrowing refused with `SettlementPriceStale` or `SettlementFreshnessUnconfigured`.

**Diagnosis.** Measured on X Layer mainnet: documented heartbeat 86,400s, worst observed gap
86,479s, and the settlement pairs publish only on heartbeat. A settlement price is roughly a day old
at all times; that is normal.

**Safe.** Confirm the feed is genuinely late before touching anything. Repay, add collateral and
withdrawal all remain open by design.

**Unsafe.** Widening the bound to clear the alert. That is the one change that lets the protocol
lend against a feed that has actually stopped, and it advances the epoch — invalidating every
outstanding quote — as a side effect.

---

## Vault stressed / withdrawal backlog

**Symptoms.** `availableCash` near zero, queue outstanding rising.

**Safe.** Let repayments and liquidation recoveries feed the queue; they are senior to new lending.
Show the queue honestly.

**Unsafe.** Paying a large queued redemption out of order. The queue is FIFO and its ordering is the
only thing making it fair.

---

## Bad debt recorded

**Symptoms.** `badDebt` non-zero.

**Diagnosis.** Reserves absorb first; only the excess reaches lender NAV.

**Safe.** Report the loss. Check whether liquidation was too slow or the exit curve too optimistic.

**Unsafe.** Writing the debt off without a corresponding loss. Bad debt that vanishes from the books
is bad debt somebody else is silently carrying.

---

## Keeper inactivity

**Symptoms.** Accounts in `MARGIN_CALL` with no liquidation.

**Diagnosis.** Check the keeper incentive is non-zero and that expected recovery exceeds gas.

**Safe.** Raise the incentive within its ceiling. It advances the epoch, which is correct — the
economics an outstanding quote was made under have changed.

**Unsafe.** Liquidating from a protocol-controlled address to "help". That is the protocol taking
the keeper's side of a trade against its own user.

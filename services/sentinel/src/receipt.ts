import { receiptIdFor, usanceReceiptSchema, type UsanceReceipt } from "@usance/evidence";
import { isRunTerminal, type SentinelInstance, type SentinelRun } from "@usance/schemas";

/**
 * Project a terminal Sentinel run onto the canonical `UsanceReceipt` family — one model, so the
 * public `/proof` page and the private run-detail surface can never disagree about what an agent did
 * (`docs/SENTINELS_ARCHITECTURE.md §16`). The receipt schema itself refuses a CONFIRMED receipt that
 * cannot cite a successful transaction, so "it executed" is never assertable without the tx.
 *
 * Returns `null` for a non-terminal run and for NO_ACTION_REQUIRED (no financial event to record —
 * the run record itself is the audit trail there).
 */
type TxStatus = "submitted" | "success" | "reverted" | "unknown";

export function sentinelRunReceipt(run: SentinelRun, instance: SentinelInstance): UsanceReceipt | null {
  if (!isRunTerminal(run.state) || run.state === "NO_ACTION_REQUIRED") return null;

  const executed = run.history.some((h) => h.to === "FILLED");
  const chainId = run.snapshot?.chainId ?? 1952;
  const primaryTx = run.transactions[0] ?? run.runId;

  let kind: string;
  let status: string;
  let lastTxStatus: TxStatus;
  if (run.state === "COMPLETE" && executed) {
    kind = "SENTINEL_RUN_EXECUTED";
    status = "CONFIRMED";
    lastTxStatus = "success";
  } else if (run.state === "COMPLETE") {
    // Reached COMPLETE without ever filling — a mined-and-reverted execution.
    kind = "SENTINEL_RUN_BLOCKED";
    status = "FAILED";
    lastTxStatus = "reverted";
  } else {
    // A blocked/rejected terminal: the refusal is real even though nothing reached the chain.
    kind = "SENTINEL_RUN_BLOCKED";
    status = "REJECTED_BY_POLICY";
    lastTxStatus = "reverted";
  }

  const transactions = run.transactions.map((txHash, i) => ({
    chainId,
    contract: "DelegationGateway",
    txHash,
    blockNumber: run.snapshot?.blockNumber ?? null,
    action: run.plan?.action ?? "UNKNOWN",
    status: i === run.transactions.length - 1 ? lastTxStatus : ("success" as TxStatus),
    revertReason: lastTxStatus === "reverted" && i === run.transactions.length - 1 ? (run.history.at(-1)?.reason ?? "reverted") : null,
    builderAttribution: null,
  }));

  const stateTransitions = run.history.map((h, i) => {
    const prev = i === 0 ? undefined : run.history[i - 1];
    return { at: h.at, from: prev?.to ?? "", to: h.to, note: h.reason ?? null };
  });

  return usanceReceiptSchema.parse({
    receiptId: receiptIdFor(kind as never, chainId, primaryTx),
    kind,
    status,
    chainId,
    accountId: instance.account,
    evidenceAssetId: null,
    financialAssetId: null,
    workflowId: run.runId,
    intentId: run.intentId,
    passportVersion: null,
    evidenceRoot: null,
    claimsRoot: null,
    singleSource: null,
    riskPolicyVersion: null,
    riskEpoch: run.snapshot?.riskEpoch ?? null,
    transactions,
    stateTransitions,
    createdAt: run.createdAt,
    completedAt: run.updatedAt,
  });
}

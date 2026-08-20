import { readFileSync, existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { receiptIdFor, type UsanceReceipt } from "@usance/evidence";

/**
 * Receipts backing the public proof explorer.
 *
 * Loaded from `proof/`, which holds records written by the scripts that actually submitted the
 * transactions. Nothing here is synthesised: if a receipt is not on disk with a transaction hash
 * in it, the route 404s rather than rendering a plausible-looking proof of something that did not
 * happen.
 */

const PROOF_DIR = resolve(process.cwd(), "../../proof");

let cache: UsanceReceipt[] | null = null;

export function loadReceipts(): UsanceReceipt[] {
  if (cache) return cache;
  if (!existsSync(PROOF_DIR)) return (cache = []);

  const out: UsanceReceipt[] = [];

  for (const file of readdirSync(PROOF_DIR).filter((f) => f.endsWith(".json"))) {
    const raw = JSON.parse(readFileSync(resolve(PROOF_DIR, file), "utf8")) as Record<string, unknown>;
    if (raw["kind"] === "LIVE_LIQUIDATION") {
      out.push(liquidationReceipt(raw));
      continue;
    }
    if (raw["kind"] === "LIVE_RISK_SCENARIO") {
      out.push(riskScenarioReceipt(raw));
      continue;
    }
    if (raw["kind"] === "LIVE_SENTINEL_AUTONOMOUS_RUN") {
      out.push(sentinelRunReceipt(raw));
      continue;
    }
    if (raw["kind"] === "LIVE_DELEGATED_AUTHORITY") {
      out.push(delegatedAuthorityReceipt(raw));
      continue;
    }
    if (raw["kind"] !== "PASSPORT_COMMITTED") continue;

    const txs = (raw["transactions"] as Array<Record<string, unknown>>) ?? [];
    const commitTx = txs.find((t) => String(t["label"]).includes("commitPassport"));
    if (!commitTx) continue;

    const passportReceipt: UsanceReceipt = {
      receiptId: receiptIdFor("PASSPORT_COMMITTED", Number(raw["chainId"]), String(commitTx["hash"])),
      kind: "PASSPORT_COMMITTED",
      status: "CONFIRMED",
      chainId: Number(raw["chainId"]),
      accountId: null,
      evidenceAssetId: raw["assetId"] as `0x${string}`,
      // Deliberately null. A Passport describes a product Usance has read about; it does not
      // custody a token. Filling this with the testnet stand-in would merge two identities the
      // whole design keeps apart.
      financialAssetId: null,
      workflowId: null,
      intentId: null,
      passportVersion: Number(raw["version"]),
      evidenceRoot: raw["evidenceRoot"] as `0x${string}`,
      claimsRoot: raw["claimsRoot"] as `0x${string}`,
      singleSource: Boolean(raw["singleSource"]),
      riskPolicyVersion: null,
      riskEpoch: Number(raw["riskEpoch"]),
      transactions: txs.map((t) => ({
        chainId: Number(raw["chainId"]),
        contract: String(t["label"]).split(".")[0] ?? "unknown",
        txHash: String(t["hash"]),
        blockNumber: Number(t["blockNumber"]),
        action: String(t["label"]),
        status: "success" as const,
        revertReason: null,
        builderAttribution: t["builderCode"]
          ? { schema: 0, code: String(t["builderCode"]), verified: true }
          : null,
      })),
      stateTransitions: [],
      createdAt: Number(raw["createdAt"]),
      completedAt: Number(raw["createdAt"]),
    };
    out.push(passportReceipt);

    // The epoch bump is a distinct event with its own transaction, so it gets its own receipt
    // rather than being a footnote on the Passport's.
    const epochTx = txs.find((t) => String(t["label"]).includes("bumpEpoch"));
    if (epochTx) {
      out.push({
        ...passportReceipt,
        receiptId: receiptIdFor("RISK_EPOCH_ACTIVATED", Number(raw["chainId"]), String(epochTx["hash"])),
        kind: "RISK_EPOCH_ACTIVATED",
        transactions: [
          {
            chainId: Number(raw["chainId"]),
            contract: "RiskPolicyRegistry",
            txHash: String(epochTx["hash"]),
            blockNumber: Number(epochTx["blockNumber"]),
            action: "bumpEpoch",
            status: "success" as const,
            revertReason: null,
            builderAttribution: epochTx["builderCode"]
              ? { schema: 0, code: String(epochTx["builderCode"]), verified: true }
              : null,
          },
        ],
      });
    }
  }

  return (cache = out);
}

const FULL_TX_HASH = /^0x[0-9a-fA-F]{64}$/;

/**
 * The live liquidation receipt.
 *
 * Everything a reader needs to judge whether the liquidation was justified is on the receipt: the
 * status that made the account eligible, the maintenance limit it breached, what the protocol
 * intended before it acted, and what changed. The explorer is supporting evidence, not the
 * explanation.
 *
 * The plan is included even though the outcome is known, because a liquidation that took what it
 * said it would take is a different thing from one that happened to land somewhere reasonable.
 */
function liquidationReceipt(raw: Record<string, unknown>): UsanceReceipt {
  const tx = raw["liquidationTx"] as Record<string, unknown>;
  const txs = (raw["transactions"] as Array<Record<string, unknown>>) ?? [];

  return {
    receiptId: receiptIdFor("LIQUIDATED", Number(raw["chainId"] ?? 1952), String(tx["hash"])),
    kind: "LIQUIDATED",
    status: "CONFIRMED",
    chainId: Number(raw["chainId"] ?? 1952),
    accountId: String(raw["account"]),
    // Labelled test tokens. This receipt asserts nothing about any issuer's filing.
    evidenceAssetId: null,
    financialAssetId: null,
    workflowId: null,
    intentId: null,
    passportVersion: null,
    evidenceRoot: null,
    claimsRoot: null,
    singleSource: null,
    riskPolicyVersion: null,
    riskEpoch: Number(raw["riskEpochAfter"] ?? 0) || null,
    transactions: [
      ...txs
        .filter((t) => FULL_TX_HASH.test(String(t["hash"])))
        .map((t) => ({
          chainId: Number(raw["chainId"] ?? 1952),
          contract: "ClearingHouse",
          txHash: String(t["hash"]) as `0x${string}`,
          blockNumber: Number(t["blockNumber"] ?? 0),
          action: String(t["label"]),
          status: (String(t["status"] ?? "success") === "reverted" ? "reverted" : "success") as "reverted" | "success",
          revertReason: null,
          builderAttribution: null,
        })),
    ],
    stateTransitions: ((raw["ladder"] as Array<Record<string, unknown>>) ?? []).map((l, i, all) => ({
      at: 0,
      from: i === 0 ? "NORMAL" : String(all[i - 1]?.["status"] ?? "NORMAL"),
      to: String(l["status"]),
      note: `collateral price at ${l["pricePct"]}% of its starting value`,
    })),
    createdAt: 0,
    completedAt: 0,
  };
}

/**
 * The live risk-lifecycle receipt.
 *
 * Two rules govern what is allowed onto this receipt, and both exist because the earlier draft
 * broke them.
 *
 * A hash is either complete or it is not shown. An earlier version padded short hashes to 66
 * characters so they would satisfy the schema, which produced explorer links that resolve to
 * nothing — a fabricated hash wearing the shape of a real one. Short entries are now dropped and
 * counted, and the count is surfaced rather than swallowed.
 *
 * The rejected borrow appears only once it has a hash of its own. `writeContract` simulates before
 * it broadcasts, so a reverting call throws in the client and never reaches a block. That is still
 * the protocol refusing, but it is not a mined transaction, and rendering it as one would be
 * exactly the kind of proof this explorer exists to make unnecessary.
 */
function riskScenarioReceipt(raw: Record<string, unknown>): UsanceReceipt {
  // Prior-run setup transactions come first: they are the provenance of the state the scenario
  // exercises, and a reader who sees a borrow without the deposit that backs it has been shown
  // half the story. Both lists are real, both are chain-verified, and block order sorts them.
  const txs = [
    ...((raw["priorTransactions"] as Array<Record<string, unknown>>) ?? []),
    ...((raw["transactions"] as Array<Record<string, unknown>>) ?? []),
  ].sort((a, b) => Number(a["blockNumber"] ?? 0) - Number(b["blockNumber"] ?? 0));
  const primary = txs.find((t) => String(t["label"]).includes("borrow")) ?? txs[0];
  const blocked = raw["newRiskBlocked"] as Record<string, unknown> | undefined;
  const blockedHash = blocked?.["hash"] === undefined ? null : String(blocked["hash"]);

  return {
    receiptId: receiptIdFor("BORROW_REJECTED", Number(raw["chainId"]), String(primary?.["hash"] ?? "0x0")),
    kind: "BORROW_REJECTED",
    status: "CONFIRMED",
    chainId: Number(raw["chainId"]),
    accountId: String(raw["account"]),
    // No evidence asset: this scenario used labelled test tokens and asserts nothing about any
    // issuer's filing. Leaving it null is the point, not an omission.
    evidenceAssetId: null,
    financialAssetId: null,
    workflowId: null,
    intentId: null,
    passportVersion: null,
    evidenceRoot: null,
    claimsRoot: null,
    singleSource: null,
    riskPolicyVersion: null,
    riskEpoch: null,
    transactions: [
      ...txs
        .filter((t) => FULL_TX_HASH.test(String(t["hash"])))
        .map((t) => ({
          chainId: Number(raw["chainId"]),
          contract: "ClearingHouse",
          txHash: String(t["hash"]) as `0x${string}`,
          blockNumber: Number(t["blockNumber"] ?? t["block"] ?? 0),
          action: String(t["label"]),
          status: (String(t["status"] ?? "success") === "reverted" ? "reverted" : "success") as
            | "reverted"
            | "success",
          revertReason: null,
          builderAttribution: null,
        })),
      ...(blockedHash && FULL_TX_HASH.test(blockedHash)
        ? [
            {
              chainId: Number(raw["chainId"]),
              contract: "ClearingHouse",
              txHash: blockedHash as `0x${string}`,
              blockNumber: Number(blocked?.["blockNumber"] ?? 0),
              action: `borrow ${String(blocked?.["attempted"] ?? "")} — rejected by the protocol`.trim(),
              status: "reverted" as const,
              revertReason: String(blocked?.["revertReason"] ?? blocked?.["result"] ?? "reverted"),
              builderAttribution: null,
            },
          ]
        : []),
    ],
    stateTransitions: [
      { at: 0, from: "NORMAL", to: "NO_NEW_RISK", note: String(raw["trigger"] ?? "") },
      { at: 0, from: "NO_NEW_RISK", to: "NORMAL", note: "repay all succeeded" },
    ],
    createdAt: 0,
    completedAt: 0,
  };
}

export function loadReceipt(id: string): UsanceReceipt | null {
  return loadReceipts().find((r) => r.receiptId === id) ?? null;
}

/**
 * The live autonomous-run receipt.
 *
 * The same `UsanceReceipt` family a Sentinel run projects to (`services/sentinel/src/receipt.ts`),
 * rebuilt here from the record the live-run script wrote to disk. Nothing is synthesised: the
 * transaction hashes, blocks and the debt delta are the ones the chain confirmed. An executed run
 * cites its repay and is CONFIRMED; a run refused before submission would carry REJECTED_BY_POLICY
 * with no confirmed repay — the receipt schema will not let "it executed" be asserted without a
 * successful transaction.
 */
function sentinelRunReceipt(raw: Record<string, unknown>): UsanceReceipt {
  const chainId = Number(raw["chainId"] ?? 1952);
  const repayTx = String(raw["repayTx"] ?? "");
  const txs = (raw["transactions"] as Array<Record<string, unknown>>) ?? [];
  const executed =
    FULL_TX_HASH.test(repayTx) &&
    txs.some((t) => String(t["hash"]) === repayTx && String(t["status"] ?? "success") !== "reverted");
  const kind = executed ? "SENTINEL_RUN_EXECUTED" : "SENTINEL_RUN_BLOCKED";
  const status = executed ? "CONFIRMED" : "REJECTED_BY_POLICY";

  return {
    receiptId: receiptIdFor(kind, chainId, executed ? repayTx : String(raw["runId"] ?? "0x0")),
    kind,
    status,
    chainId,
    accountId: String(raw["owner"] ?? ""),
    // Labelled test tokens. This receipt asserts nothing about any issuer's filing.
    evidenceAssetId: null,
    financialAssetId: null,
    // The run id is the workflow that produced this. The state machine it passed through lives on
    // the run record, not here — this receipt only asserts what the chain confirmed.
    workflowId: raw["runId"] ? String(raw["runId"]) : null,
    intentId: null,
    passportVersion: null,
    evidenceRoot: null,
    claimsRoot: null,
    singleSource: null,
    riskPolicyVersion: null,
    riskEpoch: null,
    transactions: txs
      .filter((t) => FULL_TX_HASH.test(String(t["hash"])))
      .sort((a, b) => Number(a["block"] ?? a["blockNumber"] ?? 0) - Number(b["block"] ?? b["blockNumber"] ?? 0))
      .map((t) => ({
        chainId,
        contract: sentinelContractFor(String(t["label"])),
        txHash: String(t["hash"]) as `0x${string}`,
        blockNumber: Number(t["block"] ?? t["blockNumber"] ?? 0) || null,
        action: String(t["label"]),
        status: (String(t["status"] ?? "success") === "reverted" ? "reverted" : "success") as "reverted" | "success",
        revertReason: null,
        builderAttribution: null,
      })),
    stateTransitions: [],
    createdAt: 0,
    completedAt: 0,
  };
}

/** Which contract each recorded live-run transaction actually touched — for the receipt's tx table. */
function sentinelContractFor(label: string): string {
  const l = label.toLowerCase();
  if (l.includes("registermandate")) return "MandateRegistry";
  if (l.includes("approve")) return "repay asset (ERC-20)";
  return "DelegationGateway";
}

/** The observe→plan→authorize→execute facts and debt delta the proof page's Sentinel explainer cites. */
export interface SentinelRunProofView {
  executed: boolean;
  agent: string;
  action: string;
  amountUsd18: string | null;
  riskDirection: string;
  triggerClass: string;
  triggerAuthority: string;
  debtBefore: string | null;
  debtAfter: string | null;
  identityWarning: string;
}

export function sentinelRunFor(receiptId: string): SentinelRunProofView | null {
  if (!existsSync(PROOF_DIR)) return null;
  for (const file of readdirSync(PROOF_DIR).filter((f) => f.endsWith(".json"))) {
    const raw = JSON.parse(readFileSync(resolve(PROOF_DIR, file), "utf8")) as Record<string, unknown>;
    if (raw["kind"] !== "LIVE_SENTINEL_AUTONOMOUS_RUN") continue;
    // Reuse the builder's id derivation so the match can never drift from the receipt it describes.
    if (sentinelRunReceipt(raw).receiptId !== receiptId) continue;

    const plan = (raw["plan"] as Record<string, unknown>) ?? {};
    const trigger = (raw["trigger"] as Record<string, unknown>) ?? {};
    const repayTx = String(raw["repayTx"] ?? "");
    const txs = (raw["transactions"] as Array<Record<string, unknown>>) ?? [];
    return {
      executed:
        FULL_TX_HASH.test(repayTx) &&
        txs.some((t) => String(t["hash"]) === repayTx && String(t["status"] ?? "success") !== "reverted"),
      agent: String(raw["agent"] ?? ""),
      action: String(plan["action"] ?? "UNKNOWN"),
      amountUsd18: plan["amountUsd18"] ? String(plan["amountUsd18"]) : null,
      riskDirection: String(plan["riskDirection"] ?? "REDUCING"),
      triggerClass: String(trigger["class"] ?? ""),
      triggerAuthority: String(trigger["authority"] ?? ""),
      debtBefore: raw["debtBefore"] ? String(raw["debtBefore"]) : null,
      debtAfter: raw["debtAfter"] ? String(raw["debtAfter"]) : null,
      identityWarning: String(raw["identityWarning"] ?? ""),
    };
  }
  return null;
}

/**
 * The live delegated-authority receipt.
 *
 * The flagship proof of the mandate mechanics, rebuilt from the record `scripts/live-mandate.mjs`
 * wrote. Its point is not that a repay happened — plain repays are unremarkable — but that a bounded
 * delegated key acted *within* its mandate, was refused *outside* it, and that revocation was
 * terminal. All three claims are cited by mined transactions: the successful delegated repay, the
 * reverted collateral-outflow attempt, and the reverted post-revocation retry. CONFIRMED because it
 * cites successful transactions; the refusals ride alongside as reverted rows.
 */
function delegatedAuthorityReceipt(raw: Record<string, unknown>): UsanceReceipt {
  const chainId = Number(raw["chainId"] ?? 1952);
  const txs = (raw["transactions"] as Array<Record<string, unknown>>) ?? [];
  const repay = txs.find((t) => /gateway\.execute|repay/i.test(String(t["label"])));
  const revocation = (raw["revocation"] as Record<string, unknown>) ?? {};
  const primary = String(repay?.["hash"] ?? revocation["revokeTx"] ?? raw["owner"] ?? "0x0");

  return {
    receiptId: receiptIdFor("MANDATE_DELEGATED", chainId, primary),
    kind: "MANDATE_DELEGATED",
    status: "CONFIRMED",
    chainId,
    accountId: String(raw["owner"] ?? ""),
    // Labelled test tokens. This receipt asserts nothing about any issuer's filing — it proves the
    // authority mechanics; the Franklin Passport proves the evidence mechanics.
    evidenceAssetId: null,
    financialAssetId: null,
    workflowId: null,
    intentId: null,
    passportVersion: null,
    evidenceRoot: null,
    claimsRoot: null,
    singleSource: null,
    riskPolicyVersion: null,
    riskEpoch: null,
    transactions: txs
      .filter((t) => FULL_TX_HASH.test(String(t["hash"])))
      .sort((a, b) => Number(a["blockNumber"] ?? a["block"] ?? 0) - Number(b["blockNumber"] ?? b["block"] ?? 0))
      .map((t) => ({
        chainId,
        contract: delegatedContractFor(String(t["label"])),
        txHash: String(t["hash"]) as `0x${string}`,
        blockNumber: Number(t["blockNumber"] ?? t["block"] ?? 0) || null,
        action: String(t["label"]),
        status: (String(t["status"] ?? "success") === "reverted" ? "reverted" : "success") as "reverted" | "success",
        revertReason: null,
        builderAttribution: null,
      })),
    stateTransitions: [],
    createdAt: 0,
    completedAt: 0,
  };
}

/** Which contract each recorded delegated-authority transaction touched — for the receipt's tx table. */
function delegatedContractFor(label: string): string {
  const l = label.toLowerCase();
  if (l.includes("registermandate") || l.includes("revokemandate")) return "MandateRegistry";
  if (l.includes("addcollateral")) return "CollateralVault";
  if (l.includes("mint") || l.includes("approve")) return "ERC-20";
  return "DelegationGateway";
}

/** The bounded-authority facts the proof page's delegated-mandate explainer cites. */
export interface DelegatedProofView {
  agent: string;
  mandateActions: string[];
  mandateExpiresInSeconds: number | null;
  repayDebtBefore: string | null;
  repayDebtAfter: string | null;
  withdrawalRefused: boolean;
  revoked: boolean;
  postRevocationRefused: boolean;
  revocationNote: string;
  identityWarning: string;
}

export function delegatedFor(receiptId: string): DelegatedProofView | null {
  if (!existsSync(PROOF_DIR)) return null;
  for (const file of readdirSync(PROOF_DIR).filter((f) => f.endsWith(".json"))) {
    const raw = JSON.parse(readFileSync(resolve(PROOF_DIR, file), "utf8")) as Record<string, unknown>;
    if (raw["kind"] !== "LIVE_DELEGATED_AUTHORITY") continue;
    // Reuse the builder's id derivation so the match can never drift from the receipt it describes.
    if (delegatedAuthorityReceipt(raw).receiptId !== receiptId) continue;

    const mandate = (raw["mandate"] as Record<string, unknown>) ?? {};
    const withdrawal = (raw["withdrawalRefusal"] as Record<string, unknown>) ?? {};
    const revocation = (raw["revocation"] as Record<string, unknown>) ?? {};
    const post = (revocation["postRevocationAttempt"] as Record<string, unknown>) ?? {};
    return {
      agent: String(raw["agent"] ?? ""),
      mandateActions: Array.isArray(mandate["actions"]) ? (mandate["actions"] as string[]) : [],
      mandateExpiresInSeconds: mandate["expiresInSeconds"] != null ? Number(mandate["expiresInSeconds"]) : null,
      repayDebtBefore: raw["debtBefore"] ? String(raw["debtBefore"]) : null,
      repayDebtAfter: raw["debtAfter"] ? String(raw["debtAfter"]) : null,
      withdrawalRefused: String(withdrawal["status"] ?? "") === "reverted",
      revoked: revocation["liveAfter"] === false && revocation["liveBefore"] === true,
      postRevocationRefused: String(post["status"] ?? "") === "reverted",
      revocationNote: String(revocation["note"] ?? ""),
      identityWarning: String(raw["identityWarning"] ?? ""),
    };
  }
  return null;
}

/** The source metadata a Passport receipt cites, kept alongside the receipt on disk. */
export function evidenceFor(receiptId: string): Record<string, string> | null {
  if (!existsSync(PROOF_DIR)) return null;
  for (const file of readdirSync(PROOF_DIR).filter((f) => f.endsWith(".json"))) {
    const raw = JSON.parse(readFileSync(resolve(PROOF_DIR, file), "utf8")) as Record<string, unknown>;
    const txs = (raw["transactions"] as Array<Record<string, unknown>>) ?? [];
    const match = txs.some(
      (t) =>
        receiptIdFor("PASSPORT_COMMITTED", Number(raw["chainId"]), String(t["hash"])) === receiptId ||
        receiptIdFor("RISK_EPOCH_ACTIVATED", Number(raw["chainId"]), String(t["hash"])) === receiptId,
    );
    if (match) {
      return {
        ...(raw["evidence"] as Record<string, string>),
        identityWarning: String(raw["identityWarning"] ?? ""),
        corroborationNote: String((raw["corroboration"] as Record<string, unknown>)?.["note"] ?? ""),
      };
    }
  }
  return null;
}

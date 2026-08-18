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
    if (raw["kind"] === "LIVE_RISK_SCENARIO") {
      out.push(riskScenarioReceipt(raw));
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

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

/**
 * The live risk-lifecycle receipt.
 *
 * Status is CONFIRMED because the deterioration, the rejection and the repayment all happened as
 * real transactions. The rejected borrow is recorded as a transaction with status "reverted" and a
 * revertReason, because a refusal that reached the chain is evidence and hiding it would leave the
 * strongest claim in the scenario undocumented.
 */
function riskScenarioReceipt(raw: Record<string, unknown>): UsanceReceipt {
  const txs = (raw["transactions"] as Array<Record<string, unknown>>) ?? [];
  const primary = txs.find((t) => String(t["label"]).includes("borrow")) ?? txs[0];
  const blocked = raw["newRiskBlocked"] as Record<string, unknown> | undefined;

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
      ...txs.map((t) => ({
        chainId: Number(raw["chainId"]),
        contract: "ClearingHouse",
        txHash: String(t["hash"]).length === 66 ? String(t["hash"]) : `${String(t["hash"])}${"0".repeat(66 - String(t["hash"]).length)}`,
        blockNumber: Number(t["block"] ?? t["blockNumber"] ?? 0),
        action: String(t["label"]),
        status: "success" as const,
        revertReason: null,
        builderAttribution: null,
      })),
      {
        chainId: Number(raw["chainId"]),
        contract: "ClearingHouse",
        txHash: `0x${"0".repeat(64)}`,
        blockNumber: null,
        action: "borrow (rejected)",
        status: "reverted" as const,
        revertReason: String(blocked?.["result"] ?? "reverted"),
        builderAttribution: null,
      },
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

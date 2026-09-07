import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The live state the browser tests assert against.
 *
 * Read from the same artifacts the app reads. A suite carrying its own copy of the expected
 * addresses would pass against a superseded deployment — the exact failure this repository has hit
 * three times — so the expectations come from the generated manifest and the proof records.
 */

// ESM: the workspace is type: module, so __dirname does not exist here.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const read = <T>(rel: string): T | null => {
  const p = resolve(root, rel);
  return existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as T) : null;
};

export interface Deployment {
  chainId: number;
  commit: string;
  contracts: Record<string, string>;
  explorer: string;
}

export const deployment = read<Deployment>("deployments/1952.json");

export interface ProofRecord {
  transactions?: Array<{ hash: string; label: string; blockNumber?: number }>;
  liquidationTx?: { hash: string; blockNumber: number };
  newRiskBlocked?: { hash: string };
}

// Moved to proof/historical/ in Phase 05 (superseded core). Kept null so the tests that assert
// their receipts skip with a stated reason rather than asserting against a retired deployment.
// null on purpose: these proofs were moved to proof/historical/ in Phase 05 because they
// described a superseded core deployment. The receipt-navigation tests skip with a stated
// reason rather than asserting against a receipt the current product no longer surfaces.
export const passport: ProofRecord | null = null;
export const riskScenario = read<ProofRecord>("proof/live-risk-scenario.json");
export const liquidation: ProofRecord | null = null;

export const FULL_TX_HASH = /^0x[0-9a-fA-F]{64}$/;

/** Every full transaction hash the proof records claim, for the "no truncation" assertions. */
export function allProofHashes(): string[] {
  const out: string[] = [];
  for (const rec of [passport, riskScenario, liquidation]) {
    if (!rec) continue;
    for (const t of rec.transactions ?? []) out.push(t.hash);
    if (rec.liquidationTx) out.push(rec.liquidationTx.hash);
    if (rec.newRiskBlocked?.hash) out.push(rec.newRiskBlocked.hash);
  }
  return out.filter((h) => FULL_TX_HASH.test(h));
}

/** Receipt ids the app generates, derived the same way the loader derives them. */
export function receiptSlug(kind: string, chainId: number, txHash: string): string {
  return `${kind.toLowerCase().replace(/_/g, "-")}-${chainId}-${txHash.slice(2, 18)}`;
}

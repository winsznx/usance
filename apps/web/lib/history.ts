import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * The semantic history artifact, read for the public asset page.
 *
 * Loaded from disk rather than recomputed here, so the page and the tests are looking at the same
 * bytes. The artifact carries provenance; a page that displayed a diff it computed itself could
 * silently disagree with the one the tests assert on.
 */

const ARTIFACT = resolve(process.cwd(), "../../artifacts/evidence/franklin-history.json");

export interface HistoryChange {
  group: string;
  field: string;
  kind: "VALUE_CHANGE" | "COVERAGE_DIFFERENCE";
  from: unknown;
  to: unknown;
  riskDirection: "DETERIORATION" | "IMPROVEMENT" | null;
}

export interface HistoryTransition {
  from: string;
  to: string;
  classification:
    | "NO_MATERIAL_CHANGE"
    | "MATERIAL_CHANGE_NO_RISK_IMPACT"
    | "MATERIAL_RISK_IMPROVEMENT"
    | "MATERIAL_RISK_DETERIORATION";
  materialChanges: number;
  coverageDifferences: number;
  changes: HistoryChange[];
  coverage: {
    fieldsInScope: number;
    fieldsComparedOnBothSides: number;
    comparedFields: string[];
    fieldsAbsentFromBoth: number;
    note: string;
  };
  contentHashesDiffer: boolean;
}

export interface AssetHistory {
  instrument: string;
  method: string;
  generatedAt: string;
  gitCommit: string;
  filings: Array<{ fixtureId: string; contentHash: string; effectiveAt: number; claimCount: number }>;
  transitions: HistoryTransition[];
}

let cache: AssetHistory | null | undefined;

export function loadHistory(instrument: string): AssetHistory | null {
  if (cache === undefined) {
    cache = existsSync(ARTIFACT) ? (JSON.parse(readFileSync(ARTIFACT, "utf8")) as AssetHistory & { $provenance: { generatedAt: string; gitCommit: string } }) : null;
    if (cache) {
      const p = (cache as unknown as { $provenance: { generatedAt: string; gitCommit: string } }).$provenance;
      cache = { ...cache, generatedAt: p.generatedAt, gitCommit: p.gitCommit };
    }
  }
  return cache && cache.instrument === instrument ? cache : null;
}

export const CLASSIFICATION_COPY: Record<
  HistoryTransition["classification"],
  { label: string; tone: "neutral" | "good" | "warn" | "stop"; blurb: string }
> = {
  NO_MATERIAL_CHANGE: {
    label: "No material change",
    tone: "neutral",
    blurb:
      "The filings differ as documents and say the same things about the fund's terms. Nothing Usance " +
      "relies on moved, so no risk parameter changed.",
  },
  MATERIAL_CHANGE_NO_RISK_IMPACT: {
    label: "Changed, no risk effect",
    tone: "neutral",
    blurb:
      "Something Usance tracks changed, and it is not a field with an encoded risk direction. It is " +
      "recorded rather than acted on.",
  },
  MATERIAL_RISK_IMPROVEMENT: {
    label: "Terms improved",
    tone: "good",
    blurb: "A term moved in the holder's favour.",
  },
  MATERIAL_RISK_DETERIORATION: {
    label: "Terms deteriorated",
    tone: "stop",
    blurb:
      "A term moved against the holder. Deterministic policy reads this and capacity changes on the " +
      "next epoch — no human retypes a number.",
  },
};

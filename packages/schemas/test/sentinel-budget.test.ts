import { describe, expect, it } from "vitest";
import {
  BudgetLedgerError,
  confirmBudget,
  feeSpentUsd18,
  releaseBudget,
  reserveBudget,
  sentinelBudgetSchema,
  spentUsd18,
  withinBudget,
  type BudgetLedger,
} from "../src/sentinel-budget";
import type { Hex32 } from "../src/primitives";

const RID = (n: number): Hex32 => `0x${n.toString(16).padStart(64, "0")}` as Hex32;
const usd = (n: number): string => (BigInt(n) * 10n ** 18n).toString();

const budget = {
  maxPerRunUsd18: usd(500),
  maxPerDayUsd18: usd(1_500),
  cooldownSeconds: 900,
};

describe("budget schema", () => {
  it("accepts a budget and rejects unknown fields", () => {
    expect(sentinelBudgetSchema.parse(budget).cooldownSeconds).toBe(900);
    expect(() => sentinelBudgetSchema.parse({ ...budget, maxLeverageBps: 5_000 })).toThrow();
  });
});

describe("ledger idempotency (I-69)", () => {
  it("a second reserve for the same runId is a no-op", () => {
    let ledger: BudgetLedger = [];
    ledger = reserveBudget(ledger, RID(1), usd(100), usd(1), 1_000);
    ledger = reserveBudget(ledger, RID(1), usd(100), usd(1), 1_050);
    expect(ledger).toHaveLength(1);
    expect(spentUsd18(ledger)).toBe(100n * 10n ** 18n);
  });
});

describe("execution-unknown releases nothing (I-64)", () => {
  it("a reserved-but-unconfirmed run still counts as spent", () => {
    const ledger = reserveBudget([], RID(1), usd(100), usd(1), 1_000);
    // #then unknown execution is not "didn't happen": the reservation still counts
    expect(spentUsd18(ledger)).toBe(100n * 10n ** 18n);
  });

  it("a confirmed run cannot be released", () => {
    let ledger = reserveBudget([], RID(1), usd(100), usd(1), 1_000);
    ledger = confirmBudget(ledger, RID(1));
    expect(() => releaseBudget(ledger, RID(1))).toThrow(BudgetLedgerError);
  });

  it("reconciliation may release a reserved run, dropping it from spend", () => {
    let ledger = reserveBudget([], RID(1), usd(100), usd(1), 1_000);
    ledger = releaseBudget(ledger, RID(1));
    expect(spentUsd18(ledger)).toBe(0n);
    // #then confirm after release is illegal
    expect(() => confirmBudget(ledger, RID(1))).toThrow(BudgetLedgerError);
  });
});

describe("fees accrue only on confirmed runs (I-70)", () => {
  it("a reserved run has spent no fee; a confirmed one has", () => {
    let ledger = reserveBudget([], RID(1), usd(100), usd(5), 1_000);
    expect(feeSpentUsd18(ledger)).toBe(0n);
    ledger = confirmBudget(ledger, RID(1));
    expect(feeSpentUsd18(ledger)).toBe(5n * 10n ** 18n);
  });
});

describe("withinBudget", () => {
  it("passes a fresh run inside every cap", () => {
    expect(withinBudget(budget, [], usd(100), usd(0), 1_000)).toEqual({ ok: true });
  });

  it("refuses a per-run overspend", () => {
    expect(withinBudget(budget, [], usd(501), usd(0), 1_000).reason).toBe("BUDGET_PER_RUN");
  });

  it("refuses when the rolling day cap would be crossed", () => {
    let ledger: BudgetLedger = [];
    ledger = reserveBudget(ledger, RID(1), usd(500), usd(0), 1_000);
    ledger = reserveBudget(ledger, RID(2), usd(500), usd(0), 1_100);
    ledger = reserveBudget(ledger, RID(3), usd(500), usd(0), 1_200);
    // 1500 already committed today; a 4th 500 crosses 1500
    expect(withinBudget(budget, ledger, usd(500), usd(0), 1_300).reason).toBe("BUDGET_DAILY");
  });

  it("refuses inside the cooldown window and passes once it elapses", () => {
    const ledger = reserveBudget([], RID(1), usd(100), usd(0), 1_000);
    expect(withinBudget(budget, ledger, usd(100), usd(0), 1_500).reason).toBe("BUDGET_COOLDOWN");
    expect(withinBudget(budget, ledger, usd(100), usd(0), 1_900)).toEqual({ ok: true });
  });

  it("refuses a total overspend", () => {
    const capped = { ...budget, maxTotalUsd18: usd(400) };
    const ledger = reserveBudget([], RID(1), usd(300), usd(0), 1_000);
    expect(withinBudget(capped, ledger, usd(200), usd(0), 5_000).reason).toBe("BUDGET_TOTAL");
  });

  it("refuses a fee overspend counting only confirmed fees", () => {
    const capped = { ...budget, maxFeeUsd18: usd(3) };
    let ledger = reserveBudget([], RID(1), usd(100), usd(2), 1_000);
    ledger = confirmBudget(ledger, RID(1));
    expect(withinBudget(capped, ledger, usd(100), usd(2), 5_000).reason).toBe("BUDGET_FEE");
  });

  it("refuses when runs-per-hour is exhausted", () => {
    const capped = { ...budget, maxRunsPerHour: 1 };
    const ledger = reserveBudget([], RID(1), usd(10), usd(0), 1_000);
    expect(withinBudget(capped, ledger, usd(10), usd(0), 1_100).reason).toBe("BUDGET_RUNS_PER_HOUR");
  });
});

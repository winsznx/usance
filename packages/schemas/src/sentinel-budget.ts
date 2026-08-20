import { z } from "zod";
import { hex32Schema, unixSecondsSchema, type Hex32 } from "./primitives";
import { parseUsd18, usd18StringSchema } from "./sentinel-run";

/**
 * Sentinel budgets: the inner, per-strategy pacing inside the mandate's outer wall. The mandate's
 * onchain cumulative caps are the hard bound a compromised runtime cannot exceed; a budget is a
 * tighter, softer bound this runtime enforces. Its ledger is the mechanism behind three invariants:
 * consumption is idempotent per runId (I-69), EXECUTION_UNKNOWN releases nothing (I-64), and a
 * never-executed run pays no fee while a retry pays none twice (I-70).
 */

export const sentinelBudgetSchema = z
  .object({
    maxPerRunUsd18: usd18StringSchema,
    maxPerDayUsd18: usd18StringSchema.optional(),
    rollingWindow: z
      .object({ windowSeconds: z.number().int().min(60), capUsd18: usd18StringSchema })
      .strict()
      .optional(),
    maxTotalUsd18: usd18StringSchema.optional(),
    maxRunsPerHour: z.number().int().min(1).optional(),
    maxRunsPerDay: z.number().int().min(1).optional(),
    maxFeeUsd18: usd18StringSchema.optional(),
    maxSlippageBps: z.number().int().min(0).max(10_000).optional(),
    cooldownSeconds: z.number().int().min(0),
    maxOutstandingReservationUsd18: usd18StringSchema.optional(),
  })
  .strict();

export type SentinelBudget = z.infer<typeof sentinelBudgetSchema>;

/**
 * A ledger entry is keyed by runId and moves RESERVED → CONFIRMED (execution proven) or
 * RESERVED → RELEASED (reconciliation proved nothing executed). CONFIRMED never releases:
 * "unknown" is not "didn't happen", so an unresolved run keeps its consumption until reconciliation
 * proves otherwise.
 */
export const BUDGET_ENTRY_STATES = ["RESERVED", "CONFIRMED", "RELEASED"] as const;
export type BudgetEntryState = (typeof BUDGET_ENTRY_STATES)[number];

export const budgetLedgerEntrySchema = z
  .object({
    runId: hex32Schema,
    state: z.enum(BUDGET_ENTRY_STATES),
    amountUsd18: usd18StringSchema,
    feeUsd18: usd18StringSchema,
    effectiveAt: unixSecondsSchema,
  })
  .strict();

export type BudgetLedgerEntry = z.infer<typeof budgetLedgerEntrySchema>;

/** The ledger is a set of entries, at most one per runId. */
export type BudgetLedger = readonly BudgetLedgerEntry[];

export class BudgetLedgerError extends Error {
  readonly code = "BUDGET_LEDGER_ERROR";
  constructor(message: string) {
    super(message);
    this.name = "BudgetLedgerError";
  }
}

function findEntry(ledger: BudgetLedger, runId: Hex32): BudgetLedgerEntry | undefined {
  return ledger.find((e) => e.runId === runId);
}

/**
 * Reserve a run's spend. Idempotent: a second reserve for the same runId returns the ledger
 * unchanged (I-69), regardless of amount — a retry cannot mint a second reservation.
 */
export function reserveBudget(
  ledger: BudgetLedger,
  runId: Hex32,
  amountUsd18: string,
  feeUsd18: string,
  effectiveAt: number,
): BudgetLedger {
  if (findEntry(ledger, runId)) return ledger;
  return [...ledger, budgetLedgerEntrySchema.parse({ runId, state: "RESERVED", amountUsd18, feeUsd18, effectiveAt })];
}

/** Confirm execution. RESERVED → CONFIRMED; idempotent if already CONFIRMED; refuses a released run. */
export function confirmBudget(ledger: BudgetLedger, runId: Hex32): BudgetLedger {
  const e = findEntry(ledger, runId);
  if (!e) throw new BudgetLedgerError(`confirm of unknown run ${runId}`);
  if (e.state === "CONFIRMED") return ledger;
  if (e.state === "RELEASED") throw new BudgetLedgerError(`cannot confirm a released run ${runId}`);
  return ledger.map((x) => (x.runId === runId ? { ...x, state: "CONFIRMED" as const } : x));
}

/**
 * Release a reservation because reconciliation proved nothing executed. RESERVED → RELEASED only;
 * a CONFIRMED run cannot be released (I-64). Idempotent if already RELEASED.
 */
export function releaseBudget(ledger: BudgetLedger, runId: Hex32): BudgetLedger {
  const e = findEntry(ledger, runId);
  if (!e) throw new BudgetLedgerError(`release of unknown run ${runId}`);
  if (e.state === "RELEASED") return ledger;
  if (e.state === "CONFIRMED") throw new BudgetLedgerError(`cannot release a confirmed run ${runId} (I-64)`);
  return ledger.map((x) => (x.runId === runId ? { ...x, state: "RELEASED" as const } : x));
}

/** Entries that still count against budget: RESERVED (pending, unknown-safe) or CONFIRMED. */
function committed(ledger: BudgetLedger): BudgetLedgerEntry[] {
  return ledger.filter((e) => e.state !== "RELEASED");
}

export function spentUsd18(ledger: BudgetLedger): bigint {
  return committed(ledger).reduce((s, e) => s + parseUsd18(e.amountUsd18), 0n);
}

export function spentSinceUsd18(ledger: BudgetLedger, sinceInclusive: number): bigint {
  return committed(ledger)
    .filter((e) => e.effectiveAt >= sinceInclusive)
    .reduce((s, e) => s + parseUsd18(e.amountUsd18), 0n);
}

/** Fees only accrue on CONFIRMED (executed) runs — I-70. */
export function feeSpentUsd18(ledger: BudgetLedger): bigint {
  return ledger.filter((e) => e.state === "CONFIRMED").reduce((s, e) => s + parseUsd18(e.feeUsd18), 0n);
}

export function runCountSince(ledger: BudgetLedger, sinceInclusive: number): number {
  return committed(ledger).filter((e) => e.effectiveAt >= sinceInclusive).length;
}

export function lastEffectiveAt(ledger: BudgetLedger): number | null {
  const c = committed(ledger);
  return c.length ? c.reduce((m, e) => Math.max(m, e.effectiveAt), 0) : null;
}

export interface BudgetCheck {
  readonly ok: boolean;
  readonly reason?: string;
}

/**
 * Would spending `amountUsd18` (+ `feeUsd18`) at `now` stay within budget, given the ledger? Pure,
 * no side effects — the caller reserves only after this passes. Cooldown is measured from the last
 * committed run's effective time. Reasons are the machine names the run's BLOCKED_BY_BUDGET carries.
 */
export function withinBudget(
  budget: SentinelBudget,
  ledger: BudgetLedger,
  amountUsd18: string,
  feeUsd18: string,
  now: number,
): BudgetCheck {
  const amount = parseUsd18(amountUsd18);
  const fee = parseUsd18(feeUsd18);

  if (amount > parseUsd18(budget.maxPerRunUsd18)) return { ok: false, reason: "BUDGET_PER_RUN" };

  if (budget.maxTotalUsd18 !== undefined && spentUsd18(ledger) + amount > parseUsd18(budget.maxTotalUsd18))
    return { ok: false, reason: "BUDGET_TOTAL" };

  if (budget.maxPerDayUsd18 !== undefined) {
    if (spentSinceUsd18(ledger, now - 86_400) + amount > parseUsd18(budget.maxPerDayUsd18))
      return { ok: false, reason: "BUDGET_DAILY" };
  }

  if (budget.rollingWindow) {
    const since = now - budget.rollingWindow.windowSeconds;
    if (spentSinceUsd18(ledger, since) + amount > parseUsd18(budget.rollingWindow.capUsd18))
      return { ok: false, reason: "BUDGET_WINDOW" };
  }

  if (budget.maxFeeUsd18 !== undefined && feeSpentUsd18(ledger) + fee > parseUsd18(budget.maxFeeUsd18))
    return { ok: false, reason: "BUDGET_FEE" };

  if (budget.maxRunsPerHour !== undefined && runCountSince(ledger, now - 3_600) >= budget.maxRunsPerHour)
    return { ok: false, reason: "BUDGET_RUNS_PER_HOUR" };

  if (budget.maxRunsPerDay !== undefined && runCountSince(ledger, now - 86_400) >= budget.maxRunsPerDay)
    return { ok: false, reason: "BUDGET_RUNS_PER_DAY" };

  const last = lastEffectiveAt(ledger);
  if (budget.cooldownSeconds > 0 && last !== null && now - last < budget.cooldownSeconds)
    return { ok: false, reason: "BUDGET_COOLDOWN" };

  return { ok: true };
}

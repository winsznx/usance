import type { BudgetLedger, Hex32 } from "@usance/schemas";

/**
 * Per-instance budget ledgers. The ledger itself and its idempotent mutations live in
 * `@usance/schemas` (I-64/I-69/I-70); this is only the durable home for one ledger per instance,
 * the same file-or-memory split the run store uses.
 */
export interface BudgetStore {
  get(instanceId: Hex32): Promise<BudgetLedger>;
  save(instanceId: Hex32, ledger: BudgetLedger): Promise<void>;
}

export class InMemoryBudgetStore implements BudgetStore {
  private readonly ledgers = new Map<Hex32, BudgetLedger>();
  async get(instanceId: Hex32): Promise<BudgetLedger> {
    return this.ledgers.get(instanceId) ?? [];
  }
  async save(instanceId: Hex32, ledger: BudgetLedger): Promise<void> {
    this.ledgers.set(instanceId, ledger);
  }
}

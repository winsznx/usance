import { priorityRank, type Hex32, type SentinelInstance, type SentinelRun, type TriggerEvent } from "@usance/schemas";
import { SentinelEngine, type ProcessResult } from "./engine";
import type { RunStore } from "./run-store";

/**
 * The supervisor is the host loop: it holds pending trigger work, processes it in priority order per
 * account, and — after a crash — reconciles every in-flight run against the chain. It adds ordering,
 * not authority: the engine still runs the full `ProtocolAllows ∧ MandateAllows` loop per item, and
 * onchain reservation state remains the only capacity truth (I-67).
 */
export interface SupervisorItem {
  readonly instance: SentinelInstance;
  readonly config: unknown;
  readonly trigger: TriggerEvent;
  readonly triggerVersion: number;
}

export class SentinelSupervisor {
  private queue: SupervisorItem[] = [];

  constructor(
    private readonly engine: SentinelEngine,
    private readonly store: RunStore,
  ) {}

  enqueue(item: SupervisorItem): void {
    this.queue.push(item);
  }

  get pending(): number {
    return this.queue.length;
  }

  /**
   * Drain the queue, highest priority first. Within one drain, a yield-class (P4) item on an account
   * yields to any higher-priority item on the same account — a Yield Sentinel never consumes the
   * capacity a Safety Sentinel is about to need.
   */
  async drain(): Promise<ProcessResult[]> {
    const items = [...this.queue].sort(
      (a, b) => priorityRank(a.instance.priorityClass) - priorityRank(b.instance.priorityClass),
    );
    this.queue = [];

    const higherPriorityAccounts = new Set<Hex32>();
    const results: ProcessResult[] = [];
    for (const it of items) {
      const account = it.instance.account as Hex32;
      const higherPriorityPending = higherPriorityAccounts.has(account);
      results.push(
        await this.engine.processTrigger(it.instance, it.config, it.trigger, it.triggerVersion, {
          higherPriorityPending,
        }),
      );
      // A higher-than-yield item claims the account for this drain, so a later P4 item yields.
      if (priorityRank(it.instance.priorityClass) < priorityRank("P4_YIELD_OPPORTUNISTIC")) {
        higherPriorityAccounts.add(account);
      }
    }
    return results;
  }

  /**
   * After a restart, resolve every resumable run by asking the chain (never local state). A run
   * mid-flight resumes exactly where it was; nothing is re-executed on the strength of a lost
   * response.
   */
  async recover(resolveInstance: (instanceId: Hex32) => SentinelInstance | undefined): Promise<SentinelRun[]> {
    const resumable = await this.store.resumable();
    const out: SentinelRun[] = [];
    for (const run of resumable) {
      const instance = resolveInstance(run.instanceId);
      if (!instance) continue;
      out.push(await this.engine.reconcile(run, instance));
    }
    return out;
  }
}

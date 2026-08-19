import type { Hex32 } from "@usance/schemas";

/**
 * Offchain projections of onchain events.
 *
 * The rule the whole file is built around: **applying an event twice must change nothing.** An
 * indexer restarts, an RPC returns an overlapping range, a reorg replays a block — all three are
 * ordinary, and all three deliver an event a second time. A projection that adds on receipt is a
 * projection that silently doubles somebody's balance the first time any of them happens.
 *
 * So every event carries an identity — `(blockNumber, logIndex, txHash)` — and applying one that has
 * already been seen is a no-op rather than an error. Errors would be worse: they turn an ordinary
 * duplicate into an outage.
 */

export interface EventRef {
  readonly blockNumber: number;
  readonly logIndex: number;
  readonly txHash: `0x${string}`;
}

export const eventKey = (e: EventRef): string => `${e.blockNumber}:${e.logIndex}:${e.txHash}`;

export type MandateProjectionStatus = "ACTIVE" | "PAUSED" | "REVOKED" | "EXPIRED";

export interface MandateProjection {
  mandateId: Hex32;
  owner: `0x${string}`;
  agent: `0x${string}`;
  nonce: string;
  expiresAt: number;
  status: MandateProjectionStatus;
  /** Cumulative consumption, so the detail page can show usage against the signed ceilings. */
  debtDrawnUsd18: string;
  notionalTradedUsd18: string;
  createdTx: `0x${string}` | null;
  pausedTx: `0x${string}` | null;
  resumedTx: `0x${string}` | null;
  revokedTx: `0x${string}` | null;
  revocationReason: string | null;
  firstSeenBlock: number;
  lastSeenBlock: number;
}

export interface AccountProjection {
  account: `0x${string}`;
  /** Receipts and activity are derived from these rather than re-read from chain per request. */
  events: Array<{ kind: string; ref: EventRef; detail: Record<string, string> }>;
}

export interface IndexerState {
  readonly mandates: ReadonlyMap<string, MandateProjection>;
  readonly accounts: ReadonlyMap<string, AccountProjection>;
  readonly applied: ReadonlySet<string>;
}

export type IndexedEvent =
  | { kind: "MandateRegistered"; ref: EventRef; mandateId: Hex32; owner: `0x${string}`; agent: `0x${string}`; nonce: string; expiresAt: number }
  | { kind: "MandatePaused"; ref: EventRef; mandateId: Hex32 }
  | { kind: "MandateResumed"; ref: EventRef; mandateId: Hex32 }
  | { kind: "MandateRevoked"; ref: EventRef; mandateId: Hex32; reason: string }
  | { kind: "MandateConsumed"; ref: EventRef; mandateId: Hex32; debtDrawnUsd18: string; notionalTradedUsd18: string }
  | { kind: "DelegatedExecution"; ref: EventRef; account: `0x${string}`; agent: `0x${string}`; mandateId: Hex32; action: number; amountUsd18: string };

export class Projections {
  private readonly mandates = new Map<string, MandateProjection>();
  private readonly accounts = new Map<string, AccountProjection>();
  private readonly applied = new Set<string>();

  get state(): IndexerState {
    return { mandates: this.mandates, accounts: this.accounts, applied: this.applied };
  }

  /**
   * Apply one event. Returns false when it had already been applied.
   *
   * Deliberately not a throw. A duplicate is the expected outcome of a restart or an overlapping
   * range, and turning the normal case into an exception means the first reorg takes the service
   * down.
   */
  apply(event: IndexedEvent): boolean {
    const key = eventKey(event.ref);
    if (this.applied.has(key)) return false;
    this.applied.add(key);

    switch (event.kind) {
      case "MandateRegistered": {
        // Registration is the only event that creates a mandate. An update arriving before its
        // registration means the range was walked out of order; the record is created in a state
        // that later events can still correct rather than being dropped.
        const existing = this.mandates.get(event.mandateId);
        this.mandates.set(event.mandateId, {
          mandateId: event.mandateId,
          owner: event.owner,
          agent: event.agent,
          nonce: event.nonce,
          expiresAt: event.expiresAt,
          // A revocation seen first must survive its own registration arriving afterwards.
          status: existing?.status === "REVOKED" ? "REVOKED" : (existing?.status ?? "ACTIVE"),
          debtDrawnUsd18: existing?.debtDrawnUsd18 ?? "0",
          notionalTradedUsd18: existing?.notionalTradedUsd18 ?? "0",
          createdTx: event.ref.txHash,
          pausedTx: existing?.pausedTx ?? null,
          resumedTx: existing?.resumedTx ?? null,
          revokedTx: existing?.revokedTx ?? null,
          revocationReason: existing?.revocationReason ?? null,
          firstSeenBlock: Math.min(existing?.firstSeenBlock ?? event.ref.blockNumber, event.ref.blockNumber),
          lastSeenBlock: Math.max(existing?.lastSeenBlock ?? 0, event.ref.blockNumber),
        });
        return true;
      }

      case "MandatePaused":
        this.patch(event.mandateId, event.ref, (m) => {
          // Revocation is terminal onchain, so it is terminal here. A pause arriving after one is
          // either out of order or a bug, and either way must not un-revoke anything.
          if (m.status !== "REVOKED") m.status = "PAUSED";
          m.pausedTx = event.ref.txHash;
        });
        return true;

      case "MandateResumed":
        this.patch(event.mandateId, event.ref, (m) => {
          if (m.status !== "REVOKED") m.status = "ACTIVE";
          m.resumedTx = event.ref.txHash;
        });
        return true;

      case "MandateRevoked":
        this.patch(event.mandateId, event.ref, (m) => {
          m.status = "REVOKED";
          m.revokedTx = event.ref.txHash;
          m.revocationReason = event.reason;
        });
        return true;

      case "MandateConsumed":
        // Absolute totals from the contract, not deltas to add. Adding would double on replay, and
        // this is precisely the field a duplicate would corrupt invisibly.
        this.patch(event.mandateId, event.ref, (m) => {
          m.debtDrawnUsd18 = event.debtDrawnUsd18;
          m.notionalTradedUsd18 = event.notionalTradedUsd18;
        });
        return true;

      case "DelegatedExecution":
        this.record(event.account, "DelegatedExecution", event.ref, {
          agent: event.agent,
          mandateId: event.mandateId,
          action: String(event.action),
          amountUsd18: event.amountUsd18,
        });
        return true;
    }
  }

  private patch(mandateId: string, ref: EventRef, fn: (m: MandateProjection) => void): void {
    const current = this.mandates.get(mandateId) ?? {
      mandateId: mandateId as Hex32,
      owner: "0x0000000000000000000000000000000000000000",
      agent: "0x0000000000000000000000000000000000000000",
      nonce: "0",
      expiresAt: 0,
      status: "ACTIVE" as MandateProjectionStatus,
      debtDrawnUsd18: "0",
      notionalTradedUsd18: "0",
      createdTx: null,
      pausedTx: null,
      resumedTx: null,
      revokedTx: null,
      revocationReason: null,
      firstSeenBlock: ref.blockNumber,
      lastSeenBlock: ref.blockNumber,
    };
    fn(current);
    current.lastSeenBlock = Math.max(current.lastSeenBlock, ref.blockNumber);
    this.mandates.set(mandateId, current);
  }

  private record(account: string, kind: string, ref: EventRef, detail: Record<string, string>): void {
    const a = this.accounts.get(account) ?? { account: account as `0x${string}`, events: [] };
    a.events.push({ kind, ref, detail });
    a.events.sort((x, y) => x.ref.blockNumber - y.ref.blockNumber || x.ref.logIndex - y.ref.logIndex);
    this.accounts.set(account, a);
  }

  /**
   * Discard everything at or above `blockNumber`, for a reorg.
   *
   * Projections are rebuilt by replaying the range rather than by attempting to invert each event.
   * Inversion requires every handler to have an exact inverse, which is a property nobody maintains
   * — and the first handler that does not is a silent corruption rather than a crash.
   */
  rollbackTo(blockNumber: number): number {
    let dropped = 0;
    for (const key of [...this.applied]) {
      if (Number(key.split(":")[0]) >= blockNumber) {
        this.applied.delete(key);
        dropped++;
      }
    }
    for (const [id, m] of [...this.mandates]) {
      if (m.firstSeenBlock >= blockNumber) this.mandates.delete(id);
    }
    for (const [addr, a] of [...this.accounts]) {
      a.events = a.events.filter((e) => e.ref.blockNumber < blockNumber);
      if (a.events.length === 0) this.accounts.delete(addr);
    }
    return dropped;
  }

  mandate(id: string): MandateProjection | null {
    return this.mandates.get(id) ?? null;
  }

  mandatesFor(owner: string): MandateProjection[] {
    const want = owner.toLowerCase();
    return [...this.mandates.values()]
      .filter((m) => m.owner.toLowerCase() === want || m.agent.toLowerCase() === want)
      .sort((a, b) => b.firstSeenBlock - a.firstSeenBlock);
  }

  /** Status with expiry folded in, since the chain does not emit an event when a mandate lapses. */
  statusAt(id: string, now: number): MandateProjectionStatus | null {
    const m = this.mandates.get(id);
    if (!m) return null;
    if (m.status === "REVOKED") return "REVOKED";
    if (m.expiresAt !== 0 && now >= m.expiresAt) return "EXPIRED";
    return m.status;
  }
}

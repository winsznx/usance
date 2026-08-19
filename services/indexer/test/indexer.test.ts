import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import type { Hex32 } from "@usance/schemas";
import { Projections, eventKey, type IndexedEvent } from "../src/projection";
import { FileCursorStore, InMemoryCursorStore, DeploymentChanged, resume, type Cursor } from "../src/cursor";

const M1 = `0x${"11".repeat(32)}` as Hex32;
const OWNER = `0x${"aa".repeat(20)}` as `0x${string}`;
const AGENT = `0x${"bb".repeat(20)}` as `0x${string}`;

const ref = (blockNumber: number, logIndex = 0) => ({
  blockNumber,
  logIndex,
  txHash: `0x${blockNumber.toString(16).padStart(64, "0")}` as `0x${string}`,
});

const registered = (block: number, expiresAt = 2_000_000_000): IndexedEvent => ({
  kind: "MandateRegistered",
  ref: ref(block),
  mandateId: M1,
  owner: OWNER,
  agent: AGENT,
  nonce: "1",
  expiresAt,
});

describe("projections are idempotent", () => {
  let p: Projections;
  beforeEach(() => {
    p = new Projections();
  });

  it("applying the same event twice changes nothing", () => {
    expect(p.apply(registered(100))).toBe(true);
    // A restart, an overlapping RPC range and a reorg replay all deliver this a second time. All
    // three are ordinary, so a duplicate is a no-op rather than an error — an error would turn the
    // normal case into an outage.
    expect(p.apply(registered(100))).toBe(false);
    expect(p.state.mandates.size).toBe(1);
  });

  it("a replayed consumption cannot double the total", () => {
    p.apply(registered(100));
    const consumed: IndexedEvent = {
      kind: "MandateConsumed",
      ref: ref(101),
      mandateId: M1,
      debtDrawnUsd18: "500",
      notionalTradedUsd18: "0",
    };
    p.apply(consumed);
    p.apply({ ...consumed });
    expect(p.mandate(M1)?.debtDrawnUsd18).toBe("500");
  });

  /**
   * Successive consumptions are absolute totals, not deltas to accumulate.
   *
   * The duplicate case above does not prove this — the identity check catches a replay before the
   * handler runs, so a handler that added instead of assigned would still pass it. What exposes the
   * difference is two *genuine* events, which is what MandateRegistry actually emits: it reports
   * `debtDrawnUsd18` as the running total after each consumption. Accumulating them would report a
   * mandate as having spent 1,300 of its budget when it had spent 800, and the page built on it
   * would tell an owner their agent had drawn far more than it had.
   */
  it("successive consumptions report totals and are not accumulated", () => {
    p.apply(registered(100));
    p.apply({
      kind: "MandateConsumed",
      ref: ref(101),
      mandateId: M1,
      debtDrawnUsd18: "500",
      notionalTradedUsd18: "0",
    });
    p.apply({
      kind: "MandateConsumed",
      ref: ref(102),
      mandateId: M1,
      debtDrawnUsd18: "800",
      notionalTradedUsd18: "120",
    });

    expect(p.mandate(M1)?.debtDrawnUsd18).toBe("800");
    expect(p.mandate(M1)?.notionalTradedUsd18).toBe("120");
  });

  it("distinct logs in one block are distinct events", () => {
    expect(eventKey(ref(100, 0))).not.toBe(eventKey(ref(100, 1)));
  });
});

describe("mandate lifecycle", () => {
  let p: Projections;
  beforeEach(() => {
    p = new Projections();
  });

  it("pause and resume move the status back and forth", () => {
    p.apply(registered(100));
    p.apply({ kind: "MandatePaused", ref: ref(101), mandateId: M1 });
    expect(p.mandate(M1)?.status).toBe("PAUSED");

    p.apply({ kind: "MandateResumed", ref: ref(102), mandateId: M1 });
    expect(p.mandate(M1)?.status).toBe("ACTIVE");
  });

  it("revocation is terminal and cannot be undone by a later pause or resume", () => {
    p.apply(registered(100));
    p.apply({ kind: "MandateRevoked", ref: ref(101), mandateId: M1, reason: "owner changed their mind" });

    // Onchain there is no un-revoke. A resume arriving afterwards is out of order or a bug, and
    // either way must not bring a revoked mandate back.
    p.apply({ kind: "MandateResumed", ref: ref(102), mandateId: M1 });
    p.apply({ kind: "MandatePaused", ref: ref(103), mandateId: M1 });
    expect(p.mandate(M1)?.status).toBe("REVOKED");
  });

  it("a revocation seen before its registration survives the registration arriving late", () => {
    p.apply({ kind: "MandateRevoked", ref: ref(101), mandateId: M1, reason: "out of order" });
    p.apply(registered(100));
    expect(p.mandate(M1)?.status).toBe("REVOKED");
  });

  it("expiry is folded in at read time, because the chain emits no event when one lapses", () => {
    p.apply(registered(100, 1_000));
    expect(p.statusAt(M1, 999)).toBe("ACTIVE");
    expect(p.statusAt(M1, 1_000)).toBe("EXPIRED");
    expect(p.statusAt(M1, 5_000)).toBe("EXPIRED");
  });

  it("a revoked mandate reads as revoked even after it would have expired", () => {
    p.apply(registered(100, 1_000));
    p.apply({ kind: "MandateRevoked", ref: ref(101), mandateId: M1, reason: "r" });
    expect(p.statusAt(M1, 5_000)).toBe("REVOKED");
  });

  it("both owner and agent can find the mandate", () => {
    p.apply(registered(100));
    expect(p.mandatesFor(OWNER).length).toBe(1);
    expect(p.mandatesFor(AGENT).length).toBe(1);
    expect(p.mandatesFor(`0x${"cc".repeat(20)}`).length).toBe(0);
  });
});

describe("reorg handling", () => {
  let p: Projections;
  beforeEach(() => {
    p = new Projections();
  });

  it("rolling back discards events at or above the reorged block", () => {
    p.apply(registered(100));
    p.apply({ kind: "MandatePaused", ref: ref(105), mandateId: M1 });
    expect(p.mandate(M1)?.status).toBe("PAUSED");

    const dropped = p.rollbackTo(105);
    expect(dropped).toBe(1);
    // The mandate itself predates the reorg and survives; only what happened at or after 105 goes.
    expect(p.mandate(M1)).not.toBeNull();
  });

  it("a rolled-back event can be applied again, because rollback clears its identity", () => {
    p.apply(registered(100));
    const paused: IndexedEvent = { kind: "MandatePaused", ref: ref(105), mandateId: M1 };
    p.apply(paused);
    p.rollbackTo(105);

    // Replay after a reorg has to work, or the projection can never be rebuilt.
    expect(p.apply(paused)).toBe(true);
  });

  it("a mandate created inside the reorged range is removed entirely", () => {
    p.apply(registered(200));
    p.rollbackTo(200);
    expect(p.mandate(M1)).toBeNull();
  });

  it("account activity from the reorged range is dropped", () => {
    p.apply({
      kind: "DelegatedExecution",
      ref: ref(300),
      account: OWNER,
      agent: AGENT,
      mandateId: M1,
      action: 1,
      amountUsd18: "50",
    });
    expect(p.state.accounts.get(OWNER)?.events.length).toBe(1);
    p.rollbackTo(300);
    expect(p.state.accounts.get(OWNER)).toBeUndefined();
  });
});

describe("cursor is bound to a deployment", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(resolve(tmpdir(), "usance-idx-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("a fresh cursor starts just before the deployment block", async () => {
    const store = new InMemoryCursorStore();
    const c = await resume(store, 1952, "0xabc", 38_000_000);
    expect(c.height).toBe(37_999_999);
    expect(c.deployedAt).toBe(38_000_000);
  });

  it("survives a restart", async () => {
    const path = resolve(dir, "cursor.json");
    await resume(new FileCursorStore(path), 1952, "0xabc", 100);
    const again = await resume(new FileCursorStore(path), 1952, "0xabc", 100);
    expect(again.height).toBe(99);
  });

  /**
   * The failure this exists to prevent.
   *
   * A block height on its own survives a redeployment and keeps counting, which is exactly how an
   * indexer ends up serving a retired deployment's state as current — the same class of bug that has
   * already shipped three times in this repository through stale artifacts.
   */
  it("refuses to continue across a redeployment", async () => {
    const path = resolve(dir, "cursor.json");
    await resume(new FileCursorStore(path), 1952, "0xold", 100);
    await expect(resume(new FileCursorStore(path), 1952, "0xnew", 500)).rejects.toBeInstanceOf(DeploymentChanged);
  });

  it("refuses to continue across a chain change", async () => {
    const path = resolve(dir, "cursor.json");
    await resume(new FileCursorStore(path), 1952, "0xabc", 100);
    await expect(resume(new FileCursorStore(path), 196, "0xabc", 100)).rejects.toBeInstanceOf(DeploymentChanged);
  });

  it("a failed write leaves the previous cursor intact", async () => {
    const path = resolve(dir, "cursor.json");
    const store = new FileCursorStore(path);
    await store.write({ height: 10, chainId: 1952, deploymentDigest: "0xabc", deployedAt: 1, updatedAt: 0 });

    const circular: Record<string, unknown> = {};
    circular["self"] = circular;
    await expect(store.write(circular as unknown as Cursor)).rejects.toThrow();

    expect((await store.read())?.height).toBe(10);
    expect(readdirSync(dir).filter((f) => f.includes(".tmp-"))).toEqual([]);
  });
});

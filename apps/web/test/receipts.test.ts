import { describe, it, expect } from "vitest";
import { loadReceipts, loadReceipt, sentinelRunFor, delegatedFor } from "../lib/receipts";

/**
 * The Sentinel run belongs on the public proof explorer.
 *
 * These read the real `proof/live-sentinel.json` off disk (the loader resolves `../../proof` from
 * the web package, which is the repo root). The point of the wiring is that the autonomous run
 * appears in `/proof` as a first-class member of the receipt family — not that it looks plausible,
 * but that every assertion it makes still cites a transaction the chain confirmed.
 */

const FULL_TX_HASH = /^0x[0-9a-fA-F]{64}$/;
const sentinelReceipt = () => loadReceipts().find((r) => r.kind.startsWith("SENTINEL_RUN_"));

describe("the live Sentinel run on /proof", () => {
  it("is loaded as an executed, confirmed receipt", () => {
    const r = sentinelReceipt();
    expect(r, "the LIVE_SENTINEL_AUTONOMOUS_RUN record must project to a receipt").toBeDefined();
    expect(r!.kind).toBe("SENTINEL_RUN_EXECUTED");
    expect(r!.status).toBe("CONFIRMED");
    expect(r!.chainId).toBe(1952);
  });

  it("is confirmed only because it cites a successful transaction", () => {
    // The schema refuses a CONFIRMED receipt with no successful tx — so this is the honesty guard,
    // not decoration. A run that never mined would carry REJECTED_BY_POLICY instead.
    const r = sentinelReceipt()!;
    expect(r.transactions.length).toBeGreaterThan(0);
    expect(r.transactions.some((t) => t.status === "success")).toBe(true);
    for (const t of r.transactions) expect(t.txHash).toMatch(FULL_TX_HASH);
  });

  it("orders its transactions by block, mandate-registration first and the repay last", () => {
    const blocks = sentinelReceipt()!.transactions.map((t) => t.blockNumber ?? 0);
    expect(blocks).toEqual([...blocks].sort((a, b) => a - b));
    const contracts = sentinelReceipt()!.transactions.map((t) => t.contract);
    expect(contracts[0]).toBe("MandateRegistry");
    expect(contracts.at(-1)).toBe("DelegationGateway");
  });

  it("is reachable by its derived id, and that id round-trips to the run facts", () => {
    const r = sentinelReceipt()!;
    expect(r.receiptId).toMatch(/^sentinel-run-executed-1952-/);
    expect(loadReceipt(r.receiptId)?.receiptId).toBe(r.receiptId);

    const facts = sentinelRunFor(r.receiptId);
    expect(facts, "the explainer facts must be reachable by the same id the receipt carries").not.toBeNull();
    expect(facts!.executed).toBe(true);
    expect(facts!.action).toBe("REPAY");
    expect(facts!.riskDirection).toBe("REDUCING");
  });

  it("records a real debt reduction — the agent lowered risk, it did not add any", () => {
    const facts = sentinelRunFor(sentinelReceipt()!.receiptId)!;
    expect(facts.debtBefore).not.toBeNull();
    expect(facts.debtAfter).not.toBeNull();
    expect(BigInt(facts.debtBefore!)).toBeGreaterThan(BigInt(facts.debtAfter!));
  });

  it("returns nothing for an id that is not a Sentinel run", () => {
    expect(sentinelRunFor("passport-committed-1952-deadbeefdeadbeef")).toBeNull();
    expect(sentinelRunFor("not-a-real-id")).toBeNull();
  });
});

/**
 * The delegated-authority proof belongs on /proof too.
 *
 * This is the mandate feature's flagship: a bounded agent key acted within a signed mandate, was
 * refused outside it, and was refused again after revocation. The receipt is CONFIRMED because it
 * cites successful transactions, and the two refusals ride alongside as reverted rows — the point of
 * the whole proof is that they reverted on chain rather than being politely discouraged.
 */
const delegatedReceipt = () => loadReceipts().find((r) => r.kind === "MANDATE_DELEGATED");

describe("the live delegated-authority run on /proof", () => {
  it("is loaded as a confirmed mandate-delegated receipt", () => {
    const r = delegatedReceipt();
    expect(r, "the LIVE_DELEGATED_AUTHORITY record must project to a receipt").toBeDefined();
    expect(r!.status).toBe("CONFIRMED");
    expect(r!.chainId).toBe(1952);
  });

  it("cites both a successful delegated action and the on-chain refusals", () => {
    const r = delegatedReceipt()!;
    expect(r.transactions.some((t) => t.status === "success")).toBe(true);
    // The withdrawal attempt and the post-revocation retry both reverted — the refusals are the proof.
    expect(r.transactions.filter((t) => t.status === "reverted").length).toBeGreaterThanOrEqual(2);
    const contracts = new Set(r.transactions.map((t) => t.contract));
    expect(contracts.has("MandateRegistry")).toBe(true);
    expect(contracts.has("DelegationGateway")).toBe(true);
  });

  it("orders transactions by block", () => {
    const blocks = delegatedReceipt()!.transactions.map((t) => t.blockNumber ?? 0);
    expect(blocks).toEqual([...blocks].sort((a, b) => a - b));
  });

  it("round-trips to the bounded-authority facts: repaid within scope, refused outside, revocation terminal", () => {
    const r = delegatedReceipt()!;
    expect(r.receiptId).toMatch(/^mandate-delegated-1952-/);
    expect(loadReceipt(r.receiptId)?.receiptId).toBe(r.receiptId);

    const facts = delegatedFor(r.receiptId);
    expect(facts, "the explainer facts must be reachable by the same id the receipt carries").not.toBeNull();
    expect(facts!.mandateActions).toContain("REPAY");
    expect(facts!.withdrawalRefused).toBe(true);
    expect(facts!.revoked).toBe(true);
    expect(facts!.postRevocationRefused).toBe(true);
    expect(BigInt(facts!.repayDebtBefore!)).toBeGreaterThan(BigInt(facts!.repayDebtAfter!));
  });

  it("returns nothing for an id that is not a delegated-authority run", () => {
    expect(delegatedFor("sentinel-run-executed-1952-b037f143ffe9b39f")).toBeNull();
    expect(delegatedFor("not-a-real-id")).toBeNull();
  });
});

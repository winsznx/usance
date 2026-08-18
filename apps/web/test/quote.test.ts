import { describe, it, expect } from "vitest";
import { projectStatus, quoteIsValid, quoteInvalidReason, STATUS_ORDER, QUOTE_TTL_SECONDS, type Quote } from "../lib/quote";

const quote = (over: Partial<Quote> = {}): Quote =>
  ({
    chainId: 1952,
    account: "0x0000000000000000000000000000000000000001",
    assetId: null,
    action: "BORROW",
    passportVersion: 1,
    riskEpoch: 7n,
    oracleUpdatedAt: 1000,
    oracleFreshness: { configured: true, maxAgeSeconds: 172_800, ageSeconds: 10, stale: false },
    amountUsd: 0n,
    recognisedBefore: 0n,
    recognisedAfter: 0n,
    debtBefore: 0n,
    debtAfter: 0n,
    availableBorrowBefore: 0n,
    availableBorrowAfter: 0n,
    statusBefore: "NORMAL",
    statusAfter: "NORMAL",
    maintenanceLimit: 0n,
    liquidationLimit: 0n,
    protocolLiquidity: 0n,
    limitedByLiquidity: false,
    walletBalance: 0n,
    allowance: 0n,
    createdAt: 1_000,
    expiresAt: 1_000 + QUOTE_TTL_SECONDS,
    ...over,
  }) as Quote;

describe("quote validity is bound to the risk epoch", () => {
  it("a quote from the current epoch inside its window is valid", () => {
    expect(quoteIsValid(quote(), 7n, 1_010)).toBe(true);
  });

  it("a quote is dead the moment policy moves, whatever the clock says", () => {
    // The epoch check comes first on purpose: a quote produced one second ago under superseded
    // rules is more dangerous than one produced a minute ago under current rules.
    expect(quoteIsValid(quote(), 8n, 1_001)).toBe(false);
    expect(quoteInvalidReason(quote(), 8n, 1_001)).toBe(
      "Risk conditions changed. Review the updated values before signing.",
    );
  });

  it("a quote expires on its own even when policy has not moved", () => {
    expect(quoteIsValid(quote(), 7n, 1_100)).toBe(false);
    expect(quoteInvalidReason(quote(), 7n, 1_100)).toContain("expired");
  });

  it("a valid quote has no reason to be refused", () => {
    expect(quoteInvalidReason(quote(), 7n, 1_010)).toBeNull();
  });
});

describe("projected status", () => {
  const limits = { borrow: 800n, maintenance: 900n, liquidation: 950n };
  const p = (debt: bigint, floor: Parameters<typeof projectStatus>[4] = "NORMAL") =>
    projectStatus(debt, limits.borrow, limits.maintenance, limits.liquidation, floor);

  it("walks the ladder in order", () => {
    expect(p(0n)).toBe("NORMAL");
    expect(p(800n)).toBe("NORMAL");
    expect(p(850n)).toBe("NO_NEW_RISK");
    expect(p(920n)).toBe("REDUCE_ONLY");
    expect(p(1_000n)).toBe("MARGIN_CALL");
  });

  it("never shows a healthier state than the chain reports", () => {
    // A gate the projection cannot see — a stale oracle, a suspended asset, a paused feed — is
    // holding the account where it is. A preview that showed "Healthy" because the arithmetic
    // worked would promise a transaction the contract is about to refuse.
    expect(p(0n, "NO_NEW_RISK")).toBe("NO_NEW_RISK");
    expect(p(100n, "REDUCE_ONLY")).toBe("REDUCE_ONLY");
    expect(p(0n, "LIQUIDATING")).toBe("LIQUIDATING");
  });

  it("still worsens past a floor when the numbers say so", () => {
    expect(p(1_000n, "NO_NEW_RISK")).toBe("MARGIN_CALL");
  });

  it("the status order matches the protocol's total order", () => {
    expect(STATUS_ORDER).toEqual([
      "NORMAL", "NO_NEW_RISK", "REDUCE_ONLY", "MARGIN_CALL", "LIQUIDATING", "SETTLED", "BAD_DEBT",
    ]);
  });
});

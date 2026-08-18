import { describe, it, expect } from "vitest";
import { shortfall, repairByRepaying, repairByAddingCollateral, type AccountView } from "../components/account-state";

const account = (over: Partial<AccountView> = {}): AccountView => ({
  status: "MARGIN_CALL",
  recognisedUsd: 1_000n,
  debtUsd: 950n,
  borrowLimitUsd: 850n,
  maintenanceLimitUsd: 900n,
  liquidationLimitUsd: 930n,
  epoch: 1n,
  ...over,
});

describe("margin call repair figures", () => {
  it("the shortfall is debt above the maintenance requirement", () => {
    expect(shortfall(account())).toBe(50n);
  });

  it("a healthy account has no shortfall", () => {
    expect(shortfall(account({ debtUsd: 100n }))).toBe(0n);
  });

  it("repaying closes the gap dollar for dollar", () => {
    // Repayment reduces debt without touching the limit.
    expect(repairByRepaying(account())).toBe(50n);
  });

  it("adding collateral takes more than the shortfall", () => {
    // Usance lends against 90% of recognised value here, so closing 50 of gap needs ~55.6 of
    // recognised collateral. A UI that quoted the same number for both would send users to the
    // more expensive cure believing it was equivalent.
    const needed = repairByAddingCollateral(account());
    expect(needed).toBeGreaterThan(shortfall(account()));
    expect(needed).toBe(55n);
  });

  it("the collateral ratio is read from the account, not assumed", () => {
    // A different maintenance ratio produces a different answer, which is the point: with several
    // collateral assets there is no single configured number to hard-code.
    const half = account({ maintenanceLimitUsd: 500n, debtUsd: 550n, recognisedUsd: 1_000n });
    expect(repairByAddingCollateral(half)).toBe(100n);
  });

  it("an account with no collateral does not divide by zero", () => {
    expect(repairByAddingCollateral(account({ recognisedUsd: 0n }))).toBe(0n);
  });
});

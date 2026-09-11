import { describe, expect, it } from "vitest";
import { GasPolicyError, selectHederaAtsGas } from "../lib/hedera-ats-gas-policy";

describe("selectHederaAtsGas", () => {
  it("uses the evidence-backed floor when the raw estimate is below it (the live abortCommittedSubstitution failure)", () => {
    const selection = selectHederaAtsGas("abortCommittedSubstitution", 462_086n, 150_000_000n);
    expect(selection.selectedGas).toBe(900_000n);
    expect(selection.estimatorExceededFloor).toBe(false);
  });

  it("still uses the floor when the estimator has no output at all", () => {
    const selection = selectHederaAtsGas("releaseOld", null, 150_000_000n);
    expect(selection.selectedGas).toBe(900_000n);
    expect(selection.estimatedGas).toBeNull();
  });

  it("flags when the estimator output exceeds the floor, for drift monitoring, without lowering or raising the selected gas", () => {
    const selection = selectHederaAtsGas("commitReplacement", 1_200_000n, 150_000_000n);
    expect(selection.selectedGas).toBe(1_150_000n);
    expect(selection.estimatorExceededFloor).toBe(true);
  });

  it("selects the same explicit gas for every call to the same method (simulation and send must match)", () => {
    const a = selectHederaAtsGas("releaseOld", 500_000n, 150_000_000n);
    const b = selectHederaAtsGas("releaseOld", 900_000n, 150_000_000n);
    expect(a.selectedGas).toBe(b.selectedGas);
  });

  it("rejects a floor that meets or exceeds the current block gas limit rather than silently capping it", () => {
    expect(() => selectHederaAtsGas("commitReplacement", null, 1_000_000n)).toThrow(GasPolicyError);
  });
});

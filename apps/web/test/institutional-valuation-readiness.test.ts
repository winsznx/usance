import { afterEach, describe, expect, it, vi } from "vitest";

const NOW = 1_800_000_000;
const SETTLEMENT_ASSET = "0x1e3e133aa78601754c9ebfb0e45b607065febdc6a224c1c050e56d5bba7c78ef";
const REPLACEMENT_ASSET = "0x7ce7ded85520ee753b041e55c19a672ec3dc2ab28cb812d5d1f30107bfc1a422";
const SETTLEMENT_MAX_AGE = 172_800; // from the deployment manifest fixture below
const REPLACEMENT_MAX_AGE = 172_800;

type PriceFixture = { settlement: { price: bigint; updatedAt: bigint }; replacement: { price: bigint; updatedAt: bigint } };

function mockChain({ settlement, replacement }: PriceFixture) {
  vi.doMock("viem", async () => {
    const actual = await vi.importActual<typeof import("viem")>("viem");
    return {
      ...actual,
      createPublicClient: () => ({
        readContract: async ({ functionName, args }: { functionName: string; args?: unknown[] }) => {
          if (functionName === "getPrice") {
            const assetId = args?.[0];
            if (assetId === SETTLEMENT_ASSET) return [settlement.price, settlement.updatedAt];
            if (assetId === REPLACEMENT_ASSET) return [replacement.price, replacement.updatedAt];
            throw new Error("unexpected assetId");
          }
          if (functionName === "getAsset") return { riskPolicyId: "0xpolicy" };
          if (functionName === "getParams") return { maxOracleAge: BigInt(REPLACEMENT_MAX_AGE) };
          throw new Error(`unexpected functionName ${functionName}`);
        },
      }),
    };
  });
}

afterEach(() => {
  vi.resetModules();
  vi.doUnmock("viem");
  vi.useRealTimers();
});

describe("readValuationReadiness (regression coverage for the two live release blockers)", () => {
  it("A. identifies a stale settlement price while a fresh replacement price stays READY", async () => {
    vi.useFakeTimers().setSystemTime(NOW * 1000);
    mockChain({
      settlement: { price: 1_000000000000000000n, updatedAt: BigInt(NOW - SETTLEMENT_MAX_AGE - 1000) },
      replacement: { price: 1_000000000000000000n, updatedAt: BigInt(NOW - 10) },
    });
    const { readValuationReadiness } = await import("../lib/institutional-valuation-readiness");
    const r = await readValuationReadiness(REPLACEMENT_ASSET as `0x${string}`);
    expect(r.settlementPrice.status).toBe("STALE");
    expect(r.replacementCollateralPrice.status).toBe("READY");
    expect(r.allInputsReady).toBe(false);
  });

  it("B. identifies a stale replacement price while settlement stays READY — no false READY", async () => {
    vi.useFakeTimers().setSystemTime(NOW * 1000);
    mockChain({
      settlement: { price: 1_000000000000000000n, updatedAt: BigInt(NOW - 10) },
      replacement: { price: 1_000000000000000000n, updatedAt: BigInt(NOW - REPLACEMENT_MAX_AGE - 1000) },
    });
    const { readValuationReadiness } = await import("../lib/institutional-valuation-readiness");
    const r = await readValuationReadiness(REPLACEMENT_ASSET as `0x${string}`);
    expect(r.settlementPrice.status).toBe("READY");
    expect(r.replacementCollateralPrice.status).toBe("STALE");
    expect(r.allInputsReady).toBe(false);
  });

  it("C. both fresh: preparation may proceed, but this is never an authoritative release-eligibility claim", async () => {
    vi.useFakeTimers().setSystemTime(NOW * 1000);
    mockChain({
      settlement: { price: 1_000000000000000000n, updatedAt: BigInt(NOW - 10) },
      replacement: { price: 1_000000000000000000n, updatedAt: BigInt(NOW - 10) },
    });
    const { readValuationReadiness } = await import("../lib/institutional-valuation-readiness");
    const r = await readValuationReadiness(REPLACEMENT_ASSET as `0x${string}`);
    expect(r.allInputsReady).toBe(true);
    // The type has no "eligible for release" field at all — only READY/STALE/UNAVAILABLE/UNKNOWN
    // per input, plus the aggregate `allInputsReady` preparation signal.
    expect(Object.keys(r)).toEqual(["observedAt", "settlementPrice", "replacementCollateralPrice", "allInputsReady"]);
  });

  it("treats a zero price as UNAVAILABLE, not stale", async () => {
    vi.useFakeTimers().setSystemTime(NOW * 1000);
    mockChain({
      settlement: { price: 0n, updatedAt: 0n },
      replacement: { price: 1_000000000000000000n, updatedAt: BigInt(NOW - 10) },
    });
    const { readValuationReadiness } = await import("../lib/institutional-valuation-readiness");
    const r = await readValuationReadiness(REPLACEMENT_ASSET as `0x${string}`);
    expect(r.settlementPrice.status).toBe("UNAVAILABLE");
  });
});

import { describe, expect, it } from "vitest";
import { sentinelRunReceipt } from "../src/index";
import { buildInstance, config, deterioratedChain, makeEngine, mandateId, owner, trigger, usd } from "./helpers";

describe("sentinel run receipt", () => {
  it("an executed run projects to a CONFIRMED receipt citing a successful transaction", async () => {
    const chain = deterioratedChain();
    const { engine } = makeEngine(chain, chain.gateway());
    const instance = buildInstance();
    const { run } = await engine.processTrigger(instance, config, trigger, 1);

    const receipt = sentinelRunReceipt(run, instance);
    expect(receipt?.kind).toBe("SENTINEL_RUN_EXECUTED");
    expect(receipt?.status).toBe("CONFIRMED");
    expect(receipt?.transactions.some((t) => t.status === "success")).toBe(true);
    expect(receipt?.accountId).toBe(owner);
  });

  it("a blocked run projects to a REJECTED_BY_POLICY receipt with no transaction", async () => {
    const chain = deterioratedChain();
    chain.revokeMandate(mandateId);
    const { engine } = makeEngine(chain, chain.gateway());
    const instance = buildInstance();
    const { run } = await engine.processTrigger(instance, config, trigger, 1);

    const receipt = sentinelRunReceipt(run, instance);
    expect(receipt?.kind).toBe("SENTINEL_RUN_BLOCKED");
    expect(receipt?.status).toBe("REJECTED_BY_POLICY");
    expect(receipt?.transactions).toHaveLength(0);
  });

  it("writes no receipt for a no-action run (no financial event to record)", async () => {
    const chain = deterioratedChain();
    // Healthy: buffer 6000bps, well above the 1500 action threshold.
    chain.setAccount(owner, {
      recognisedUsd18: usd(1000),
      debtUsd18: usd(400),
      borrowLimitUsd18: usd(800),
      maintenanceLimitUsd18: usd(1000),
    });
    const { engine } = makeEngine(chain, chain.gateway());
    const instance = buildInstance();
    const { run } = await engine.processTrigger(instance, config, trigger, 1);

    expect(run.state).toBe("NO_ACTION_REQUIRED");
    expect(sentinelRunReceipt(run, instance)).toBeNull();
  });
});

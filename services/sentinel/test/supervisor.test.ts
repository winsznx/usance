import { describe, expect, it } from "vitest";
import { instanceIdFor } from "@usance/schemas";
import { SentinelSupervisor, type DelegationGatewayClient } from "../src/index";
import { buildInstance, config, deterioratedChain, makeEngine, owner, trigger } from "./helpers";

describe("sentinel supervisor", () => {
  it("processes highest priority first, and a yield instance yields to safety on the same account", async () => {
    const chain = deterioratedChain();
    const { engine, store } = makeEngine(chain, chain.gateway());
    const supervisor = new SentinelSupervisor(engine, store);

    const safety = buildInstance({ instanceId: instanceIdFor(owner, 0n), priorityClass: "P1_SAFETY_MAINTENANCE" });
    const yielding = buildInstance({ instanceId: instanceIdFor(owner, 1n), priorityClass: "P4_YIELD_OPPORTUNISTIC" });

    // Enqueue yield first to prove ordering is by priority, not arrival.
    supervisor.enqueue({ instance: yielding, config, trigger, triggerVersion: 1 });
    supervisor.enqueue({ instance: safety, config, trigger, triggerVersion: 1 });

    const results = await supervisor.drain();
    const state = new Map(results.map((r) => [r.run.instanceId, r.run.state]));

    expect(state.get(safety.instanceId)).toBe("COMPLETE");
    expect(state.get(yielding.instanceId)).toBe("BLOCKED_BY_POLICY");
  });

  it("recovers an unknown in-flight run by reconciling against the chain (crash-resume)", async () => {
    const chain = deterioratedChain();
    // A gateway that lands the tx but loses the response.
    const lossy: DelegationGatewayClient = {
      execute: async (req) => ({ ...(await chain.gateway().execute(req)), outcome: "unknown" }),
    };
    const { engine, store } = makeEngine(chain, lossy);
    const supervisor = new SentinelSupervisor(engine, store);
    const instance = buildInstance();

    const { run } = await engine.processTrigger(instance, config, trigger, 1);
    expect(run.state).toBe("EXECUTION_UNKNOWN");

    const recovered = await supervisor.recover((id) => (id === instance.instanceId ? instance : undefined));
    expect(recovered[0]?.state).toBe("COMPLETE");
  });
});

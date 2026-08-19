import { createPublicClient, http, type Address } from "viem";
import { activeChain, loadDeployment } from "./deployments";

/**
 * A mandate, read from the registry.
 *
 * Read live rather than from the indexer's projection. The question this answers is "what can this
 * agent do to me right now", and a few-blocks-old answer is the wrong answer at exactly the moment
 * somebody is trying to revoke. The indexer is for lists and history; this is for the decision.
 */

/** Mirrors MandateRegistry's actual getters. Structs come back as tuples. */
const REGISTRY_ABI = [
  {
    name: "getMandate",
    type: "function",
    stateMutability: "view",
    inputs: [{ type: "bytes32" }],
    outputs: [{
      type: "tuple",
      components: [
        { name: "owner", type: "address" }, { name: "agent", type: "address" },
        { name: "accountId", type: "bytes32" }, { name: "validFrom", type: "uint64" },
        { name: "expiresAt", type: "uint64" }, { name: "maxDebtUsd", type: "uint256" },
        { name: "maxTradeNotionalUsd", type: "uint256" },
        { name: "maxEffectiveLeverageBps", type: "uint16" }, { name: "maxSlippageBps", type: "uint16" },
        { name: "allowedActions", type: "uint16" }, { name: "requiredPassportFreshness", type: "uint64" },
        { name: "allowedAssetsRoot", type: "bytes32" }, { name: "allowedVenuesRoot", type: "bytes32" },
        { name: "nonce", type: "uint256" },
      ],
    }],
  },
  {
    name: "getState",
    type: "function",
    stateMutability: "view",
    inputs: [{ type: "bytes32" }],
    outputs: [{
      type: "tuple",
      components: [
        { name: "exists", type: "bool" }, { name: "revoked", type: "bool" },
        { name: "ownerPaused", type: "bool" }, { name: "guardianPaused", type: "bool" },
        { name: "debtDrawnUsd18", type: "uint256" }, { name: "notionalTradedUsd18", type: "uint256" },
      ],
    }],
  },
  { name: "domainSeparator", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "bytes32" }] },
] as const;

export interface MandateDetail {
  mandateId: string;
  owner: string;
  agent: string;
  nonce: string;
  validFrom: number;
  expiresAt: number;
  maxDebtUsd: string;
  maxTradeNotionalUsd: string;
  maxSlippageBps: number;
  allowedActions: number;
  debtDrawnUsd18: string;
  notionalTradedUsd18: string;
  status: "ACTIVE" | "PAUSED" | "REVOKED" | "EXPIRED";
  registry: string;
  domainSeparator: string;
}

const usd = (v: bigint): string => (Number(v) / 1e18).toLocaleString(undefined, { maximumFractionDigits: 2 });

/**
 * Three outcomes, not two.
 *
 * "No such mandate" and "the registry could not be read" are different facts and a user needs to
 * know which one they are looking at. Collapsing them tells somebody their mandate does not exist
 * because an RPC endpoint was briefly unavailable — and the natural reaction to that is to sign
 * another one.
 */
export type MandateLookup =
  | { outcome: "FOUND"; mandate: MandateDetail }
  | { outcome: "NOT_FOUND" }
  | { outcome: "UNREADABLE"; reason: string };

export async function loadMandate(mandateId: string): Promise<MandateLookup> {
  if (!/^0x[0-9a-fA-F]{64}$/.test(mandateId)) return { outcome: "NOT_FOUND" };

  const chain = activeChain();
  const deployment = await loadDeployment(chain.id);
  const registry = deployment?.contracts?.mandateRegistry;
  if (!registry) return { outcome: "UNREADABLE", reason: "No MandateRegistry is deployed on this network." };

  const c = createPublicClient({ transport: http(chain.rpcUrl, { retryCount: 3, retryDelay: 1200, timeout: 30_000 }) });
  const at = { address: registry as Address, abi: REGISTRY_ABI } as const;

  try {
    const [m, state, domainSeparator] = await Promise.all([
      c.readContract({ ...at, functionName: "getMandate", args: [mandateId as `0x${string}`] }),
      c.readContract({ ...at, functionName: "getState", args: [mandateId as `0x${string}`] }),
      c.readContract({ ...at, functionName: "domainSeparator" }),
    ]);

    // A mandate that was never registered reads as a zero struct rather than reverting. `exists` is
    // the field that distinguishes the two; without it the page renders a wall of zeroes for an id
    // nobody ever signed.
    if (!state.exists) return { outcome: "NOT_FOUND" };

    const now = Math.floor(Date.now() / 1000);

    // Expiry is folded in here because the registry emits no event when a mandate lapses. A status
    // derived only from events would show an expired mandate as active forever.
    //
    // Either pause flag suspends it: an owner pause and a guardian pause have different provenance
    // and the same effect on what the agent can do, which is what this page is about.
    const status = state.revoked
      ? "REVOKED"
      : now >= Number(m.expiresAt)
        ? "EXPIRED"
        : state.ownerPaused || state.guardianPaused
          ? "PAUSED"
          : "ACTIVE";

    return {
      outcome: "FOUND",
      mandate: {
      mandateId,
      owner: m.owner,
      agent: m.agent,
      nonce: m.nonce.toString(),
      validFrom: Number(m.validFrom),
      expiresAt: Number(m.expiresAt),
      maxDebtUsd: usd(m.maxDebtUsd),
      maxTradeNotionalUsd: usd(m.maxTradeNotionalUsd),
      maxSlippageBps: Number(m.maxSlippageBps),
      allowedActions: Number(m.allowedActions),
      debtDrawnUsd18: usd(state.debtDrawnUsd18),
      notionalTradedUsd18: usd(state.notionalTradedUsd18),
      status,
      registry,
      domainSeparator,
      },
    };
  } catch (e) {
    // Never a 500. A page that cannot reach the chain still has something true to say, and crashing
    // is the one response that tells the reader nothing at all.
    return {
      outcome: "UNREADABLE",
      reason: (e as Error).message || "The registry could not be reached.",
    };
  }
}

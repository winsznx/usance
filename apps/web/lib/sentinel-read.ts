import { createPublicClient, http, type Address } from "viem";
import { instanceIdFor } from "@usance/schemas";
import { activeChain, loadDeployment } from "./deployments";

/**
 * A Sentinel instance, read from the registry.
 *
 * Read live, for the same reason a mandate is: the question "is this Sentinel still armed, and what
 * does it point at" must be answered from the chain at the moment someone is deciding to pause or
 * revoke, not from a projection that is a few blocks behind exactly when it matters.
 */

const INSTANCE_STATUS = ["REGISTERED", "PAUSED", "REVOKED"] as const;

/** Mirrors `SentinelInstanceRegistry` getters + the id derivation. Structs come back as tuples. */
export const SENTINEL_INSTANCE_ABI = [
  {
    name: "getInstance",
    type: "function",
    stateMutability: "view",
    inputs: [{ type: "bytes32" }],
    outputs: [{
      type: "tuple",
      components: [
        { name: "owner", type: "address" }, { name: "account", type: "address" },
        { name: "templateId", type: "bytes32" }, { name: "templateVersion", type: "uint64" },
        { name: "manifestHash", type: "bytes32" }, { name: "agentExecutor", type: "address" },
        { name: "mandateId", type: "bytes32" }, { name: "configHash", type: "bytes32" },
        { name: "status", type: "uint8" }, { name: "pausedByGuardian", type: "bool" },
        { name: "createdAt", type: "uint64" },
      ],
    }],
  },
  { name: "nonce", type: "function", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
  { name: "instanceIdFor", type: "function", stateMutability: "pure", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [{ type: "bytes32" }] },
] as const;

/** Write surface + custom errors, so `decodeProtocolError` can name a refusal. */
export const SENTINEL_INSTANCE_WRITE_ABI = [
  {
    name: "registerInstance",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "templateId", type: "bytes32" }, { name: "templateVersion", type: "uint64" },
      { name: "manifestHash", type: "bytes32" }, { name: "agentExecutor", type: "address" },
      { name: "mandateId", type: "bytes32" }, { name: "configHash", type: "bytes32" },
    ],
    outputs: [{ type: "bytes32" }],
  },
  { name: "pause", type: "function", stateMutability: "nonpayable", inputs: [{ name: "instanceId", type: "bytes32" }], outputs: [] },
  { name: "resume", type: "function", stateMutability: "nonpayable", inputs: [{ name: "instanceId", type: "bytes32" }], outputs: [] },
  { name: "revoke", type: "function", stateMutability: "nonpayable", inputs: [{ name: "instanceId", type: "bytes32" }], outputs: [] },
  { type: "error", name: "TemplateDisabled", inputs: [] },
  { type: "error", name: "ManifestMismatch", inputs: [{ type: "bytes32" }, { type: "bytes32" }] },
  { type: "error", name: "ZeroExecutorOrMandate", inputs: [] },
  { type: "error", name: "UnknownInstance", inputs: [{ type: "bytes32" }] },
  { type: "error", name: "NotOwnerOrGuardian", inputs: [] },
  { type: "error", name: "InstanceIsRevoked", inputs: [] },
  { type: "error", name: "NotRegistered", inputs: [] },
  { type: "error", name: "NotPaused", inputs: [] },
  { type: "error", name: "OwnerCannotLiftGuardianPause", inputs: [] },
  { type: "error", name: "NotOwnerOrGovernance", inputs: [] },
] as const;

export interface InstanceDetail {
  instanceId: string;
  owner: string;
  account: string;
  templateId: string;
  templateVersion: number;
  manifestHash: string;
  agentExecutor: string;
  mandateId: string;
  configHash: string;
  status: (typeof INSTANCE_STATUS)[number];
  pausedByGuardian: boolean;
  createdAt: number;
  registry: string;
}

export type InstanceLookup =
  | { outcome: "FOUND"; instance: InstanceDetail }
  | { outcome: "NOT_FOUND" }
  | { outcome: "UNREADABLE"; reason: string };

function client() {
  const chain = activeChain();
  return createPublicClient({ transport: http(chain.rpcUrl, { retryCount: 3, retryDelay: 1200, timeout: 30_000 }) });
}

async function registryAddress(): Promise<string | null> {
  const chain = activeChain();
  const deployment = await loadDeployment(chain.id);
  return deployment?.contracts?.sentinelInstanceRegistry ?? null;
}

export async function loadInstance(instanceId: string): Promise<InstanceLookup> {
  if (!/^0x[0-9a-fA-F]{64}$/.test(instanceId)) return { outcome: "NOT_FOUND" };
  const registry = await registryAddress();
  if (!registry) return { outcome: "UNREADABLE", reason: "No SentinelInstanceRegistry is deployed on this network." };

  try {
    const inst = await client().readContract({
      address: registry as Address,
      abi: SENTINEL_INSTANCE_ABI,
      functionName: "getInstance",
      args: [instanceId as `0x${string}`],
    });
    return { outcome: "FOUND", instance: project(instanceId, inst, registry) };
  } catch (e) {
    // getInstance reverts with UnknownInstance for an id nobody registered; that is NOT_FOUND, not
    // an RPC failure. Any other revert is genuinely unreadable and must not read as "does not exist".
    if (String((e as Error).message ?? "").includes("UnknownInstance")) return { outcome: "NOT_FOUND" };
    return { outcome: "UNREADABLE", reason: (e as Error).message || "The registry could not be reached." };
  }
}

/** Every instance an owner has registered, newest first. */
export async function listInstances(owner: `0x${string}`): Promise<{ outcome: "OK"; instances: InstanceDetail[] } | { outcome: "UNREADABLE"; reason: string }> {
  const registry = await registryAddress();
  if (!registry) return { outcome: "UNREADABLE", reason: "No SentinelInstanceRegistry is deployed on this network." };
  const c = client();
  try {
    const count = (await c.readContract({ address: registry as Address, abi: SENTINEL_INSTANCE_ABI, functionName: "nonce", args: [owner] })) as bigint;
    const out: InstanceDetail[] = [];
    for (let n = 0n; n < count; n++) {
      const id = instanceIdFor(owner, n);
      try {
        const inst = await c.readContract({ address: registry as Address, abi: SENTINEL_INSTANCE_ABI, functionName: "getInstance", args: [id] });
        out.push(project(id, inst, registry));
      } catch {
        // A single unreadable instance does not sink the list.
      }
    }
    return { outcome: "OK", instances: out.reverse() };
  } catch (e) {
    return { outcome: "UNREADABLE", reason: (e as Error).message || "The registry could not be reached." };
  }
}

type RawInstance = {
  owner: string; account: string; templateId: string; templateVersion: bigint; manifestHash: string;
  agentExecutor: string; mandateId: string; configHash: string; status: number; pausedByGuardian: boolean; createdAt: bigint;
};

function project(instanceId: string, i: RawInstance, registry: string): InstanceDetail {
  return {
    instanceId,
    owner: i.owner,
    account: i.account,
    templateId: i.templateId,
    templateVersion: Number(i.templateVersion),
    manifestHash: i.manifestHash,
    agentExecutor: i.agentExecutor,
    mandateId: i.mandateId,
    configHash: i.configHash,
    status: INSTANCE_STATUS[i.status] ?? "REGISTERED",
    pausedByGuardian: i.pausedByGuardian,
    createdAt: Number(i.createdAt),
    registry,
  };
}

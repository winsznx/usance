import { NextResponse } from "next/server";
import { createPublicClient, http } from "viem";
import { activeChain, loadDeployment } from "@/lib/deployments";

/**
 * Readiness. Answers a harder question: can Usance safely quote or submit a financial action?
 *
 * If the answer is no, this must say no. A readiness probe that reports ready while the manifest is
 * missing or the chain is unreachable sends users to a form that will produce a number nobody can
 * honour — and the failure surfaces as a reverted transaction they paid for rather than as a page
 * that told them to come back later.
 *
 * Each dependency is reported individually. "Not ready" with no reason is an alert nobody can act
 * on at three in the morning.
 */

export const dynamic = "force-dynamic";

interface Check {
  name: string;
  ok: boolean;
  detail: string;
  /** False when the system can still serve reads without it. */
  required: boolean;
}

export async function GET() {
  const chain = activeChain();
  const checks: Check[] = [];

  const deployment = await loadDeployment(chain.id).catch(() => null);
  checks.push({
    name: "deployment-manifest",
    ok: deployment !== null,
    detail: deployment ? `chain ${chain.id}, ClearingHouse ${deployment.contracts.clearingHouse}` : `no manifest for chain ${chain.id}`,
    required: true,
  });

  // Reachability, and that the node agrees about which chain it is. A node quietly serving a
  // different chain answers every call successfully and every answer is about the wrong world.
  let rpcOk = false;
  let rpcDetail = "not attempted";
  try {
    const client = createPublicClient({ transport: http(chain.rpcUrl, { retryCount: 1, timeout: 8_000 }) });
    const [id, block] = await Promise.all([client.getChainId(), client.getBlockNumber()]);
    rpcOk = id === chain.id;
    rpcDetail = rpcOk ? `chain ${id} at block ${block}` : `endpoint reports chain ${id}, expected ${chain.id}`;
  } catch (e) {
    rpcDetail = (e as Error).message.slice(0, 120);
  }
  checks.push({ name: "rpc", ok: rpcOk, detail: rpcDetail, required: true });

  // The registries a delegated action needs. Absent means the authority stack is not deployed, and
  // a mandate page would offer to sign against nothing.
  const hasAuthority = Boolean(deployment?.contracts?.mandateRegistry && deployment?.contracts?.delegationGateway);
  checks.push({
    name: "delegated-authority",
    ok: hasAuthority,
    detail: hasAuthority ? "MandateRegistry and DelegationGateway are deployed" : "not deployed on this chain",
    required: false,
  });

  const blocking = checks.filter((c) => c.required && !c.ok);
  const ready = blocking.length === 0;

  return NextResponse.json(
    {
      ready,
      chainId: chain.id,
      checks,
      // Named rather than left for a reader to infer from the array.
      blockedBy: blocking.map((c) => c.name),
      checkedAt: new Date().toISOString(),
    },
    { status: ready ? 200 : 503 },
  );
}

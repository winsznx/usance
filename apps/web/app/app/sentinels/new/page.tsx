"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createPublicClient, http, keccak256, parseAbi, stringToBytes, type Address } from "viem";
import { canonicalJson } from "@usance/schemas";
import { AccountShell } from "@/components/account-shell";
import { Notice, Steps } from "@/components/primitives";
import { TxTimeline } from "@/components/action";
import { activeChain, loadDeployment, type Deployment } from "@/lib/deployments";
import { sendTransaction, type TxState } from "@/lib/tx";
import { draftFrom, signMandate, SignatureRejected, REGISTRY_WRITE_ABI } from "@/lib/mandate-sign";
import { SENTINEL_INSTANCE_WRITE_ABI } from "@/lib/sentinel-read";

/**
 * The Safety Buffer facts the preview shows. Hardcoded rather than imported from `@/lib/sentinels`,
 * because that lib pulls the runtime (Node built-ins) and this is a client component — the same
 * reason `configHash` is computed inline from client-safe primitives below.
 */
const T1 = { name: "Safety Buffer", riskClass: "RISK_REDUCING_ONLY", actions: ["REPAY", "ADD_COLLATERAL"] };

/**
 * The Safety Buffer template as committed on X Layer testnet (see `docs/SENTINELS_DEMO.md`). The
 * on-chain templateId differs from the offchain catalogue derivation, so registration pins the
 * deployed id and reads its manifest hash live — a mismatch is refused (I-62), never guessed.
 */
const ONCHAIN_T1_TEMPLATE_ID = "0x0dbe0105712f0a5adb4df2b9b70ca24cbb5ed045d5fe2533c92591f1eea40dc4" as `0x${string}`;

const MR_READ = parseAbi([
  "function accountIdFor(address) view returns (bytes32)",
  "function leafFor(bytes32) view returns (bytes32)",
  "function mandateIdFor(address,uint256) view returns (bytes32)",
]);
const TR_READ = parseAbi([
  "function getVersion(bytes32,uint64) view returns ((address publisher,bytes32 manifestHash,bytes32 configSchemaHash,bytes32 triggerSchemaHash,bytes32 planSchemaHash,uint8 riskClass,uint16 requiredActions,uint16 requiredTriggerClasses,uint16 feePerSuccessfulRunBps,uint128 feeFlatPerRunUsd18,uint8 status,uint8 auditStatus,uint64 createdAt))",
]);

/**
 * `/app/sentinels/new` — arm a Sentinel.
 *
 * A form that culminates in a signature. The user sees every financial permission — the exact
 * actions, the cap, the expiry, the agent — before the wallet ever opens (§13/§42). Arming is two
 * transactions: the mandate the agent acts under, then the instance that pins the template. Both go
 * through the shared `sendTransaction`, so a lost RPC is CONFIRMATION_UNKNOWN, never a silent retry.
 */
export default function NewSentinelPage() {
  return (
    <AccountShell
      title="Arm a Sentinel"
      intro="Install the Safety Buffer strategy. It can only repay debt on your behalf, and it cannot borrow, trade, or move collateral. It acts strictly within the mandate you are about to sign."
    >
      {(account) => <Create account={account} />}
    </AccountShell>
  );
}

type Phase = "CONFIGURE" | "WORKING" | "ARMED";

function Create({ account }: { account: `0x${string}` }) {
  const chain = activeChain();
  const template = T1;
  const [deployment, setDeployment] = useState<Deployment | null>(null);
  const [agent, setAgent] = useState("");
  const [capUsd, setCapUsd] = useState("500");
  const [durationDays, setDurationDays] = useState("30");
  const [phase, setPhase] = useState<Phase>("CONFIGURE");
  const [tx, setTx] = useState<TxState>({ stage: "IDLE" });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadDeployment(chain.id).then(setDeployment);
  }, [chain.id]);

  const registries = deployment?.contracts;
  const ready = Boolean(registries?.mandateRegistry && registries?.sentinelInstanceRegistry && registries?.sentinelTemplateRegistry);
  const agentValid = /^0x[0-9a-fA-F]{40}$/.test(agent);
  const capValid = Number(capUsd) > 0 && Number.isFinite(Number(capUsd));
  const durationValid = Number(durationDays) >= 1;
  const canArm = ready && agentValid && capValid && durationValid && phase !== "WORKING";

  async function arm() {
    if (!registries?.mandateRegistry || !registries.sentinelInstanceRegistry || !registries.sentinelTemplateRegistry) return;
    setError(null);
    setPhase("WORKING");
    const mr = registries.mandateRegistry as Address;
    const tr = registries.sentinelTemplateRegistry as Address;
    const ir = registries.sentinelInstanceRegistry as Address;
    const assetId = deployment?.assets[0]?.assetId as `0x${string}` | undefined;
    if (!assetId) {
      setError("This deployment has no admitted collateral asset to bind the mandate to.");
      setPhase("CONFIGURE");
      return;
    }

    try {
      const c = createPublicClient({ transport: http(chain.rpcUrl, { retryCount: 3, timeout: 30_000 }) });
      const [accountId, assetsRoot, tv] = await Promise.all([
        c.readContract({ address: mr, abi: MR_READ, functionName: "accountIdFor", args: [account] }),
        c.readContract({ address: mr, abi: MR_READ, functionName: "leafFor", args: [assetId] }),
        c.readContract({ address: tr, abi: TR_READ, functionName: "getVersion", args: [ONCHAIN_T1_TEMPLATE_ID, 1n] }),
      ]);
      const manifestHash = tv.manifestHash;

      const draft = draftFrom({
        owner: account,
        agent: agent as `0x${string}`,
        accountId,
        actions: ["REPAY"],
        maxDebtUsd: BigInt(Math.round(Number(capUsd))) * 10n ** 18n,
        durationDays: Number(durationDays),
        assetsRoot,
      });

      const signature = await signMandate(draft, mr);

      const s1 = await sendTransaction({
        to: mr,
        abi: REGISTRY_WRITE_ABI as never,
        functionName: "registerMandate",
        args: [draft, signature],
        from: account,
        onStage: setTx,
      });
      if (s1.stage !== "COMPLETE") {
        setPhase("CONFIGURE");
        return;
      }

      const mandateId = await c.readContract({ address: mr, abi: MR_READ, functionName: "mandateIdFor", args: [account, draft.nonce] });
      const config = {
        targetBufferBps: 2000,
        warningBufferBps: 2500,
        actionBufferBps: 1500,
        maxRepayPerRunUsd18: (BigInt(Math.round(Number(capUsd))) * 10n ** 18n / 4n).toString(),
        dailyCapUsd18: (BigInt(Math.round(Number(capUsd))) * 10n ** 18n).toString(),
        cooldownSeconds: 900,
      };
      const configHash = keccak256(stringToBytes(canonicalJson(config)));

      const s2 = await sendTransaction({
        to: ir,
        abi: SENTINEL_INSTANCE_WRITE_ABI as never,
        functionName: "registerInstance",
        args: [ONCHAIN_T1_TEMPLATE_ID, 1n, manifestHash, agent as `0x${string}`, mandateId, configHash],
        from: account,
        onStage: setTx,
      });
      if (s2.stage === "COMPLETE") {
        setPhase("ARMED");
      } else {
        setPhase("CONFIGURE");
      }
    } catch (e) {
      setError(e instanceof SignatureRejected ? e.message : (e as Error).message || "Arming failed before anything was submitted.");
      setPhase("CONFIGURE");
    }
  }

  const steps = [
    { label: "Configure", state: phase === "CONFIGURE" ? ("active" as const) : ("done" as const) },
    { label: "Sign & register mandate", state: phase === "WORKING" ? ("active" as const) : phase === "ARMED" ? ("done" as const) : ("pending" as const) },
    { label: "Armed", state: phase === "ARMED" ? ("done" as const) : ("pending" as const) },
  ];

  if (!deployment) {
    return <Notice tone="warn" title="Not deployed here">Sentinels are not available on {chain.name} yet.</Notice>;
  }

  return (
    <div className="stack">
      <Steps steps={steps} />

      {phase === "ARMED" ? (
        <Notice title="Sentinel armed">
          Your Safety Buffer Sentinel is registered and will act within the mandate you signed. It
          repays only, never borrows or withdraws. <Link href="/app/sentinels">View your Sentinels</Link>.
        </Notice>
      ) : (
        <>
          {/* ---------------------------------------------------------- permission preview */}
          <div className="card">
            <div className="micro">What this Sentinel may do</div>
            <div className="stack-sm" style={{ marginTop: 12 }}>
              <div className="row-between"><span className="caption">Strategy</span><span>{template?.name ?? "Safety Buffer"}</span></div>
              <div className="row-between"><span className="caption">Risk class</span><span className="tag">{(template?.riskClass ?? "RISK_REDUCING_ONLY").replace(/_/g, " ").toLowerCase()}</span></div>
              <div className="row-between"><span className="caption">Actions</span><span className="row" style={{ gap: 6 }}>{(template?.actions ?? ["REPAY"]).map((a) => <span key={a} className="tag">{a}</span>)}</span></div>
              <div className="row-between"><span className="caption">Cannot</span><span className="caption">borrow · trade · withdraw collateral</span></div>
            </div>
          </div>

          {/* ---------------------------------------------------------- form */}
          <div className="card stack-sm">
            <label className="stack-sm">
              <span className="caption">Agent executor address (the bounded key that will act)</span>
              <input className="input mono" value={agent} onChange={(e) => setAgent(e.target.value.trim())} placeholder="0x…" spellCheck={false} />
              {agent && !agentValid ? <span className="caption" style={{ color: "var(--stop)" }}>Not a valid address.</span> : null}
            </label>
            <label className="stack-sm">
              <span className="caption">Maximum debt the mandate may touch (USD)</span>
              <input className="input tnum" value={capUsd} onChange={(e) => setCapUsd(e.target.value)} inputMode="decimal" />
            </label>
            <label className="stack-sm">
              <span className="caption">Mandate duration (days)</span>
              <input className="input tnum" value={durationDays} onChange={(e) => setDurationDays(e.target.value)} inputMode="numeric" />
            </label>
          </div>

          <Notice title="You are signing a delegation, not a payment">
            The next step opens your wallet to sign an EIP-712 mandate showing the agent, the cap and
            the expiry. Arming submits two transactions, the mandate, then the instance that pins
            the template. A compromised agent still cannot exceed this mandate or withdraw collateral.
          </Notice>

          {!ready ? (
            <Notice tone="warn" title="Registry not available">The Sentinel registries are not deployed on {chain.name}.</Notice>
          ) : null}
          {error ? <Notice tone="stop" title="Could not arm">{error}</Notice> : null}

          <button className="btn btn-primary btn-lg" disabled={!canArm} onClick={arm}>
            {phase === "WORKING" ? "Working…" : "Sign mandate & arm"}
          </button>
        </>
      )}

      {tx.stage !== "IDLE" ? <TxTimeline tx={tx} explorerUrl={chain.explorerUrl} /> : null}
    </div>
  );
}

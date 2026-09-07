"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { type Address, stringToHex } from "viem";
import { Notice } from "@/components/primitives";
import { TxTimeline } from "@/components/action";
import { activeChain } from "@/lib/deployments";
import { connectedAccount } from "@/lib/actions";
import { REGISTRY_WRITE_ABI } from "@/lib/mandate-sign";
import { sendTransaction, type TxState } from "@/lib/tx";

/**
 * Pause / resume / revoke, wired to `MandateRegistry`.
 *
 * The contract already carries the whole lifecycle: `pauseMandate` and `resumeMandate` (the owner
 * lifts their own; only governance lifts a guardian's), and `revokeMandate` which is terminal.
 * This only exposes what the owner can do — a non-owner viewing the mandate sees the state and the
 * disabled controls with the reason, never a button that would revert.
 */
export function MandateControls({
  mandateId,
  owner,
  registry,
  status,
}: {
  mandateId: string;
  owner: string;
  registry: string;
  status: "ACTIVE" | "PAUSED" | "REVOKED" | "EXPIRED";
}) {
  const chain = activeChain();
  const router = useRouter();
  const [account, setAccount] = useState<Address | null | undefined>(undefined);
  const [tx, setTx] = useState<TxState>({ stage: "IDLE" });
  const [confirmRevoke, setConfirmRevoke] = useState(false);

  useEffect(() => {
    void connectedAccount().then(setAccount);
  }, []);

  const isOwner = account != null && account.toLowerCase() === owner.toLowerCase();
  const busy = tx.stage === "AWAITING_WALLET" || tx.stage === "SUBMITTED";

  const run = useCallback(
    async (functionName: "pauseMandate" | "resumeMandate" | "revokeMandate") => {
      if (!isOwner || !account) return;
      const args =
        functionName === "revokeMandate"
          ? [mandateId as `0x${string}`, stringToHex("owner-revoked", { size: 32 })]
          : [mandateId as `0x${string}`];
      const r = await sendTransaction({
        to: registry as `0x${string}`,
        abi: REGISTRY_WRITE_ABI,
        functionName,
        args,
        from: account,
        onStage: setTx,
      });
      if (r.stage === "COMPLETE" || r.stage === "RECONCILING") {
        router.refresh();
      }
    },
    [isOwner, account, mandateId, registry, router],
  );

  if (status === "REVOKED") {
    return (
      <Notice tone="stop" title="Revocation is final">
        There is no un-revoke function anywhere in the registry. Authorising this agent again means
        signing a new mandate with a new nonce.
      </Notice>
    );
  }
  if (status === "EXPIRED") {
    return (
      <Notice tone="stop" title="This mandate has expired">
        The agent can no longer act. A new mandate needs a new signature.
      </Notice>
    );
  }

  if (account === undefined) {
    return <div className="skeleton" style={{ height: 56 }} />;
  }

  if (!isOwner) {
    return (
      <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
        <button className="btn btn-ghost btn-lg" disabled>
          {status === "PAUSED" ? "Resume" : "Pause"}
        </button>
        <button className="btn btn-lg" disabled style={{ borderColor: "var(--stop)", color: "var(--stop)" }}>
          Revoke
        </button>
        <span className="caption" style={{ alignSelf: "center" }}>
          {account === null
            ? "Connect the owner wallet to pause, resume or revoke."
            : "Only the owner of this mandate can change its state."}
        </span>
      </div>
    );
  }

  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
        {status === "PAUSED" ? (
          <button className="btn btn-primary btn-lg" disabled={busy} onClick={() => run("resumeMandate")}>
            Resume
          </button>
        ) : (
          <button className="btn btn-ghost btn-lg" disabled={busy} onClick={() => run("pauseMandate")}>
            Pause
          </button>
        )}
        {confirmRevoke ? (
          <>
            <button
              className="btn btn-lg"
              disabled={busy}
              style={{ background: "var(--stop)", color: "#fff" }}
              onClick={() => run("revokeMandate")}
            >
              Confirm — revoke permanently
            </button>
            <button className="btn btn-ghost btn-lg" disabled={busy} onClick={() => setConfirmRevoke(false)}>
              Keep it
            </button>
          </>
        ) : (
          <button
            className="btn btn-lg"
            disabled={busy}
            style={{ borderColor: "var(--stop)", color: "var(--stop)" }}
            onClick={() => setConfirmRevoke(true)}
          >
            Revoke
          </button>
        )}
      </div>

      <p className="caption" style={{ margin: 0 }}>
        {status === "PAUSED"
          ? "Resuming restores the agent to exactly the limits it had — nothing was lost while paused."
          : "Pausing suspends the agent immediately. Revoking is permanent: the registry has no un-revoke."}
      </p>

      {tx.stage !== "IDLE" ? <TxTimeline tx={tx} explorerUrl={chain.explorerUrl} /> : null}
    </div>
  );
}

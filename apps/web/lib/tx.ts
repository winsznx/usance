"use client";

import { encodeFunctionData, decodeErrorResult, type Abi } from "viem";
import { withBuilderCode, builderCodeFromEnv } from "@usance/xlayer";
import { detectProvider } from "./wallet";

/**
 * Transaction submission.
 *
 * Two things happen here that are easy to get wrong and expensive to get wrong.
 *
 * First, every write carries the ERC-8021 builder-code suffix. It is applied here, in the one
 * function all writes go through, rather than at each call site — attribution that depends on
 * remembering to add it is attribution that will be missing from exactly the transactions you
 * care about.
 *
 * Second, a lost RPC response is not a failed transaction. `CONFIRMATION_UNKNOWN` is a distinct
 * terminal-ish state that resolves by looking the transaction up, never by asking the user to
 * sign again. A second signature after an unknown first result is how people borrow twice.
 */

export type TxStage =
  | "IDLE"
  | "PREVIEW"
  | "APPROVAL_REQUIRED"
  | "AWAITING_WALLET"
  | "SUBMITTED"
  | "CONFIRMING"
  | "RECONCILING"
  | "COMPLETE"
  | "REJECTED"
  | "CONFIRMATION_UNKNOWN"
  | "FAILED";

export interface TxState {
  stage: TxStage;
  hash?: `0x${string}`;
  /** Decoded protocol reason, when the contract gave one. */
  reason?: ProtocolError;
  message?: string;
}

/**
 * A decoded custom error from the protocol.
 *
 * The whole point of decoding these is that the contract already knows the exact maximum, the
 * exact shortfall, or the exact safe amount. Showing "transaction reverted" when the chain told
 * us "you asked for 900.4 and your limit is 833.11" throws away the most useful sentence in the
 * entire interaction.
 */
export interface ProtocolError {
  name: string;
  args: readonly unknown[];
  /** Human copy, already written for this specific failure. */
  title: string;
  body: string;
  /** What the user can actually do next. */
  repair: string;
}

const ACCOUNT_STATUS_COPY = [
  "healthy",
  "blocked from taking new risk",
  "reduce-only",
  "in a margin call",
  "being liquidated",
  "settled",
  "in bad debt",
];

function usd(v: unknown): string {
  if (typeof v !== "bigint") return "—";
  const whole = v / 10n ** 18n;
  const frac = (v % 10n ** 18n).toString().padStart(18, "0").slice(0, 2);
  return `$${whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${frac}`;
}

export function explainProtocolError(name: string, args: readonly unknown[]): ProtocolError {
  switch (name) {
    case "RiskLimitExceeded": {
      const [requested, maximum] = args as [bigint, bigint];
      const over = requested > maximum ? requested - maximum : 0n;
      return {
        name,
        args,
        title: "That is more than you can borrow right now",
        body: `You asked for ${usd(requested)}, which is ${usd(over)} above your current limit of ${usd(maximum)}.`,
        repair: `Reduce the amount to ${usd(maximum)}, or add more collateral.`,
      };
    }
    case "AccountNotHealthy": {
      const [status] = args as [number];
      return {
        name,
        args,
        title: "Your account cannot take on new risk",
        body: `The account is currently ${ACCOUNT_STATUS_COPY[status] ?? "restricted"}.`,
        repair: "Repay some debt or add collateral, then try again.",
      };
    }
    case "WithdrawWouldBreachMaintenance": {
      const [maxSafe] = args as [bigint];
      return {
        name,
        args,
        title: "That withdrawal would leave your account unsafe",
        body: `You can withdraw up to ${usd(maxSafe)} of value without breaching your collateral requirement.`,
        repair: "Withdraw the safe maximum, or repay debt first to unlock more.",
      };
    }
    case "StaleRiskEpoch":
      return {
        name,
        args,
        title: "Risk policy changed while you were reviewing",
        body: "Usance re-priced your quote because the policy behind one of your assets moved.",
        repair: "Review the updated numbers and confirm again.",
      };
    case "InsufficientProtocolLiquidity": {
      const [available, requested] = args as [bigint, bigint];
      return {
        name,
        args,
        title: "Not enough lender liquidity right now",
        body: `You asked for ${usd(requested)} and the vault currently holds ${usd(available)} of deployable cash. This is a liquidity limit, not a limit on your collateral.`,
        repair: "Borrow a smaller amount, or wait for lenders to supply more.",
      };
    }
    case "ReservationOutstanding":
      return {
        name,
        args,
        title: "Capital is reserved for an in-flight action",
        body: "You have an execution that has not finished reconciling, so collateral cannot move yet.",
        repair: "Wait for it to settle, then try again. Do not resubmit.",
      };
    case "AssetNotCollateral":
      return {
        name,
        args,
        title: "This asset cannot be used as collateral",
        body: "Usance has not admitted this asset for collateral use, or it is currently suspended.",
        repair: "Check the asset page for its current status.",
      };
    case "NoDebt":
      return { name, args, title: "Nothing to repay", body: "This account has no outstanding debt.", repair: "" };
    case "ZeroAmount":
      return { name, args, title: "Enter an amount", body: "", repair: "" };
    default:
      return {
        name,
        args,
        title: "The protocol refused this action",
        body: `Reason: ${name}.`,
        repair: "Nothing moved. You can adjust and try again.",
      };
  }
}

function isUserRejection(e: unknown): boolean {
  const code = (e as { code?: number | string })?.code;
  return code === 4001 || code === "ACTION_REJECTED";
}

/** Pull a revert payload out of the many shapes providers wrap it in. */
function extractRevertData(e: unknown): `0x${string}` | null {
  const seen = new Set<unknown>();
  const walk = (o: unknown): `0x${string}` | null => {
    if (!o || typeof o !== "object" || seen.has(o)) return null;
    seen.add(o);
    const rec = o as Record<string, unknown>;
    for (const k of ["data", "error", "cause", "info", "originalError"]) {
      const v = rec[k];
      if (typeof v === "string" && /^0x[0-9a-fA-F]{8,}$/.test(v)) return v as `0x${string}`;
      const nested = walk(v);
      if (nested) return nested;
    }
    return null;
  };
  return walk(e);
}

export function decodeProtocolError(e: unknown, abi: Abi): ProtocolError | null {
  const data = extractRevertData(e);
  if (!data) return null;
  try {
    const decoded = decodeErrorResult({ abi, data });
    return explainProtocolError(decoded.errorName, (decoded.args ?? []) as readonly unknown[]);
  } catch {
    return null;
  }
}

export interface SendOptions {
  to: `0x${string}`;
  abi: Abi;
  functionName: string;
  args: readonly unknown[];
  from: `0x${string}`;
  onStage?: (s: TxState) => void;
}

/**
 * Encode, attribute, sign and follow a write.
 *
 * Attribution is applied to the encoded calldata before signing. Solidity ignores trailing
 * calldata beyond the decoded arguments, so this is safe on every call and requires no support
 * from the receiving contract.
 */
export async function sendTransaction(opts: SendOptions): Promise<TxState> {
  const { provider } = detectProvider();
  const emit = (s: TxState) => {
    opts.onStage?.(s);
    return s;
  };

  if (!provider) {
    return emit({ stage: "FAILED", message: "No wallet is connected." });
  }

  const bare = encodeFunctionData({
    abi: opts.abi,
    functionName: opts.functionName,
    args: opts.args as never,
  });
  const data = withBuilderCode(bare, builderCodeFromEnv());

  emit({ stage: "AWAITING_WALLET" });

  let hash: `0x${string}`;
  try {
    hash = (await provider.request({
      method: "eth_sendTransaction",
      params: [{ from: opts.from, to: opts.to, data }],
    })) as `0x${string}`;
  } catch (e) {
    if (isUserRejection(e)) {
      // Nothing was broadcast. Returning to an editable form is safe and correct.
      return emit({ stage: "REJECTED", message: "You declined the transaction in your wallet." });
    }
    const reason = decodeProtocolError(e, opts.abi);
    if (reason) return emit({ stage: "FAILED", reason });
    return emit({ stage: "FAILED", message: (e as Error).message ?? "The transaction could not be sent." });
  }

  emit({ stage: "SUBMITTED", hash });

  // From here the transaction exists on the network whether or not we can see it. Every failure
  // below resolves to CONFIRMATION_UNKNOWN, never to "try again".
  try {
    const receipt = await waitForReceipt(provider, hash);
    if (receipt.status === "0x0") {
      return emit({ stage: "FAILED", hash, message: "The transaction was included but reverted." });
    }
    emit({ stage: "RECONCILING", hash });
    return emit({ stage: "COMPLETE", hash });
  } catch {
    return emit({
      stage: "CONFIRMATION_UNKNOWN",
      hash,
      message:
        "Your transaction was submitted but we lost track of it. Usance is checking the chain. Do not resubmit.",
    });
  }
}

async function waitForReceipt(
  provider: { request(a: { method: string; params?: unknown[] }): Promise<unknown> },
  hash: `0x${string}`,
  timeoutMs = 90_000,
): Promise<{ status: string }> {
  const started = Date.now();
  // Backs off rather than hammering: X Layer blocks are fast, but a page left open for minutes
  // should not keep a phone's radio busy on a fixed 1s interval.
  let delay = 1_000;
  while (Date.now() - started < timeoutMs) {
    const r = (await provider.request({
      method: "eth_getTransactionReceipt",
      params: [hash],
    })) as { status: string } | null;
    if (r) return r;
    await new Promise((res) => setTimeout(res, delay));
    delay = Math.min(delay * 1.4, 6_000);
  }
  throw new Error("receipt timeout");
}

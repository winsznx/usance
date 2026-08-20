import { parseAbi, type Address, type Hex, type PublicClient, type WalletClient } from "viem";
import { parseUsd18, type EvmAddress, type Hex32, type MarketSession } from "@usance/schemas";
import type {
  AccountState,
  BlockRef,
  DelegationGatewayClient,
  ExecutionRequest,
  ExecutionResult,
  MandateSnapshot,
  PassportRef,
  SentinelChainView,
} from "../chain";

/**
 * Live X Layer adapters for the Sentinel runtime — the real counterparts of `MockChain`. The read
 * side wraps a viem public client over the deployed ClearingHouse / RiskPolicyRegistry /
 * MandateRegistry; the write side submits a delegated REPAY through the DelegationGateway signed by
 * the agent executor, exactly as `scripts/live-mandate.mjs` proved. Nothing here holds authority the
 * mandate does not already grant.
 */

const CH_ABI = parseAbi([
  "function accountHealth(address) view returns ((uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint8,uint32),(bytes32,uint256,uint256,uint256,uint256,uint256,uint256)[])",
]);
const RP_ABI = parseAbi(["function riskEpoch() view returns (uint64)"]);
const MR_ABI = parseAbi(["function isLive(bytes32) view returns (bool)"]);
const GW_ABI = parseAbi(["function execute(address,bytes32,uint8,bytes32,uint256,bytes32,bytes32[],bytes32[]) returns (uint256)"]);

const ACCOUNT_STATUS = ["NORMAL", "NO_NEW_RISK", "REDUCE_ONLY", "MARGIN_CALL", "LIQUIDATING", "SETTLED", "BAD_DEBT"] as const;
const NO_VENUE = `0x${"00".repeat(32)}` as Hex32;
/** DelegationGateway action ordinal for REPAY (bit index 1 in the mandate vocabulary). */
const REPAY_ACTION = 1;

export interface XLayerAddresses {
  clearingHouse: Address;
  riskPolicyRegistry: Address;
  mandateRegistry: Address;
  delegationGateway: Address;
}

/** The mandate this run executes under. Liveness is read live; the bounds are the signed values. */
export interface KnownMandate {
  mandateId: Hex32;
  allowedActions: number;
  expiresAt: number;
  agentExecutor: EvmAddress;
}

export class XLayerChainView implements SentinelChainView {
  constructor(
    private readonly pub: PublicClient,
    private readonly addr: XLayerAddresses,
    private readonly chainId: number,
    private readonly mandate: KnownMandate,
  ) {}

  async block(): Promise<BlockRef> {
    const b = await this.pub.getBlock();
    return { chainId: this.chainId, number: Number(b.number), hash: b.hash as Hex32 };
  }

  async currentRiskEpoch(): Promise<number> {
    const e = (await this.pub.readContract({
      address: this.addr.riskPolicyRegistry,
      abi: RP_ABI,
      functionName: "riskEpoch",
    })) as bigint;
    // The snapshot schema requires epoch >= 1; a testnet policy registry can legitimately read 0.
    return Math.max(1, Number(e));
  }

  async accountState(account: EvmAddress): Promise<AccountState> {
    const res = (await this.pub.readContract({
      address: this.addr.clearingHouse,
      abi: CH_ABI,
      functionName: "accountHealth",
      args: [account as Address],
    })) as unknown as readonly [readonly bigint[], unknown];
    const r = res[0];
    const recognised = r[0] ?? 0n;
    const borrowLimit = r[1] ?? 0n;
    const debt = r[4] ?? 0n;
    const available = r[5] ?? 0n;
    const statusIdx = Number(r[7] ?? 0n);
    // Buffer is headroom under the borrow limit; 0 when debt has reached or passed it.
    const bufferBps = borrowLimit === 0n ? 10_000 : debt >= borrowLimit ? 0 : Number(((borrowLimit - debt) * 10_000n) / borrowLimit);
    return {
      status: ACCOUNT_STATUS[statusIdx] ?? "UNKNOWN",
      recognisedUsd18: recognised.toString(),
      debtUsd18: debt.toString(),
      borrowLimitUsd18: borrowLimit.toString(),
      maintenanceLimitUsd18: borrowLimit.toString(),
      availableBorrowUsd18: available.toString(),
      reservedUsd18: "0",
      bufferBps,
    };
  }

  async mandateState(_mandateId: Hex32): Promise<MandateSnapshot | null> {
    const live = (await this.pub.readContract({
      address: this.addr.mandateRegistry,
      abi: MR_ABI,
      functionName: "isLive",
      args: [this.mandate.mandateId],
    })) as boolean;
    return {
      live,
      expiresAt: this.mandate.expiresAt,
      remainingDebtUsd18: "0",
      remainingNotionalUsd18: "0",
      allowedActions: this.mandate.allowedActions,
      agentExecutor: this.mandate.agentExecutor,
    };
  }

  async passportVersions(): Promise<readonly PassportRef[]> {
    return [];
  }

  async marketSession(): Promise<MarketSession> {
    // The settlement/collateral test assets trade continuously; the underlying-session nuance
    // applies to tokenized equities, which this proof does not use.
    return "OPEN";
  }

  async transactionOutcome(txHash: Hex32): Promise<"success" | "reverted" | null> {
    try {
      const r = await this.pub.getTransactionReceipt({ hash: txHash as Hex });
      return r.status === "success" ? "success" : "reverted";
    } catch {
      return null;
    }
  }
}

export interface ViemChainSpec {
  id: number;
  name: string;
  nativeCurrency: { name: string; symbol: string; decimals: number };
  rpcUrls: { default: { http: string[] } };
}

export class XLayerDelegationGateway implements DelegationGatewayClient {
  constructor(
    private readonly agentWallet: WalletClient,
    private readonly pub: PublicClient,
    private readonly gateway: Address,
    private readonly assetId: Hex32,
    private readonly mandateId: Hex32,
    private readonly chain: ViemChainSpec,
  ) {}

  async execute(req: ExecutionRequest): Promise<ExecutionResult> {
    if (req.plan.action !== "REPAY") {
      return { txHash: NO_VENUE, outcome: "reverted", revertReason: "live gateway proof supports REPAY only" };
    }
    const account = this.agentWallet.account;
    if (!account) throw new Error("agent wallet has no bound account");
    const amount = parseUsd18(req.plan.amountUsd18);
    const hash = await this.agentWallet.writeContract({
      address: this.gateway,
      abi: GW_ABI,
      functionName: "execute",
      args: [req.account as Address, this.mandateId, REPAY_ACTION, this.assetId, amount, NO_VENUE, [], []],
      account,
      chain: this.chain,
    });
    const r = await this.pub.waitForTransactionReceipt({ hash, timeout: 180_000 });
    return { txHash: hash as Hex32, outcome: r.status === "success" ? "success" : "reverted" };
  }
}

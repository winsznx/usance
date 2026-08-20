import { formatUsd18, parseUsd18, type EvmAddress, type Hex32, type MarketSession, type SentinelPlan } from "@usance/schemas";
import { keccak256, stringToBytes } from "viem";

/**
 * What the runtime reads from the chain, as a narrow interface rather than a viem client — because
 * the cases worth testing (a stale epoch, a revoked mandate, a lost transaction) are exactly the
 * ones where a live node is the wrong dependency. A production adapter wraps viem behind this; the
 * `MockChain` below is the test double, and it is the same object the mock gateway mutates so a
 * repay actually reduces debt in a snapshot taken afterwards.
 */
export interface AccountState {
  status: string;
  recognisedUsd18: string;
  debtUsd18: string;
  borrowLimitUsd18: string;
  maintenanceLimitUsd18: string;
  availableBorrowUsd18: string;
  reservedUsd18: string;
  /** Safety buffer in bps of the maintenance limit; 0 when debt ≥ maintenance. */
  bufferBps: number;
}

export interface MandateSnapshot {
  live: boolean;
  expiresAt: number;
  remainingDebtUsd18: string;
  remainingNotionalUsd18: string;
  /** Bitmask over the MandateAction vocabulary. */
  allowedActions: number;
  agentExecutor: EvmAddress;
}

export interface BlockRef {
  chainId: number;
  number: number;
  hash: Hex32;
}

export interface PassportRef {
  assetId: Hex32;
  version: number;
  status: string;
}

export interface SentinelChainView {
  block(): Promise<BlockRef>;
  currentRiskEpoch(): Promise<number>;
  accountState(account: EvmAddress): Promise<AccountState>;
  mandateState(mandateId: Hex32): Promise<MandateSnapshot | null>;
  passportVersions(assetIds: readonly Hex32[]): Promise<readonly PassportRef[]>;
  marketSession(account: EvmAddress): Promise<MarketSession>;
  /** For reconciliation: the outcome of a submitted transaction. `null` means still unknown. */
  transactionOutcome(txHash: Hex32): Promise<"success" | "reverted" | null>;
}

export interface ExecutionRequest {
  runId: Hex32;
  account: EvmAddress;
  agentExecutor: EvmAddress;
  mandateId: Hex32;
  expectedEpoch: number;
  plan: SentinelPlan;
}

export interface ExecutionResult {
  txHash: Hex32;
  outcome: "success" | "reverted" | "unknown";
  /** Present on a revert: the decoded reason, so a receipt can record why. */
  revertReason?: string;
}

/**
 * The execution seam. A direct REPAY / ADD_COLLATERAL run submits through the DelegationGateway,
 * which runs the same `ProtocolAllows ∧ MandateAllows` check onchain that the runtime previewed —
 * so a runtime that skipped its check would still be refused in a block. Idempotency on `runId` is
 * the adapter's job (the same run submitted twice is one onchain effect).
 */
export interface DelegationGatewayClient {
  execute(req: ExecutionRequest): Promise<ExecutionResult>;
}

// ------------------------------------------------------------------ mock

export function planActionBit(plan: SentinelPlan): number {
  switch (plan.action) {
    case "REPAY":
      return 1;
    case "ADD_COLLATERAL":
      return 2;
    case "TRADE":
      return 3;
    case "HEDGE":
      return 4;
    case "CLOSE":
      return 5;
    case "SUPPLY_VAULT":
      return 2; // supply moves the account's own funds; modelled under the collateral verb here
  }
}

interface MockAccount {
  recognised: bigint;
  debt: bigint;
  borrowLimit: bigint;
  maintenance: bigint;
  reserved: bigint;
}

/**
 * An in-memory chain for deterministic tests. It is both the read side (`SentinelChainView`) and,
 * via `gateway()`, the write side, so an executed repay is visible to a snapshot taken next — the
 * property that lets an end-to-end test assert an account actually got safer.
 */
export class MockChain implements SentinelChainView {
  private epoch = 1;
  private blockNumber = 38_000_000;
  private readonly accounts = new Map<EvmAddress, MockAccount>();
  private readonly mandates = new Map<Hex32, MandateSnapshot>();
  private readonly passports = new Map<Hex32, PassportRef>();
  private readonly txs = new Map<Hex32, "success" | "reverted">();
  private session: MarketSession = "OPEN";
  private txSeq = 0;

  constructor(readonly chainId = 1952) {}

  setAccount(account: EvmAddress, a: { recognisedUsd18: string; debtUsd18: string; borrowLimitUsd18: string; maintenanceLimitUsd18: string; reservedUsd18?: string }): void {
    this.accounts.set(account, {
      recognised: parseUsd18(a.recognisedUsd18),
      debt: parseUsd18(a.debtUsd18),
      borrowLimit: parseUsd18(a.borrowLimitUsd18),
      maintenance: parseUsd18(a.maintenanceLimitUsd18),
      reserved: parseUsd18(a.reservedUsd18 ?? "0"),
    });
  }

  setMandate(mandateId: Hex32, m: MandateSnapshot): void {
    this.mandates.set(mandateId, m);
  }

  setPassport(p: PassportRef): void {
    this.passports.set(p.assetId, p);
  }

  setEpoch(epoch: number): void {
    this.epoch = epoch;
  }

  setMarketSession(session: MarketSession): void {
    this.session = session;
  }

  revokeMandate(mandateId: Hex32): void {
    const m = this.mandates.get(mandateId);
    if (m) this.mandates.set(mandateId, { ...m, live: false });
  }

  private derive(a: MockAccount): AccountState {
    const bufferBps = a.maintenance === 0n ? 10_000 : a.debt >= a.maintenance ? 0 : Number(((a.maintenance - a.debt) * 10_000n) / a.maintenance);
    const status = a.debt === 0n || a.debt <= a.borrowLimit ? "HEALTHY" : a.debt <= a.maintenance ? "MARGIN_CALL" : "LIQUIDATABLE";
    const available = a.borrowLimit > a.debt ? a.borrowLimit - a.debt : 0n;
    return {
      status,
      recognisedUsd18: formatUsd18(a.recognised),
      debtUsd18: formatUsd18(a.debt),
      borrowLimitUsd18: formatUsd18(a.borrowLimit),
      maintenanceLimitUsd18: formatUsd18(a.maintenance),
      availableBorrowUsd18: formatUsd18(available),
      reservedUsd18: formatUsd18(a.reserved),
      bufferBps,
    };
  }

  async block(): Promise<BlockRef> {
    return { chainId: this.chainId, number: this.blockNumber, hash: keccak256(stringToBytes(`block-${this.blockNumber}`)) };
  }
  async currentRiskEpoch(): Promise<number> {
    return this.epoch;
  }
  async accountState(account: EvmAddress): Promise<AccountState> {
    const a = this.accounts.get(account);
    if (!a) throw new Error(`mock chain has no account ${account}`);
    return this.derive(a);
  }
  async mandateState(mandateId: Hex32): Promise<MandateSnapshot | null> {
    return this.mandates.get(mandateId) ?? null;
  }
  async passportVersions(assetIds: readonly Hex32[]): Promise<readonly PassportRef[]> {
    return assetIds.map((id) => this.passports.get(id) ?? { assetId: id, version: 0, status: "NONE" });
  }
  async marketSession(_account: EvmAddress): Promise<MarketSession> {
    return this.session;
  }
  async transactionOutcome(txHash: Hex32): Promise<"success" | "reverted" | null> {
    return this.txs.get(txHash) ?? null;
  }

  /** The write side. Applies a plan against account state, enforcing the same conjunction onchain. */
  gateway(): DelegationGatewayClient {
    return {
      execute: async (req: ExecutionRequest): Promise<ExecutionResult> => {
        const txHash = keccak256(stringToBytes(`tx-${req.runId}-${this.txSeq++}`));
        const a = this.accounts.get(req.account);
        const m = this.mandates.get(req.mandateId);

        // ProtocolAllows ∧ MandateAllows, enforced in the block. A runtime that skipped its preview
        // would still be refused here — the onchain half of I-40 / I-73.
        if (!a || !m || !m.live) {
          this.txs.set(txHash, "reverted");
          return { txHash, outcome: "reverted", revertReason: "mandate not live" };
        }
        if (req.expectedEpoch !== this.epoch) {
          this.txs.set(txHash, "reverted");
          return { txHash, outcome: "reverted", revertReason: "risk epoch moved" };
        }
        if ((m.allowedActions & (1 << planActionBit(req.plan))) === 0) {
          this.txs.set(txHash, "reverted");
          return { txHash, outcome: "reverted", revertReason: "action not in mandate" };
        }

        if (req.plan.action === "REPAY") {
          const amount = parseUsd18(req.plan.amountUsd18);
          a.debt = a.debt > amount ? a.debt - amount : 0n;
        } else if (req.plan.action === "ADD_COLLATERAL") {
          // A stand-in: collateral raises recognised value and, with it, the limits.
          const tokens = BigInt(req.plan.amountTokens) * 10n ** BigInt(18 - req.plan.decimals);
          a.recognised += tokens;
          a.borrowLimit += tokens / 2n;
          a.maintenance += (tokens * 6n) / 10n;
        }
        this.txs.set(txHash, "success");
        return { txHash, outcome: "success" };
      },
    };
  }
}

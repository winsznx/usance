import { createPublicClient, http, type Address } from "viem";
import { activeChain, loadDeployment } from "./deployments";
import type { AccountStatus } from "@usance/domain";

/**
 * One read of everything a capital user's screens need.
 *
 * Gathered in a single pass rather than per component, because the alternative is six components
 * each issuing their own RPC call and rendering numbers taken at six different blocks. A page that
 * shows debt from one block and collateral from another is a page that can display an account as
 * both healthy and liquidatable at the same time.
 */

const CH_ABI = [
  {
    name: "accountHealth",
    type: "function",
    stateMutability: "view",
    inputs: [{ type: "address" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "totalRecognizedUsd18", type: "uint256" }, { name: "borrowLimitUsd18", type: "uint256" },
          { name: "maintenanceLimitUsd18", type: "uint256" }, { name: "liquidationLimitUsd18", type: "uint256" },
          { name: "debtUsd18", type: "uint256" }, { name: "availableBorrowUsd18", type: "uint256" },
          { name: "healthFactorWad", type: "uint256" }, { name: "status", type: "uint8" },
          { name: "gates", type: "uint32" },
        ],
      },
      {
        type: "tuple[]",
        components: [
          { name: "assetId", type: "bytes32" }, { name: "marketValueUsd18", type: "uint256" },
          { name: "haircutMarkUsd18", type: "uint256" }, { name: "stressedExitUsd18", type: "uint256" },
          { name: "redemptionFloorUsd18", type: "uint256" }, { name: "recognizedUsd18", type: "uint256" },
          { name: "cappedUsd18", type: "uint256" },
        ],
      },
    ],
  },
  { name: "reservedOf", type: "function", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
  { name: "heldAssets", type: "function", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "bytes32[]" }] },
] as const;

const RP_ABI = [
  { name: "riskEpoch", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint64" }] },
] as const;

export const STATUS_NAMES: readonly AccountStatus[] = [
  "NORMAL", "NO_NEW_RISK", "REDUCE_ONLY", "MARGIN_CALL", "LIQUIDATING", "SETTLED", "BAD_DEBT",
];

export interface PositionAsset {
  assetId: `0x${string}`;
  marketValueUsd18: bigint;
  haircutMarkUsd18: bigint;
  stressedExitUsd18: bigint;
  recognizedUsd18: bigint;
}

export interface AccountView {
  account: Address;
  chainId: number;
  blockNumber: bigint;
  recognized: bigint;
  borrowLimit: bigint;
  maintenanceLimit: bigint;
  liquidationLimit: bigint;
  debt: bigint;
  availableBorrow: bigint;
  reserved: bigint;
  status: AccountStatus;
  gates: number;
  riskEpoch: number;
  assets: PositionAsset[];
}

export type AccountLookup =
  | { outcome: "OK"; view: AccountView }
  | { outcome: "NOT_DEPLOYED" }
  | { outcome: "UNREADABLE"; reason: string };

export async function loadAccount(account: Address): Promise<AccountLookup> {
  const chain = activeChain();
  const deployment = await loadDeployment(chain.id);
  if (!deployment) return { outcome: "NOT_DEPLOYED" };

  const client = createPublicClient({
    transport: http(chain.rpcUrl, { retryCount: 3, retryDelay: 1200, timeout: 30_000 }),
  });

  try {
    // Pinned to one block. Reads spread across blocks can show an account as simultaneously
    // healthy and liquidatable, and the user acts on whichever number they happened to read.
    const blockNumber = await client.getBlockNumber();
    const at = { address: deployment.contracts.clearingHouse as Address, abi: CH_ABI, blockNumber } as const;

    const [health, reserved, riskEpoch] = await Promise.all([
      client.readContract({ ...at, functionName: "accountHealth", args: [account] }),
      client.readContract({ ...at, functionName: "reservedOf", args: [account] }),
      client.readContract({
        address: deployment.contracts.riskPolicyRegistry as Address,
        abi: RP_ABI,
        functionName: "riskEpoch",
        blockNumber,
      }),
    ]);

    const [r, valuations] = health;
    return {
      outcome: "OK",
      view: {
        account,
        chainId: chain.id,
        blockNumber,
        recognized: r.totalRecognizedUsd18,
        borrowLimit: r.borrowLimitUsd18,
        maintenanceLimit: r.maintenanceLimitUsd18,
        liquidationLimit: r.liquidationLimitUsd18,
        debt: r.debtUsd18,
        availableBorrow: r.availableBorrowUsd18,
        reserved,
        status: STATUS_NAMES[Number(r.status)] ?? "NORMAL",
        gates: Number(r.gates),
        riskEpoch: Number(riskEpoch),
        assets: valuations.map((v) => ({
          assetId: v.assetId,
          marketValueUsd18: v.marketValueUsd18,
          haircutMarkUsd18: v.haircutMarkUsd18,
          stressedExitUsd18: v.stressedExitUsd18,
          recognizedUsd18: v.recognizedUsd18,
        })),
      },
    };
  } catch (e) {
    // Never a crash. "Could not read" and "you have nothing" are different facts, and showing an
    // empty portfolio for an RPC failure tells somebody their collateral is gone.
    return { outcome: "UNREADABLE", reason: (e as Error).message.slice(0, 160) };
  }
}

/**
 * What the account may do right now, derived from the status ladder.
 *
 * Derived rather than hardcoded per page, so a page cannot offer an action the protocol would
 * refuse. `spec/state-machines.md §2` is the authority.
 */
export function permittedActions(status: AccountStatus): {
  borrow: boolean;
  withdraw: boolean;
  repay: boolean;
  addCollateral: boolean;
} {
  switch (status) {
    case "NORMAL":
      return { borrow: true, withdraw: true, repay: true, addCollateral: true };
    case "NO_NEW_RISK":
      return { borrow: false, withdraw: true, repay: true, addCollateral: true };
    case "REDUCE_ONLY":
    case "MARGIN_CALL":
    case "LIQUIDATING":
      return { borrow: false, withdraw: false, repay: true, addCollateral: true };
    case "SETTLED":
      return { borrow: false, withdraw: true, repay: false, addCollateral: false };
    case "BAD_DEBT":
      return { borrow: false, withdraw: false, repay: false, addCollateral: false };
  }
}

export const usd = (v: bigint): string =>
  (Number(v) / 1e18).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

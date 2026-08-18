import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * The live liquidation record, read for its public receipt.
 *
 * Loaded from disk so the page and the tests read the same bytes. A page that recomputed the
 * explanation could disagree with the artifact the run actually produced.
 */

const ARTIFACT = resolve(process.cwd(), "../../proof/live-liquidation.json");

export interface LiquidationProof {
  account: string;
  identityWarning: string;
  contracts: { clearingHouse: string; liquidationManager: string; route: string };
  riskEpochAfter: number;
  ladder: Array<{ pricePct: number; status: string; recognised: string; debt: string }>;
  eligibility: { status: string; debtUsd18: string; maintenanceLimitUsd18: string; breachUsd18: string };
  plan: {
    repayTargetUsd18: string;
    seizeValueUsd18: string;
    seizeAmount: string;
    liquidationBonusBps: number;
    wouldExhaustCollateral: boolean;
    routeId: string;
    routeDescription: string;
    quote: { proceeds: string; fees: string; latencyHaircut: string; failureHaircut: string; expectedRecovery: string };
  };
  before: { deposited: string; recognised: string; maintenanceLimit: string; debt: string; status: string };
  after: { deposited: string; recognised: string; maintenanceLimit: string; debt: string; status: string };
  partialDeleveraging: {
    collateralSeized: string;
    collateralRemaining: string;
    fractionSeizedBps: number;
    debtRepaidUsd18: string;
  };
  plannedCure: { curesTheBreach: boolean; curingRepayUsd18: string };
  curedAfterwards: { status: string; debtUsd18: string; depositedRemaining: string };
  cureRefusedLiquidation: string;
  bonusAccrual: string;
  liquidationTx: { hash: string; blockNumber: number; gasUsed: string };
}

let cache: LiquidationProof | null | undefined;

export function loadLiquidationProof(): LiquidationProof | null {
  if (cache === undefined) {
    cache = existsSync(ARTIFACT) ? (JSON.parse(readFileSync(ARTIFACT, "utf8")) as LiquidationProof) : null;
  }
  return cache;
}

export const fmtUsd = (raw: string): string =>
  `$${(Number(BigInt(raw) / 10_000_000_000_000n) / 100_000).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

export const fmtTokens = (raw: string): string =>
  (Number(BigInt(raw) / 10_000_000_000_000n) / 100_000).toLocaleString(undefined, { maximumFractionDigits: 4 });

export const fmtSettlement = (raw: string): string =>
  (Number(raw) / 1_000_000).toLocaleString(undefined, { maximumFractionDigits: 2 });

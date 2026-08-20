import { sentinelSnapshotSchema, type Hex32, type SentinelInstance, type SentinelSnapshot } from "@usance/schemas";
import type { SentinelChainView } from "./chain";

/**
 * Pin the financial world a plan will be compiled against (`docs/SENTINELS_ARCHITECTURE.md §7`).
 * Everything a validator or a reader needs to reproduce the decision is captured here; anything that
 * moves by execution time is re-read live by the authorization check, and a moved epoch invalidates
 * rather than reprices.
 */
export async function buildSnapshot(
  chain: SentinelChainView,
  instance: SentinelInstance,
  takenAt: number,
  assetIds: readonly Hex32[] = [],
): Promise<SentinelSnapshot> {
  const block = await chain.block();
  const [account, mandate, epoch, passports, marketSession] = await Promise.all([
    chain.accountState(instance.account),
    chain.mandateState(instance.mandateId),
    chain.currentRiskEpoch(),
    chain.passportVersions(assetIds),
    chain.marketSession(instance.account),
  ]);
  if (!mandate) throw new Error(`snapshot: no mandate ${instance.mandateId}`);

  return sentinelSnapshotSchema.parse({
    chainId: block.chainId,
    blockNumber: block.number,
    blockHash: block.hash,
    account: instance.account,
    accountStatus: account.status,
    recognisedUsd18: account.recognisedUsd18,
    debtUsd18: account.debtUsd18,
    borrowLimitUsd18: account.borrowLimitUsd18,
    maintenanceLimitUsd18: account.maintenanceLimitUsd18,
    availableBorrowUsd18: account.availableBorrowUsd18,
    reservedUsd18: account.reservedUsd18,
    bufferBps: account.bufferBps,
    riskEpoch: epoch,
    mandate: {
      mandateId: instance.mandateId,
      live: mandate.live,
      expiresAt: mandate.expiresAt,
      remainingDebtUsd18: mandate.remainingDebtUsd18,
      remainingNotionalUsd18: mandate.remainingNotionalUsd18,
    },
    passports: passports.map((p) => ({ assetId: p.assetId, version: p.version, status: p.status })),
    marketSession,
    instanceConfigHash: instance.configHash,
    takenAt,
  });
}

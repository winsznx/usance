import {
  clampAuthority,
  scheduleBucket,
  triggerEventSchema,
  type EvmAddress,
  type Hex32,
  type SentinelInstance,
  type TriggerAuthorityClass,
  type TriggerEvent,
} from "@usance/schemas";

/**
 * Trigger ingestion: turning chain events, schedule ticks and observations into `TriggerEvent`s
 * whose identity is derived from the source occurrence, never assigned. Every constructor stamps an
 * authority class and clamps it to the class ceiling — a news reader cannot promote itself to a
 * deterministic onchain read by claiming a stronger class (`docs/SENTINELS_ARCHITECTURE.md §6`).
 *
 * The identity fields per class are exactly those the §6 table names; adding a field here would be
 * a way for the same occurrence to arrive under two ids, which is how idempotency (I-63) breaks.
 */

function build(
  cls: TriggerEvent["class"],
  authorityClaim: TriggerAuthorityClass,
  identity: Record<string, string>,
  observedAt: number,
  account?: EvmAddress,
  detail?: string,
): TriggerEvent {
  return triggerEventSchema.parse({
    class: cls,
    authority: clampAuthority(cls, authorityClaim),
    identity,
    observedAt,
    ...(account ? { account } : {}),
    ...(detail ? { detail } : {}),
  });
}

/** A new risk epoch for an account. Identity: account + epoch. */
export function riskEpochTrigger(account: EvmAddress, epoch: number, observedAt: number): TriggerEvent {
  return build("RISK_STATE", "DETERMINISTIC_ONCHAIN", { account, epoch: String(epoch) }, observedAt, account);
}

/** An account's health status crossed a threshold. Identity: account + status + block. */
export function accountHealthTrigger(
  account: EvmAddress,
  status: string,
  blockNumber: number,
  observedAt: number,
): TriggerEvent {
  return build("RISK_STATE", "DETERMINISTIC_ONCHAIN", { account, status, block: String(blockNumber) }, observedAt, account);
}

/** A Passport version/status changed. Identity: asset + version. */
export function passportChangedTrigger(assetId: Hex32, version: number, observedAt: number): TriggerEvent {
  return build("PASSPORT_STATE", "DETERMINISTIC_ONCHAIN", { asset: assetId, version: String(version) }, observedAt);
}

/** A scheduled evaluation. Identity: instance + spec + time bucket, so two schedulers → one run. */
export function scheduledTrigger(
  instanceId: Hex32,
  spec: string,
  nowSeconds: number,
  intervalSeconds: number,
): TriggerEvent {
  const bucket = scheduleBucket(nowSeconds, intervalSeconds);
  return build("TIME", "DETERMINISTIC_SCHEDULE", { instance: instanceId, spec, bucket: String(bucket) }, nowSeconds);
}

/** An AI/news observation. Identity: content hash + observation type; authority never above AI. */
export function observationTrigger(
  contentHash: Hex32,
  observationType: string,
  claimedAuthority: TriggerAuthorityClass,
  observedAt: number,
  account?: EvmAddress,
  detail?: string,
): TriggerEvent {
  return build("AI_OBSERVATION", claimedAuthority, { content: contentHash, type: observationType }, observedAt, account, detail);
}

/** Owner pressed "evaluate now". Identity: instance + owner nonce. */
export function manualTrigger(instanceId: Hex32, ownerNonce: string, observedAt: number): TriggerEvent {
  return build("MANUAL", "DETERMINISTIC_SCHEDULE", { instance: instanceId, nonce: ownerNonce }, observedAt);
}

// ------------------------------------------------------------------ evaluation

/**
 * Does this event match a trigger this instance actually subscribed to? Matching is by class; the
 * finer conditions (a buffer threshold, a market session) are evaluated at compile and validate
 * time against the pinned snapshot, never against the bare event.
 */
export function triggerMatchesInstance(instance: SentinelInstance, event: TriggerEvent): boolean {
  return instance.triggerPolicy.triggers.some((spec) => {
    if (spec.class === "COMPOSITE") return spec.all.some((m) => m.class === event.class);
    return spec.class === event.class;
  });
}

/** True when the event's authority is one the instance permits to lead to unattended execution. */
export function authorityPermittedByInstance(instance: SentinelInstance, event: TriggerEvent): boolean {
  return instance.triggerPolicy.allowedAuthorityClasses.includes(event.authority);
}

import { z } from "zod";

/**
 * The mandate action vocabulary, shared.
 *
 * This mirrors the onchain `MandateRegistry.MandateAction` enum bit-for-bit: the ordinal IS the
 * bit position in a mandate's `allowedActions` uint16 mask, so this order is load-bearing and may
 * only be appended to, never reordered. `apps/web/lib/mandate.ts` carries a presentation copy of
 * the same table; this is the canonical domain source the Sentinel schemas validate against.
 *
 * The absent verbs are the point. There is no WITHDRAW, TRANSFER, APPROVE or REDEEM member and
 * there is not meant to be one (I-28): a mandate cannot express an outflow, so a fully compromised
 * agent cannot either. A template's `requiredActions` is a mask over exactly these bits, and a bit
 * at or above the vocabulary size is rejected.
 */
export const MANDATE_ACTIONS = [
  { bit: 0, name: "BORROW", raisesRisk: true, delegable: false },
  { bit: 1, name: "REPAY", raisesRisk: false, delegable: true },
  { bit: 2, name: "ADD_COLLATERAL", raisesRisk: false, delegable: true },
  { bit: 3, name: "TRADE", raisesRisk: true, delegable: false },
  { bit: 4, name: "HEDGE", raisesRisk: true, delegable: false },
  { bit: 5, name: "CLOSE", raisesRisk: false, delegable: false },
] as const;

export type MandateAction = (typeof MANDATE_ACTIONS)[number];
export type MandateActionName = MandateAction["name"];

/** Verbs in the vocabulary. A mask bit at or above this ordinal is out of vocabulary. */
export const MANDATE_ACTION_COUNT = MANDATE_ACTIONS.length;

export const MANDATE_ACTION_NAMES = MANDATE_ACTIONS.map((a) => a.name) as [
  MandateActionName,
  ...MandateActionName[],
];

export const mandateActionNameSchema = z.enum(MANDATE_ACTION_NAMES);

const ACTION_BY_NAME: Readonly<Record<MandateActionName, MandateAction>> = Object.fromEntries(
  MANDATE_ACTIONS.map((a) => [a.name, a]),
) as Record<MandateActionName, MandateAction>;

/** The bit mask for a set of action names. Order-insensitive; duplicates collapse under `or`. */
export function maskForActions(names: readonly MandateActionName[]): number {
  return names.reduce((m, n) => m | (1 << ACTION_BY_NAME[n].bit), 0);
}

/** The action rows a mask selects, in vocabulary order. */
export function actionsInMask(mask: number): readonly MandateAction[] {
  return MANDATE_ACTIONS.filter((a) => (mask & (1 << a.bit)) !== 0);
}

/** True when every set bit names a verb in the vocabulary — no bit at or above ACTION_COUNT. */
export function actionsWithinVocabulary(mask: number): boolean {
  return Number.isInteger(mask) && mask >= 0 && mask < 1 << MANDATE_ACTION_COUNT;
}

/** True when a mask selects any verb that can increase account risk (BORROW, TRADE, HEDGE). */
export function maskRaisesRisk(mask: number): boolean {
  return actionsInMask(mask).some((a) => a.raisesRisk);
}

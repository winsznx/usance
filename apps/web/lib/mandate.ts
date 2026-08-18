import type { Address } from "viem";

/**
 * What a mandate means, in the words a person signing one needs.
 *
 * The registry speaks in bitmasks, Merkle roots and basis points. A person about to delegate
 * spending authority over their own collateral needs to know four things: who can act, what they
 * can do, what the ceiling is, and when it stops. Everything else is detail that belongs behind a
 * disclosure, not in the way of the decision.
 */

export const MANDATE_ACTIONS = [
  { bit: 0, name: "BORROW", label: "Borrow against your collateral", raisesRisk: true, delegable: false },
  { bit: 1, name: "REPAY", label: "Repay your debt", raisesRisk: false, delegable: true },
  { bit: 2, name: "ADD_COLLATERAL", label: "Add collateral to your account", raisesRisk: false, delegable: true },
  { bit: 3, name: "TRADE", label: "Trade your exposure", raisesRisk: true, delegable: false },
  { bit: 4, name: "HEDGE", label: "Open a hedge", raisesRisk: true, delegable: false },
  { bit: 5, name: "CLOSE", label: "Close a position", raisesRisk: false, delegable: false },
] as const;

export type MandateActionName = (typeof MANDATE_ACTIONS)[number]["name"];

/**
 * The verb that is absent, stated as data.
 *
 * There is no withdrawal member and there is not meant to be one. The UI says so in as many words
 * rather than leaving a reader to notice an absence, because "I did not see it in the list" is not
 * the same reassurance as "the protocol cannot do this".
 */
export const WITHDRAWAL_IS_NOT_DELEGABLE =
  "This mandate cannot withdraw your collateral. There is no withdrawal action in the mandate " +
  "vocabulary, and Usance refuses any action it does not explicitly allow an agent to take — so " +
  "this holds even if you sign a mandate granting everything.";

export type MandateStatus = "ACTIVE" | "PAUSED" | "REVOKED" | "EXPIRED";

export interface MandateView {
  mandateId: `0x${string}`;
  owner: Address;
  agent: Address;
  status: MandateStatus;
  validFrom: number;
  expiresAt: number;
  maxDebtUsd: bigint;
  maxTradeNotionalUsd: bigint;
  maxSlippageBps: number;
  allowedActions: number;
  debtDrawnUsd18: bigint;
  notionalTradedUsd18: bigint;
  nonce: bigint;
}

export function actionsOf(mask: number) {
  return MANDATE_ACTIONS.filter((a) => (mask & (1 << a.bit)) !== 0);
}

/** True when the mandate grants anything that could increase the account's risk. */
export function canIncreaseRisk(mask: number): boolean {
  return actionsOf(mask).some((a) => a.raisesRisk);
}

/**
 * Actions granted by the signature that the protocol will still refuse.
 *
 * Surfaced rather than hidden. A mandate that grants TRADE today authorises nothing, because no
 * venue path is wired — and a page that displayed the grant without saying so would be describing
 * authority the holder does not have.
 */
export function grantedButRefused(mask: number) {
  return actionsOf(mask).filter((a) => !a.delegable);
}

export const MANDATE_TEMPLATES = [
  {
    id: "safety-buffer",
    title: "Maintain a safety buffer",
    blurb:
      "The agent repays debt on your behalf when your account gets close to its maintenance limit. " +
      "It can only reduce your risk.",
    actions: ["REPAY", "ADD_COLLATERAL"] as MandateActionName[],
    raisesRisk: false,
  },
  {
    id: "auto-repay",
    title: "Repay automatically",
    blurb: "The agent repays from its own balance. It can never draw new debt or move your collateral.",
    actions: ["REPAY"] as MandateActionName[],
    raisesRisk: false,
  },
  {
    id: "top-up",
    title: "Top up collateral",
    blurb: "The agent adds collateral it funds itself. Your balance is never charged.",
    actions: ["ADD_COLLATERAL"] as MandateActionName[],
    raisesRisk: false,
  },
] as const;

export function maskFor(names: readonly MandateActionName[]): number {
  return names.reduce((m, n) => m | (1 << MANDATE_ACTIONS.find((a) => a.name === n)!.bit), 0);
}

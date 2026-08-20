import { z } from "zod";

/**
 * Market session — the one place the tokenized-equity problem is named: a token transfers 24/7,
 * its underlying market does not. `UNKNOWN` is restrictive, never permissive: a Sentinel that
 * cannot prove a market is open must treat it as closed (`docs/SENTINELS_ARCHITECTURE.md §12`).
 *
 * A leaf module on purpose. Triggers, runs and observations all speak this enum, and three inline
 * copies of it is exactly the drift that lets one of them start meaning something different.
 */
export const MARKET_SESSIONS = ["OPEN", "PRE_MARKET", "POST_MARKET", "CLOSED", "UNKNOWN"] as const;

export type MarketSession = (typeof MARKET_SESSIONS)[number];

export const marketSessionSchema = z.enum(MARKET_SESSIONS);

/**
 * True for every session in which a risk-increasing or size-sensitive action must be reduced,
 * deferred or confirmed rather than run at full size. Only a proven-OPEN session is unrestricted;
 * UNKNOWN is restrictive by construction, so the default when a calendar is missing is caution.
 */
export function isSessionRestrictive(session: MarketSession): boolean {
  return session !== "OPEN";
}

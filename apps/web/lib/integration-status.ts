/**
 * Integration status, in one place, shared by `/status` and by every surface that has to disable
 * itself honestly.
 *
 * This mirrors docs/INTEGRATIONS.md. It is duplicated in code rather than parsed from the
 * markdown because a UI that silently disagrees with its own documentation is worse than either
 * one alone, and a parser would fail open. Keeping it as typed data means a status change is a
 * code change that typechecks.
 */

export type Status = "CONFIRMED" | "ACCESS_REQUIRED" | "NOT_AVAILABLE" | "DEFERRED";

export interface Integration {
  name: string;
  role: string;
  status: Status;
  /** What this means for someone using the product right now. */
  consequence: string;
  /** How the status was established. Empty when it is a plain absence of a credential. */
  evidence?: string;
}

export const STATUS_LABEL: Record<Status, string> = {
  CONFIRMED: "Live",
  ACCESS_REQUIRED: "Needs access",
  NOT_AVAILABLE: "Not available",
  DEFERRED: "Deferred",
};

export const integrations: Integration[] = [
  {
    name: "X Layer mainnet",
    role: "Canonical settlement domain",
    status: "CONFIRMED",
    consequence: "Chain 196. All protocol state settles here.",
    evidence: "eth_chainId returns 0xc4 from https://rpc.xlayer.tech",
  },
  {
    name: "X Layer testnet",
    role: "Deployment target",
    status: "CONFIRMED",
    consequence: "Chain 1952. Contracts are not yet broadcast — the deployer is unfunded.",
    evidence: "eth_chainId returns 0x7a0 from https://testrpc.xlayer.tech",
  },
  {
    name: "Chainlink Data Feeds",
    role: "Market price for risk",
    status: "CONFIRMED",
    consequence: "26 feeds published on X Layer. Usance reads the push-based aggregators.",
    evidence: "ETH/USD, BTC/USD and USDC/USD read back live via latestRoundData()",
  },
  {
    name: "Chainlink L2 Sequencer Uptime",
    role: "Oracle validity gate",
    status: "CONFIRMED",
    consequence:
      "A price nobody can arbitrage is not a price to lend against. A down or recently-recovered sequencer blocks new risk.",
  },
  {
    name: "Chainlink Data Streams",
    role: "Market price for risk",
    status: "NOT_AVAILABLE",
    consequence:
      "Not deployed on X Layer at all. Nothing routes through it. The adapter is retained for the day it exists.",
    evidence: 'Chainlink registry lists X Layer with supportedFeatures: ["feeds"], never "streams"',
  },
  {
    name: "X Layer Builder Codes",
    role: "Transaction attribution",
    status: "CONFIRMED",
    consequence:
      "Every write path carries the ERC-8021 calldata suffix. The code itself is not yet registered with X Layer.",
    evidence: "Encoder matches the published schema-0 worked example; 13 unit tests",
  },
  {
    name: "LayerZero V2",
    role: "Remote collateral messaging",
    status: "CONFIRMED",
    consequence:
      "Endpoint verified. Remote collateral contracts are specified and not yet built, so no pathway is live.",
    evidence: "X Layer mainnet EID 30274 from the LayerZero metadata service",
  },
  {
    name: "ChainGPT Web3 LLM",
    role: "Evidence extraction",
    status: "CONFIRMED",
    consequence:
      "Live. One of two independent extraction paths; the deterministic parser is the other. Model output is schema-validated and discarded if it does not fit, and no model output can reach a risk parameter.",
    evidence:
      "Real extraction over a fixture returns quoted, schema-valid claims. A document containing an embedded prompt injection produced the same factual reading as the clean version.",
  },
  {
    name: "ChainGPT Auditor",
    role: "CI security review",
    status: "CONFIRMED",
    consequence:
      "Live. Reports findings or reports AUDIT_UNAVAILABLE. There is no status that means secure, so an outage can never read as a pass.",
    evidence:
      "Given a contract with an external call before a balance decrement, it identified the reentrancy and explained the ordering.",
  },
  {
    name: "ChainGPT AI News",
    role: "Low-trust change detection",
    status: "CONFIRMED",
    consequence:
      "Live. Emits observations at NEWS class only, enforced by type and by a runtime assert. An observation can trigger a Passport refresh; it can never raise a limit or become a claim.",
    evidence: "GET /news returns live articles; the provider maps them to low-trust observations.",
  },
  {
    name: "xStocks",
    role: "First tokenized-equity family",
    status: "ACCESS_REQUIRED",
    consequence:
      "Exact X Layer contract address could not be verified from issuer documentation, so no xStocks asset is registered.",
  },
  {
    name: "Exchange OS / TradeZone",
    role: "Spot, perp and outcome execution",
    status: "ACCESS_REQUIRED",
    consequence:
      "No builder deployment access. Protect and Trade are disabled with the reason shown. No synthetic fill is ever presented as an execution.",
  },
  {
    name: "OKX DEX API",
    role: "Programmatic quotes and routing",
    status: "ACCESS_REQUIRED",
    consequence: "No credentials configured. The adapter stays disabled.",
  },
  {
    name: "OKX DEX Interface",
    role: "Qualifying interface activity",
    status: "DEFERRED",
    consequence:
      "Usance does not claim that contract calls signed through OKX Wallet constitute DEX Interface volume. Attribution must be confirmed with the organiser first.",
  },
  {
    name: "Circle CCTP",
    role: "Optional cash transport",
    status: "NOT_AVAILABLE",
    consequence: "X Layer is not a supported CCTP domain. Not a dependency of any path.",
  },
];

export function byStatus(s: Status): Integration[] {
  return integrations.filter((i) => i.status === s);
}

/** Whether a named capability may be presented as usable. */
export function isLive(name: string): boolean {
  return integrations.find((i) => i.name === name)?.status === "CONFIRMED";
}

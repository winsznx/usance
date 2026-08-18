#!/usr/bin/env node
/**
 * Measure how often the Chainlink feeds Usance depends on actually update.
 *
 *   make characterize-feeds
 *
 * A staleness threshold picked from a documentation heartbeat is a guess dressed as a number. A
 * heartbeat is the *maximum* interval a feed promises between updates when nothing moves; it says
 * nothing about the distribution, and a threshold set at exactly the heartbeat rejects every honest
 * feed that publishes one second late.
 *
 * So this walks real rounds and records what the feed did. Aggregator proxies encode a phase in the
 * high 64 bits of `roundId`, and the low 64 bits are the round within that phase, so walking
 * backwards means decrementing the low half and stopping at a phase boundary rather than blindly
 * subtracting one.
 *
 * X Layer testnet publishes no Chainlink feeds at all, which is why Usance deploys labelled
 * stand-ins there. Cadence is therefore measured on mainnet, where the feeds are real, and the
 * resulting policy is what a mainnet deployment would use. That distinction is recorded in the
 * artifact rather than glossed.
 */
import { createPublicClient, http, parseAbi } from "viem";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { writeArtifact, repoRoot, digestOf } from "./_artifact.mjs";

const AGG = parseAbi([
  "function decimals() view returns (uint8)",
  "function description() view returns (string)",
  "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
  "function getRoundData(uint80 _roundId) view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
]);

// Read from docs/INTEGRATIONS.md rather than a second hard-coded list. Two lists of the same
// addresses is one list that will eventually be wrong.
const INTEGRATIONS = readFileSync(resolve(repoRoot, "docs/INTEGRATIONS.md"), "utf8");
const FEEDS = [...INTEGRATIONS.matchAll(/^\|\s*([A-Z]+ \/ USD)\s*\|\s*`(0x[0-9a-fA-F]{40})`\s*\|\s*(\d+)\s*\|\s*(\d+)s\s*\|/gm)]
  .map(([, pair, address, decimals, heartbeat]) => ({ pair, address, decimals: Number(decimals), documentedHeartbeat: Number(heartbeat) }));

if (FEEDS.length === 0) {
  console.error("No feed table found in docs/INTEGRATIONS.md. Refusing to characterize an empty set.");
  process.exit(1);
}

const RPCS = [process.env.XLAYER_RPC_URL ?? "https://rpc.xlayer.tech", "https://xlayerrpc.okx.com"];
const ROUNDS = Number(process.env.USANCE_FEED_ROUNDS ?? 24);

const client = createPublicClient({ transport: http(RPCS[0], { retryCount: 4, retryDelay: 1500, timeout: 45_000 }) });

const chainId = await client.getChainId();
if (chainId !== 196) {
  console.error(`Expected X Layer mainnet (196) for feed characterization, got ${chainId}.`);
  process.exit(1);
}

const PHASE_MASK = (1n << 64n) - 1n;
const results = [];

for (const feed of FEEDS) {
  const row = { ...feed, observations: [], intervalsSeconds: [], errors: [] };
  try {
    const [roundId, , , updatedAt] = await client.readContract({ address: feed.address, abi: AGG, functionName: "latestRoundData" });
    row.latestRoundId = roundId.toString();
    row.latestUpdatedAt = Number(updatedAt);
    row.observations.push({ roundId: roundId.toString(), updatedAt: Number(updatedAt) });

    const phase = roundId >> 64n;
    let n = roundId & PHASE_MASK;

    for (let i = 1; i < ROUNDS && n > 1n; i++) {
      n -= 1n;
      const id = (phase << 64n) | n;
      try {
        const [, , , ts] = await client.readContract({ address: feed.address, abi: AGG, functionName: "getRoundData", args: [id] });
        if (Number(ts) === 0) break; // a round the aggregator does not have; stop rather than record a zero
        row.observations.push({ roundId: id.toString(), updatedAt: Number(ts) });
      } catch {
        // Historical rounds before a phase transition are not reachable through the proxy. Stopping
        // here is honest; padding the sample with the rounds we do have would understate the spread.
        row.errors.push(`history stops at round ${id} (phase boundary or pruned)`);
        break;
      }
    }

    const ts = row.observations.map((o) => o.updatedAt).sort((a, b) => b - a);
    for (let i = 0; i + 1 < ts.length; i++) row.intervalsSeconds.push(ts[i] - ts[i + 1]);

    if (row.intervalsSeconds.length > 0) {
      const sorted = [...row.intervalsSeconds].sort((a, b) => a - b);
      row.observedMinInterval = sorted[0];
      row.observedMedianInterval = sorted[Math.floor(sorted.length / 2)];
      row.observedMaxInterval = sorted[sorted.length - 1];
      row.sampleSize = row.intervalsSeconds.length;
      row.windowSeconds = ts[0] - ts[ts.length - 1];
    } else {
      row.note = "only the latest round was reachable; no interval could be measured";
    }
  } catch (e) {
    row.errors.push(e.shortMessage ?? e.message);
  }
  results.push(row);
  const summary = row.observedMaxInterval === undefined
    ? (row.errors[0] ?? "no interval measured")
    : `n=${row.sampleSize}  min ${row.observedMinInterval}s  median ${row.observedMedianInterval}s  max ${row.observedMaxInterval}s`;
  console.log(`  ${row.pair.padEnd(11)} ${summary}`);
}

const measured = results.filter((r) => r.observedMaxInterval !== undefined);
if (measured.length === 0) {
  console.error("\nNo feed yielded a measurable interval. Not writing an artifact for a run that measured nothing.");
  process.exit(1);
}

const worstObserved = Math.max(...measured.map((r) => r.observedMaxInterval));
const documentedHeartbeat = Math.max(...FEEDS.map((f) => f.documentedHeartbeat));

// The policy margin is a judgement, so it is written down as one rather than folded silently into
// a number. Two heartbeats means a feed has to miss two consecutive publications before Usance
// refuses new risk — enough that a single late round is not an outage, tight enough that a feed
// which has genuinely stopped is caught inside a day.
const recommended = {
  expectedUpdateCadenceSeconds: documentedHeartbeat,
  softStaleAgeSeconds: documentedHeartbeat,
  hardStaleAgeSeconds: documentedHeartbeat * 2,
  rationale:
    "Chainlink's heartbeat is the maximum interval between publications when the price does not " +
    "move, so it is an upper bound on healthy behaviour rather than a typical one. Soft equals one " +
    "heartbeat: past this the feed is late. Hard equals two: the feed has missed a full publication " +
    "cycle and new risk is refused. Only the hard bound is enforced onchain today.",
  observedMaxIntervalSeconds: worstObserved,
  observedMaxIsWithinHeartbeat: worstObserved <= documentedHeartbeat,
};

writeArtifact("artifacts/oracles/xlayer-mainnet-feeds.json", {
  chain: { id: chainId, name: "X Layer", rpc: RPCS[0] },
  measurement: {
    method: "backward round traversal through the aggregator proxy",
    roundsRequested: ROUNDS,
    note:
      "X Layer testnet publishes no Chainlink feeds, so cadence is measured on mainnet. The testnet " +
      "deployment uses labelled stand-in aggregators whose cadence is whatever a script sets and " +
      "says nothing about production behaviour.",
  },
  feeds: results,
  recommended,
}, {
  chainId,
  tool: "scripts/characterize-feeds.mjs",
  inputDigest: digestOf(FEEDS.map((f) => f.address).join(",")),
});

console.log("");
console.log(`  documented heartbeat   ${documentedHeartbeat}s`);
console.log(`  worst observed gap     ${worstObserved}s  (${recommended.observedMaxIsWithinHeartbeat ? "within" : "EXCEEDS"} the heartbeat)`);
console.log(`  recommended hard bound ${recommended.hardStaleAgeSeconds}s`);
console.log("");
console.log("Wrote artifacts/oracles/xlayer-mainnet-feeds.json");

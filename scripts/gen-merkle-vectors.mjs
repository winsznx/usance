/**
 * Generate Merkle conformance vectors from the TypeScript implementation.
 *
 * The offchain pipeline computes the root it intends to commit; PassportRegistry recomputes it
 * from the evidence cited. Those are two independent implementations of the same function, and if
 * they disagree anywhere, honest Passports are rejected onchain with no way to tell why. So the
 * TypeScript one emits vectors and Solidity is pinned against them.
 *
 * Leaf sets deliberately include the shapes that break naive implementations: a single leaf, an
 * odd count at more than one level, adjacent values, and values that straddle the signed/unsigned
 * boundary where a comparison written with `int256` would sort backwards.
 */
import { writeFileSync } from "node:fs";
import { keccak256, toHex } from "viem";
import { registerWorkspaceResolver } from "./_workspace.mjs";

registerWorkspaceResolver();
// Dynamic, so the resolver above is registered before this specifier is resolved. A static import
// is hoisted and resolved before the first statement runs.
const { merkleRoot } = await import("@usance/schemas");

const leaf = (s) => keccak256(toHex(s));

const cases = [
  { name: "single leaf is its own root", leaves: [leaf("a")] },
  { name: "two leaves", leaves: [leaf("a"), leaf("b")] },
  { name: "three leaves — odd node promoted, not duplicated", leaves: [leaf("a"), leaf("b"), leaf("c")] },
  { name: "four leaves — perfectly balanced", leaves: ["a", "b", "c", "d"].map(leaf) },
  { name: "five leaves — odd at two levels", leaves: ["a", "b", "c", "d", "e"].map(leaf) },
  { name: "seven leaves", leaves: ["a", "b", "c", "d", "e", "f", "g"].map(leaf) },
  { name: "eight leaves", leaves: ["a", "b", "c", "d", "e", "f", "g", "h"].map(leaf) },
  {
    name: "adjacent values — pair sorting must not collapse them",
    leaves: [`0x${"00".repeat(31)}01`, `0x${"00".repeat(31)}02`],
  },
  {
    // A comparison written over int256 sorts these the wrong way round: the high-bit value reads
    // as negative and lands first, producing a different root for the same set.
    name: "values straddling the signed boundary",
    leaves: [`0x7f${"ff".repeat(31)}`, `0x80${"00".repeat(31)}`],
  },
  { name: "minimum and maximum", leaves: [`0x${"00".repeat(31)}01`, `0x${"ff".repeat(32)}`] },
];

const vectors = cases.map((c) => ({
  name: c.name,
  // Sorted here so the Solidity side receives them in the strictly ascending order it requires.
  // The TS root is order-independent by construction; the contract makes the order explicit so it
  // does not have to spend gas rediscovering it.
  leaves: [...c.leaves].sort((a, b) => (BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0)),
  root: merkleRoot(c.leaves),
}));

// `count` is written out rather than derived, because forge's JSON path support has no length
// operator and a test that cannot count its own vectors silently passes on zero of them.
writeFileSync(
  "fixtures/canonical/merkle-vectors.json",
  JSON.stringify({ count: vectors.length, vectors }, null, 2) + "\n",
);
console.log(`wrote ${vectors.length} merkle vectors`);
for (const v of vectors) console.log(`  ${v.leaves.length} leaves  ${v.root}  ${v.name}`);

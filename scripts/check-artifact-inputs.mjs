#!/usr/bin/env node
/**
 * Refuse generated artifacts whose inputs have moved since they were produced.
 *
 *   node scripts/check-artifact-inputs.mjs
 *
 * `generatedAt` says when a file was written, not what it was written from, so freshness is judged
 * on digests. Each artifact records the digest of its own inputs; this recomputes those inputs and
 * compares. A mismatch means the artifact describes a world that has since changed, which is
 * exactly as useless as a missing one and considerably more convincing.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { repoRoot, digestOf, readArtifact } from "./_artifact.mjs";

/**
 * How to recompute each artifact's input digest.
 *
 * Deliberately per-artifact rather than generic: what counts as "the input" is a fact about the
 * tool that produced it, and a generic hash over everything would go stale on an unrelated edit and
 * train everyone to ignore this check.
 */
const ARTIFACTS = [
  {
    path: "artifacts/oracles/xlayer-mainnet-feeds.json",
    chainId: 196,
    inputs: () => {
      const doc = readFileSync(resolve(repoRoot, "docs/INTEGRATIONS.md"), "utf8");
      const feeds = [...doc.matchAll(/^\|\s*[A-Z]+ \/ USD\s*\|\s*`(0x[0-9a-fA-F]{40})`/gm)].map((m) => m[1]);
      return digestOf(feeds.join(","));
    },
  },
  {
    path: "artifacts/evidence/franklin-history.json",
    inputs: () => {
      const doc = JSON.parse(readFileSync(resolve(repoRoot, "artifacts/evidence/franklin-history.json"), "utf8"));
      return digestOf(doc.filings.map((f) => f.contentHash).join(","));
    },
  },
];

let failures = 0;

for (const a of ARTIFACTS) {
  if (!existsSync(resolve(repoRoot, a.path))) {
    console.error(`FAIL ${a.path} is missing. A run that produced no artifact failed.`);
    failures++;
    continue;
  }

  let expected;
  try {
    expected = a.inputs();
  } catch (e) {
    console.error(`FAIL ${a.path}: could not recompute its inputs — ${e.message}`);
    failures++;
    continue;
  }

  const r = readArtifact(a.path, { chainId: a.chainId, inputDigest: expected });
  if (r.ok) {
    console.log(`OK   ${a.path}`);
  } else {
    console.error(`FAIL ${a.path}`);
    for (const reason of r.reasons) console.error(`     ${reason}`);
    failures++;
  }
}

if (failures > 0) {
  console.error(`\n${failures} artifact(s) do not describe the current inputs.`);
  process.exit(1);
}
console.log("\nEvery generated artifact matches the inputs it was produced from.");

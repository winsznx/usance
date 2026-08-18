#!/usr/bin/env node
/**
 * Deliberately stale artifacts, and the gates that must reject them.
 *
 *   make test-artifact-freshness
 *
 * Three times in this repository a gate reported success while reading data that described a world
 * that no longer existed: a deployment manifest pointing at superseded contracts, a proof record
 * citing a retired registry, and a Slither run reading the previous run's JSON. Each was found by
 * accident. This finds them on purpose.
 *
 * Every attack mutates a real artifact, runs the real consumer, restores the artifact, and asserts
 * the consumer refused. An attack that the consumer survives is a hole, and the run fails.
 *
 * Nothing here is left mutated: each attack restores from an in-memory copy in a finally block, and
 * a final integrity check confirms the working tree matches what it started as.
 */
import { readFileSync, writeFileSync, existsSync, rmSync, cpSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { repoRoot, digestOf } from "./_artifact.mjs";

const results = [];

function run(cmd, args, opts = {}) {
  try {
    const out = execFileSync(cmd, args, { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...opts });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status ?? 1, out: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}

/**
 * @param name        what is being attacked
 * @param path        the artifact to corrupt, relative to the repo root
 * @param corrupt     mutate the file in place
 * @param check       run the consumer; return true when it REJECTED the stale artifact
 */
function attack(name, path, corrupt, check) {
  const full = resolve(repoRoot, path);
  const existed = existsSync(full);
  const original = existed ? readFileSync(full) : null;

  let rejected = false;
  let detail = "";
  try {
    corrupt(full);
    const r = check();
    rejected = r.rejected;
    detail = r.detail;
  } catch (e) {
    rejected = false;
    detail = `attack threw: ${e.message}`;
  } finally {
    if (original !== null) writeFileSync(full, original);
    else rmSync(full, { force: true });
  }

  results.push({ name, path, rejected, detail });
  console.log(`  ${rejected ? "REJECTED" : "ACCEPTED"}  ${name}`);
  if (detail) console.log(`            ${detail}`);
}

console.log("\nStale-artifact attacks\n");

// ---------------------------------------------------------------- 1. a superseded manifest
attack(
  "a manifest pointing at superseded contracts",
  "deployments/manifest.ts",
  (full) => {
    const s = readFileSync(full, "utf8");
    // The PassportRegistry from the previous deployment. It still has code and still answers every
    // wiring call, which is exactly why "does it have code" was never a sufficient check.
    const current = JSON.parse(readFileSync(resolve(repoRoot, "deployments/1952.json"), "utf8"))
      .contracts.passportRegistry;
    writeFileSync(full, s.replace(new RegExp(current, "gi"), "0x39a9186eb635ecd66b2c228e97b68f4d323df5da"));
  },
  () => {
    const r = run("node", ["scripts/live-xlayer.mjs"]);
    return { rejected: r.code !== 0, detail: (r.out.match(/on chain is \d+ bytes[^\n]*/) ?? [""])[0] };
  },
);

// ---------------------------------------------------------------- 2. a stale Slither report
attack(
  "a Slither gate reading the previous run's JSON",
  "contracts/.slither.json",
  (full) => {
    // The exact shape of the original bug: Slither refuses to overwrite an existing --json file and
    // exits without writing, so a leftover report is read as if it were this run's.
    writeFileSync(full, JSON.stringify({ success: true, results: { detectors: [] } }));
  },
  () => {
    const r = run("node", ["scripts/slither-triage.mjs"]);
    // The gate must not report "0 findings" off the planted empty report. It should delete it,
    // re-run, and see the real findings again.
    const sawReal = /1[0-9]{2} findings/.test(r.out);
    return { rejected: sawReal, detail: (r.out.match(/Slither: \d+ findings[^\n]*/) ?? ["no findings line"])[0] };
  },
);

// ---------------------------------------------------------------- 3. a proof citing a retired registry
attack(
  "a proof record citing a registry that no longer exists",
  "proof/passport-franklin-fobxx-2026-v1.json",
  (full) => {
    const d = JSON.parse(readFileSync(full, "utf8"));
    d.registries.passportRegistry = "0x39a9186eb635ecd66b2c228e97b68f4d323df5da";
    d.transactions = d.transactions.map((t) => ({ ...t, to: "0x39a9186eb635ecd66b2c228e97b68f4d323df5da" }));
    writeFileSync(full, JSON.stringify(d, null, 2));
  },
  () => {
    const r = run("node", ["scripts/check-proof-currency.mjs"]);
    return { rejected: r.code !== 0, detail: (r.out.match(/[^\n]*retired|[^\n]*superseded|[^\n]*not in the current[^\n]*/) ?? [""])[0].trim() };
  },
);

// ---------------------------------------------------------------- 4. a deleted artifact
attack(
  "an artifact deleted after its command reported success",
  "artifacts/oracles/xlayer-mainnet-feeds.json",
  (full) => rmSync(full, { force: true }),
  () => {
    const r = run("pnpm", ["--filter", "@usance/evidence", "vitest", "run", "test/artifact-freshness.test.ts"]);
    return { rejected: r.code !== 0, detail: "the consumer must fail, not treat absence as nothing to verify" };
  },
);

// ---------------------------------------------------------------- 5. an artifact whose input moved
attack(
  "an artifact whose input changed after it was generated",
  "artifacts/evidence/franklin-history.json",
  (full) => {
    const d = JSON.parse(readFileSync(full, "utf8"));
    d.$provenance.inputDigest = digestOf("a different set of filings entirely");
    writeFileSync(full, JSON.stringify(d, null, 2));
  },
  () => {
    const r = run("node", ["scripts/check-artifact-inputs.mjs"]);
    return { rejected: r.code !== 0, detail: (r.out.match(/[^\n]*input[^\n]*/) ?? [""])[0].trim() };
  },
);

// ---------------------------------------------------------------- verdict
const holes = results.filter((r) => !r.rejected);
console.log("");
console.log(`${results.length - holes.length} of ${results.length} stale artifacts were rejected.`);

// Every artifact this campaign corrupted must be exactly as it was. An attack that leaves damage
// behind is indistinguishable from the damage it was testing for.
//
// Scoped to the files the campaign touches rather than the whole tree: the campaign is meant to be
// runnable while other work is in progress, and failing on somebody's unrelated edit would train
// them to ignore it.
const touched = [...new Set(results.map((r) => r.path))];
const dirty = run("git", ["status", "--porcelain", "--", ...touched]).out.trim();
if (dirty) {
  console.error("\nThe attack campaign left artifacts modified:");
  console.error(dirty);
  process.exit(1);
}
console.log(`Restored exactly: ${touched.length} artifact(s) unchanged.`);

if (holes.length > 0) {
  console.error("");
  for (const h of holes) console.error(`  HOLE: ${h.name} was accepted by its consumer`);
  process.exit(1);
}

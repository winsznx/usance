#!/usr/bin/env node
/**
 * Move proof records that describe a genuinely superseded deployment into proof/historical/.
 *
 *   node scripts/archive-superseded-proofs.mjs <record.json> [<record.json> ...]
 *
 * A proof record for retired contracts is fine as history — the transactions still happened — it
 * just may not sit in proof/ claiming to be the live state (see scripts/check-proof-currency.mjs).
 * This copies the record to proof/historical/ with a $superseded block (the repo's immutable,
 * content-addressed archive) and removes it from proof/. It does not alter a single byte of the
 * record's evidence, and it never touches proof/historical/ entries that already exist.
 *
 * The transactions are not re-mined here. Regenerating against the current deployment is a separate
 * deliberate action (scripts/live-*.mjs) when the claim is still load-bearing and reproducible.
 */
import { existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { repoRoot, archiveArtifact } from "./_artifact.mjs";

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("usage: node scripts/archive-superseded-proofs.mjs <proof/record.json> ...");
  process.exit(1);
}

for (const f of files) {
  const rel = f.startsWith("proof/") ? f : `proof/${f}`;
  const full = resolve(repoRoot, rel);
  if (!existsSync(full)) {
    console.error(`  skip  ${rel} — does not exist`);
    continue;
  }
  const archived = archiveArtifact(rel, {
    reason: "the contracts this record was produced against were replaced by a later deployment",
  });
  if (!archived) {
    console.error(`  skip  ${rel} — archiveArtifact declined (already archived or unreadable)`);
    continue;
  }
  rmSync(full);
  console.log(`  moved ${rel}  ->  ${archived}`);
}
console.log("\nDone. Update proof/claims.json to cite the historical paths and the honest proof level.");

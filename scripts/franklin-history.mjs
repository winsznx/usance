#!/usr/bin/env node
/**
 * Semantic history for the Franklin FOBXX filings.
 *
 *   node --experimental-transform-types scripts/franklin-history.mjs
 *
 * Three summary prospectuses, a year apart. The question this answers is the one a risk system
 * actually has to answer about a re-filing: did anything change that changes what the asset *is*?
 *
 * The comparison is over normalized claims, never over document text. A prospectus is re-typeset
 * every year — pages move, boilerplate is rewritten, dates advance — and a diff that reports those
 * as changes is a diff nobody will read twice. What is compared is the extracted field values after
 * normalization, which is the same representation the Passport commits to.
 *
 * The classification is made by deterministic policy from the normalized diff. No model decides
 * whether something is a risk deterioration, because a model that could would be a model that sets
 * risk parameters.
 *
 * NO_MATERIAL_CHANGE is a successful outcome. If a fund's terms did not change between filings, the
 * honest report is that they did not change, and manufacturing a deterioration to make a demo more
 * dramatic is the exact failure this whole system exists to make impossible.
 */
import { registerWorkspaceResolver } from "./_workspace.mjs";
import { writeArtifact, digestOf } from "./_artifact.mjs";

registerWorkspaceResolver();
const { loadFixture, ingest, InMemoryObjectStore, diffFilings } = await import("@usance/evidence");
const { DeterministicParserExtractor } = await import("@usance/chaingpt");

const FIXTURES = ["franklin-fobxx-2024", "franklin-fobxx-2025", "franklin-fobxx-2026"];

async function extract(fixtureId) {
  const { entry, bytes } = await loadFixture(fixtureId);
  const store = new InMemoryObjectStore(() => entry.retrievedAt);
  const { document } = await ingest(
    {
      uri: entry.uri,
      issuerId: entry.issuer.issuerId,
      sourceClass: entry.sourceClass,
      bytes,
      mediaType: entry.mediaType,
      retrievedAt: entry.retrievedAt,
      effectiveAt: entry.effectiveAt,
      assertedSourceHash: entry.sourceHash,
      assertedContentHash: entry.contentHash,
    },
    store,
  );
  const extraction = await new DeterministicParserExtractor().extract(document);
  return {
    fixtureId,
    contentHash: document.contentHash,
    effectiveAt: document.effectiveAt,
    claims: new Map(extraction.claims.map((c) => [c.field, c.value])),
    claimCount: extraction.claims.length,
  };
}

const extracted = [];
for (const id of FIXTURES) {
  const e = await extract(id);
  extracted.push(e);
  console.log(`  ${id.padEnd(22)} ${e.claimCount} claims  content ${e.contentHash.slice(0, 14)}…`);
}

// The comparison itself lives in @usance/evidence and is unit-tested there, including the cases
// these three filings do not exercise: a withdrawn redemption, a lengthened window, a tightened
// transfer model. A script that carried its own copy of the policy would be a second implementation
// nobody tests, and the one that ran in production.
const snapshot = (e) => ({ id: e.fixtureId, contentHash: e.contentHash, claims: e.claims });
const transitions = [
  diffFilings(snapshot(extracted[0]), snapshot(extracted[1])),
  diffFilings(snapshot(extracted[1]), snapshot(extracted[2])),
];

console.log("");
for (const t of transitions) {
  console.log(`  ${t.from} → ${t.to}`);
  console.log(`    ${t.classification}`);
  console.log(`    ${t.materialChanges} material change(s), ${t.coverageDifferences} coverage difference(s)`);
  console.log(`    ${t.coverage.note}`);
  if (t.coverage.fieldsComparedOnBothSides > 0) {
    console.log(`    compared: ${t.coverage.comparedFields.join(", ")}`);
  }
  console.log(`    documents differ byte-for-byte: ${t.contentHashesDiffer}`);
  for (const c of t.changes) {
    console.log(`      ${c.kind === "VALUE_CHANGE" ? "CHANGED " : "COVERAGE"} ${c.group}/${c.field}${c.riskDirection ? `  ${c.riskDirection}` : ""}`);
    if (c.kind === "VALUE_CHANGE") console.log(`               ${JSON.stringify(c.from)} → ${JSON.stringify(c.to)}`);
  }
  console.log("");
}

writeArtifact("artifacts/evidence/franklin-history.json", {
  instrument: "franklin-fobxx",
  method:
    "Deterministic parser over each filing, compared on normalized claim values. Classification is " +
    "made by policy from the diff; no model decides whether a change is a risk deterioration.",
  filings: extracted.map((e) => ({
    fixtureId: e.fixtureId,
    contentHash: e.contentHash,
    effectiveAt: e.effectiveAt,
    claimCount: e.claimCount,
  })),
  transitions,
}, {
  tool: "scripts/franklin-history.mjs",
  inputDigest: digestOf(extracted.map((e) => e.contentHash).join(",")),
});

console.log("Wrote artifacts/evidence/franklin-history.json");

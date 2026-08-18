#!/usr/bin/env node
/**
 * Refuse proof records that describe a deployment which no longer exists.
 *
 *   node scripts/check-proof-currency.mjs
 *
 * A proof record is a claim about what happened on a specific set of contracts. When those
 * contracts are replaced the record does not become false — the transactions still happened — but
 * it stops describing the protocol anybody can interact with, and publishing it as current is the
 * failure this repository has hit before.
 *
 * The check is deliberately narrow: every contract address a record cites must belong to the
 * current deployment. Records for retired deployments are fine as history; they just may not sit in
 * `proof/` claiming to be the live state.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { repoRoot } from "./_artifact.mjs";

const manifestPath = resolve(repoRoot, "deployments/1952.json");
if (!existsSync(manifestPath)) {
  console.error("No deployment manifest. Cannot judge whether any proof record is current.");
  process.exit(1);
}

const deployment = JSON.parse(readFileSync(manifestPath, "utf8"));
const known = new Set(
  [
    ...Object.values(deployment.contracts),
    ...Object.values(deployment.testnetFixtures ?? {}),
  ]
    .filter((v) => typeof v === "string" && /^0x[0-9a-fA-F]{40}$/.test(v))
    .map((v) => v.toLowerCase()),
);

// The liquidation module is attached separately and records its own addresses.
const liqPath = resolve(repoRoot, "deployments/1952-liquidation.json");
if (existsSync(liqPath)) {
  const liq = JSON.parse(readFileSync(liqPath, "utf8"));
  for (const a of Object.values(liq.contracts ?? {})) known.add(String(a).toLowerCase());
  known.add(String(liq.liquidator ?? "").toLowerCase());
}

const proofDir = resolve(repoRoot, "proof");
let failures = 0;

for (const file of readdirSync(proofDir).filter((f) => f.endsWith(".json") && f !== "claims.json")) {
  const raw = readFileSync(resolve(proofDir, file), "utf8");
  const doc = JSON.parse(raw);

  // Every 40-hex address the record mentions, wherever it sits in the structure. Walking the text
  // rather than named fields, so a new field cannot quietly escape the check.
  //
  // The negative lookahead is load-bearing: without it the first forty characters of every
  // 66-character transaction hash match as an address, and the check reports four retired contracts
  // on a record that cites none.
  const cited = [
    ...new Set([...raw.matchAll(/0x[0-9a-fA-F]{40}(?![0-9a-fA-F])/g)].map((m) => m[0].toLowerCase())),
  ];
  const account = String(doc.account ?? "").toLowerCase();

  const retired = cited.filter((a) => !known.has(a) && a !== account && a !== `0x${"0".repeat(40)}`);
  if (retired.length > 0) {
    console.error(`FAIL ${file}`);
    console.error(`     cites ${retired.length} address(es) not in the current deployment:`);
    for (const a of retired) console.error(`       ${a}`);
    console.error("     The transactions are real, but the record no longer describes the live protocol.");
    console.error("     Regenerate it, or move it out of proof/ if it is being kept as history.");
    failures++;
  } else {
    console.log(`OK   ${file}  (${cited.length} addresses, all current)`);
  }
}

if (failures > 0) {
  console.error(`\n${failures} proof record(s) describe a superseded deployment.`);
  process.exit(1);
}
console.log("\nEvery proof record describes the current deployment.");

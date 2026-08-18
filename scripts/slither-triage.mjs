#!/usr/bin/env node
/**
 * Run Slither and fail only on findings nobody has looked at yet.
 *
 *   make slither
 *
 * Slither exits non-zero whenever it finds anything at all, so wiring it straight into a build
 * makes the gate permanently red — and a permanently red gate is one nobody reads. The useful
 * question is not "did the analyser say something" but "did it say something new".
 *
 * `slither-baseline.json` records every finding that has been triaged, keyed by detector and
 * location, each with the reason it is accepted. Anything outside that set fails the run. Baseline
 * entries that stop firing are reported too: a triage note for a finding that no longer exists is
 * stale documentation pointing at code that has moved.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync, writeFileSync, rmSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const baselinePath = resolve(repoRoot, "contracts/slither-baseline.json");
const write = process.argv.includes("--write-baseline");
const out = resolve(repoRoot, "contracts/.slither.json");

// Slither refuses to overwrite an existing --json file and exits without writing. Leaving a stale
// report in place made this gate read the previous run's findings and report "0 new" while an
// injected tx.origin check and a selfdestruct sat in the tree unnoticed. Delete first, and treat a
// report older than the run as no report at all.
rmSync(out, { force: true });

try {
  execFileSync("slither", [".", "--exclude-dependencies", "--filter-paths", "lib/|test/|script/",
    "--exclude-informational", "--exclude-optimization", "--json", out],
    { cwd: resolve(repoRoot, "contracts"), stdio: ["ignore", "ignore", "ignore"] });
} catch {
  // Slither exits non-zero when it finds anything. The JSON is what matters.
}

if (!existsSync(out)) {
  console.error("Slither produced no report. Is it installed?  pipx install slither-analyzer");
  console.error("A missing report is a failed run, never a clean one.");
  process.exit(1);
}
const report = JSON.parse(readFileSync(out, "utf8"));
if (!report.success) {
  console.error(`Slither failed to analyse the project: ${String(report.error).slice(0, 400)}`);
  process.exit(1);
}

/** Detector plus the first source element it points at. Stable across unrelated edits elsewhere. */
const keyOf = (r) => {
  const el = (r.elements ?? [])[0];
  const where = el ? `${el.type}:${el.name}` : "unknown";
  return `${r.check}@${where}`;
};

const findings = report.results.detectors;
const baseline = existsSync(baselinePath) ? JSON.parse(readFileSync(baselinePath, "utf8")) : { accepted: {} };

if (write) {
  // Re-seeding both adds and prunes. Keeping a triage note for a finding that no longer fires is
  // documentation pointing at code that has moved, and the gate reports those as failures — so the
  // fix has to actually remove them rather than leave them accumulating.
  const live = new Set(findings.map(keyOf));
  const accepted = {};
  const pruned = [];

  for (const f of findings) {
    accepted[keyOf(f)] = baseline.accepted[keyOf(f)] ?? { impact: f.impact, reason: "TRIAGE ME" };
  }
  for (const k of Object.keys(baseline.accepted)) if (!live.has(k)) pruned.push(k);

  writeFileSync(baselinePath, JSON.stringify({ accepted }, null, 2) + "\n");
  console.log(`Wrote ${Object.keys(accepted).length} entries. Every "TRIAGE ME" needs a real reason.`);
  for (const k of pruned) console.log(`  pruned, no longer fires: ${k}`);
  process.exit(0);
}

const untriaged = findings.filter((f) => !(keyOf(f) in baseline.accepted));
const untriagedReasons = Object.entries(baseline.accepted).filter(([, v]) => v.reason === "TRIAGE ME");
const seen = new Set(findings.map(keyOf));
const stale = Object.keys(baseline.accepted).filter((k) => !seen.has(k));

const byImpact = findings.reduce((a, f) => ({ ...a, [f.impact]: (a[f.impact] ?? 0) + 1 }), {});
console.log(`Slither: ${findings.length} findings  ${JSON.stringify(byImpact)}`);
console.log(`  ${findings.length - untriaged.length} triaged, ${untriaged.length} new`);

for (const f of untriaged) {
  console.log("");
  console.log(`  NEW  [${f.impact}] ${f.check}`);
  console.log(`       ${f.description.trim().split("\n")[0].slice(0, 160)}`);
  console.log(`       key: ${keyOf(f)}`);
}
for (const k of stale) {
  console.log(`  STALE baseline entry no longer fires: ${k}`);
}
for (const [k] of untriagedReasons) {
  console.log(`  UNREVIEWED baseline entry still says "TRIAGE ME": ${k}`);
}

const bad = untriaged.length + stale.length + untriagedReasons.length;
if (bad === 0) console.log("\nNo new findings.");
process.exit(bad === 0 ? 0 : 1);

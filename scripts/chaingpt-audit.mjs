#!/usr/bin/env node
/**
 * ChainGPT contract audit gate.
 *
 *   make audit-contracts
 *   make audit-contracts AUDIT_FLAGS=--allow-unavailable
 *
 * Sends every Solidity file under contracts/src to the ChainGPT smart-contract auditor through the
 * provider in packages/chaingpt, records the result under artifacts/security/chaingpt/, and decides
 * whether the build may proceed.
 *
 * The decision is the whole point, so it is stated up front:
 *
 *   0  the audit ran over every file and nothing survived review at or above the severity floor
 *   1  the audit ran and reported a finding at or above the floor
 *   2  the gate could not be configured (bad suppressions file, no sources, wrong Node)
 *   3  AUDIT_UNAVAILABLE — the audit did not happen
 *   4  the audit ran over only part of the tree
 *   5  the pipeline reported nothing on a contract that is known to be vulnerable
 *
 * 3 and 4 collapse to 0 only when --allow-unavailable is passed, which is how a non-protected
 * branch says "a missing credential is not this pull request's problem". A protected branch never
 * passes it, so on that branch an unrun audit is a red build. This asymmetry exists because a
 * green check that means "we did not look" is worse than no check at all: it is a check that
 * everybody trusts and nobody ran.
 *
 * 5 is never tolerated on any branch. Before the real tree is audited, one deliberately vulnerable
 * fixture goes through the same provider, prompt and parser, and the gate refuses to call anything
 * clean unless that fixture produces a finding. A missing third-party credential is somebody
 * else's outage; a detector that has stopped detecting is our defect, and the difference is why
 * the escape hatch covers one and not the other.
 *
 * The API key is read only by ChainGptClient, only from process.env, and is never printed, logged
 * or written to the artifact. This script never touches CHAINGPT_API_KEY; it asks the provider for
 * its status instead.
 */

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import * as nodeModule from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");

// ---------------------------------------------------------------------------------------------
// Loading the workspace's TypeScript from a plain Node script
// ---------------------------------------------------------------------------------------------
//
// packages/* are TypeScript with extensionless relative imports (./client, not ./client.js), which
// is what the rest of the repo is built around and is not something a CI script gets to change.
// Node strips types on its own but resolves specifiers exactly, so it needs the two mappings below.
// `--experimental-transform-types` is required rather than optional: three provider classes use
// constructor parameter properties, which strip-only mode rejects outright.
//
// The alternative was a bundler devDependency at the repository root. That would mean the audit
// gate could break on a dependency upgrade unrelated to it, so this uses only what Node ships.

if (typeof nodeModule.registerHooks !== "function") {
  die(
    2,
    `Node ${process.versions.node} has no module.registerHooks (added in 22.15). ` +
      `The audit gate cannot load the workspace TypeScript, so it has not run.`,
  );
}

function typescriptModule(url) {
  return { url, format: "module-typescript", shortCircuit: true };
}

nodeModule.registerHooks({
  resolve(specifier, context, nextResolve) {
    const workspacePackage = /^@usance\/([a-z][a-z0-9-]*)$/.exec(specifier);
    if (workspacePackage) {
      const entry = join(repoRoot, "packages", workspacePackage[1], "src", "index.ts");
      // Resolved from the repository layout rather than through node_modules so the two module
      // graphs (this script's and the one packages/chaingpt links against) are the same files.
      if (existsSync(entry)) return typescriptModule(pathToFileURL(entry).href);
    }

    if (specifier.startsWith(".") && !/\.[cm]?[jt]s$/.test(specifier) && context.parentURL) {
      const base = new URL(specifier, context.parentURL).href;
      for (const candidate of [`${base}.ts`, `${base}/index.ts`]) {
        if (existsSync(fileURLToPath(candidate))) return typescriptModule(candidate);
      }
    }

    return nextResolve(specifier, context);
  },
});

// ---------------------------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------------------------

const argv = process.argv.slice(2);
const hasFlag = (name) => argv.includes(`--${name}`);
const option = (name, fallback) => {
  const prefix = `--${name}=`;
  const found = argv.find((a) => a.startsWith(prefix));
  return found === undefined ? fallback : found.slice(prefix.length);
};

if (hasFlag("help") || hasFlag("h")) {
  process.stdout.write(`
ChainGPT contract audit gate

  node --experimental-transform-types scripts/chaingpt-audit.mjs [options]

  --allow-unavailable   treat "the audit did not run" and "the audit ran over part of the tree"
                        as exit 0. The artifact still records what happened. CI passes this on
                        every branch except a protected one. It never tolerates a failed control.
  --floor=SEVERITY      override the severityFloor in .chaingpt-suppressions.json
  --commit=SHA          label the run with this commit instead of deriving one
  --timeout-ms=N        wall-clock ceiling for the whole audit (default 900000)
  --help                this text

Exit: 0 clean, 1 findings at or above the floor, 2 misconfigured, 3 audit did not run,
4 partial coverage, 5 the positive control produced no finding.
`);
  process.exit(0);
}

const allowUnavailable = hasFlag("allow-unavailable");
const timeoutMs = Number(option("timeout-ms", "900000"));
if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) die(2, `--timeout-ms must be a positive number`);

// ---------------------------------------------------------------------------------------------
// The bundle
// ---------------------------------------------------------------------------------------------

// Every directory under contracts/src, named rather than globbed, so a new top-level directory is
// a deliberate edit here instead of silently joining or silently missing the audit.
const SOURCE_ROOTS = ["core", "adapters", "libraries", "interfaces"];

function collectSolidity(absDir, relPrefix) {
  const out = [];
  for (const entry of readdirSync(absDir).sort()) {
    const abs = join(absDir, entry);
    const rel = `${relPrefix}/${entry}`;
    if (statSync(abs).isDirectory()) out.push(...collectSolidity(abs, rel));
    else if (entry.endsWith(".sol")) out.push({ path: rel, source: readFileSync(abs, "utf8") });
  }
  return out;
}

const files = [];
const missingRoots = [];
for (const root of SOURCE_ROOTS) {
  const abs = join(repoRoot, "contracts", "src", root);
  if (!existsSync(abs)) {
    missingRoots.push(root);
    continue;
  }
  files.push(...collectSolidity(abs, `contracts/src/${root}`));
}

if (files.length === 0) {
  die(2, `no Solidity sources found under contracts/src/{${SOURCE_ROOTS.join(",")}}`);
}

const foundryToml = join(repoRoot, "contracts", "foundry.toml");
const solcVersion = (/^\s*solc_version\s*=\s*"([^"]+)"/m.exec(
  existsSync(foundryToml) ? readFileSync(foundryToml, "utf8") : "",
) ?? [])[1];
if (!solcVersion) die(2, `could not read solc_version from contracts/foundry.toml`);

// Identifies the exact sources that were audited, independently of what git thinks. A commit sha
// on a dirty tree names something other than what was sent.
const sourceDigest = createHash("sha256")
  .update(files.map((f) => `${f.path}\n${f.source.length}\n${f.source}`).join("\n"))
  .digest("hex");

const { commit, commitSource, dirty } = resolveCommit(sourceDigest);

function resolveCommit(digest) {
  const explicit = option("commit", null);
  if (explicit) return { commit: explicit, commitSource: "flag", dirty: null };
  if (process.env.GITHUB_SHA) {
    return { commit: process.env.GITHUB_SHA, commitSource: "GITHUB_SHA", dirty: null };
  }
  const git = (args) => execFileSync("git", args, { cwd: repoRoot, stdio: ["ignore", "pipe", "ignore"] }).toString();
  try {
    return {
      commit: git(["rev-parse", "HEAD"]).trim(),
      commitSource: "git",
      dirty: git(["status", "--porcelain"]).trim() !== "",
    };
  } catch {
    // Unborn HEAD or an export with no history. The sources still need a stable name, and naming
    // them after their own digest is the one label that cannot be wrong.
    return { commit: `nogit-${digest.slice(0, 16)}`, commitSource: "source-digest", dirty: null };
  }
}

// ---------------------------------------------------------------------------------------------
// Suppression policy
// ---------------------------------------------------------------------------------------------

const SEVERITIES = ["INFO", "LOW", "MEDIUM", "HIGH", "CRITICAL"];
const SUPPRESSIONS_PATH = join(repoRoot, ".chaingpt-suppressions.json");
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function loadSuppressions() {
  if (!existsSync(SUPPRESSIONS_PATH)) {
    die(2, `.chaingpt-suppressions.json is missing. The gate will not decide against an absent policy.`);
  }

  let doc;
  try {
    doc = JSON.parse(readFileSync(SUPPRESSIONS_PATH, "utf8"));
  } catch (e) {
    die(2, `.chaingpt-suppressions.json is not valid JSON: ${e.message}`);
  }

  const unknown = Object.keys(doc).filter(
    (k) => !k.startsWith("_") && k !== "severityFloor" && k !== "suppressions",
  );
  if (unknown.length > 0) die(2, `.chaingpt-suppressions.json has unknown keys: ${unknown.join(", ")}`);

  const floor = option("floor", doc.severityFloor);
  if (!SEVERITIES.includes(floor)) {
    die(2, `severityFloor must be one of ${SEVERITIES.join(", ")}, got ${JSON.stringify(floor)}`);
  }
  if (!Array.isArray(doc.suppressions)) die(2, `.chaingpt-suppressions.json: suppressions must be an array`);

  const entries = doc.suppressions.map((raw, i) => {
    const at = `.chaingpt-suppressions.json suppressions[${i}]`;
    const bad = (msg) => die(2, `${at}: ${msg}`);
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) bad("must be an object");
    const allowed = ["findingId", "reason", "reviewer", "addedOn", "expiresOn"];
    const extra = Object.keys(raw).filter((k) => !allowed.includes(k));
    if (extra.length > 0) bad(`unknown keys ${extra.join(", ")}`);
    if (typeof raw.findingId !== "string" || raw.findingId.length === 0) bad("findingId must be a non-empty string");
    // A short reason is how a suppression outlives the reasoning behind it. 40 characters does not
    // make an argument good, but it makes an absent one visible.
    if (typeof raw.reason !== "string" || raw.reason.trim().length < 40) {
      bad("reason must be at least 40 characters and say why the finding does not apply here");
    }
    if (typeof raw.reviewer !== "string" || raw.reviewer.trim().length === 0) bad("reviewer must name a person");
    if (typeof raw.addedOn !== "string" || !DATE.test(raw.addedOn)) bad("addedOn must be YYYY-MM-DD");
    if (raw.expiresOn !== null && (typeof raw.expiresOn !== "string" || !DATE.test(raw.expiresOn))) {
      bad("expiresOn must be YYYY-MM-DD or null");
    }
    return raw;
  });

  const ids = entries.map((e) => e.findingId);
  const duplicate = ids.find((id, i) => ids.indexOf(id) !== i);
  if (duplicate) die(2, `.chaingpt-suppressions.json suppresses ${duplicate} twice`);

  return { floor, entries };
}

const { floor, entries: suppressions } = loadSuppressions();
const today = new Date().toISOString().slice(0, 10);
const expired = suppressions.filter((s) => s.expiresOn !== null && s.expiresOn < today);
const active = new Map(suppressions.filter((s) => !expired.includes(s)).map((s) => [s.findingId, s]));

// ---------------------------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------------------------

const { ChainGptContractAuditor } = await import("@usance/chaingpt");
const { auditReportSchema, severityAtLeast } = await import("@usance/schemas");

const auditor = new ChainGptContractAuditor();
const bundle = { commit, solcVersion, files };

// Measured against the live auditor on 2026-08-17 by injecting one unguarded external call before a
// balance decrement into real files of increasing size. Reported at 8,620 characters of source,
// silent at 9,651 on the identical defect, with the response arriving faster than the small inputs.
// Above this line NO_FINDINGS means "the provider did not analyse it", which is not the same
// sentence as "there is nothing wrong", and the artifact has to be able to tell them apart.
const ANALYSABLE_SOURCE_CHARS = 9_000;
const oversized = files.filter((f) => f.source.length >= ANALYSABLE_SOURCE_CHARS).map((f) => f.path);

console.log("");
console.log(`ChainGPT contract audit`);
console.log(`  provider    ${auditor.name} (${auditor.status()})`);
console.log(`  commit      ${commit}  (from ${commitSource}${dirty === true ? ", dirty tree" : ""})`);
console.log(`  sources     ${files.length} files, solc ${solcVersion}, digest ${sourceDigest.slice(0, 16)}`);
console.log(`  floor       ${floor}`);
if (missingRoots.length > 0) console.log(`  note        no such directory: ${missingRoots.join(", ")}`);
console.log("");

const deadline = new AbortController();
const timer = setTimeout(() => deadline.abort(), timeoutMs);
timer.unref();

const runAudit = async (b) => {
  try {
    return auditReportSchema.parse(await auditor.audit(b, deadline.signal));
  } catch (e) {
    // A throw here is the gate itself failing, not a verdict on the contracts. It must never read
    // as either a pass or a finding.
    die(2, `the audit gate failed before producing a report: ${e instanceof Error ? e.message : String(e)}`);
  }
};

const control = await runControl();
let report;

if (control.detectorDead || control.ran === false) {
  // Nothing about the real tree can be learnt through a pipeline that just failed to report a
  // known defect, so the remaining requests are not sent and the run is recorded as unavailable.
  report = auditReportSchema.parse({
    provider: auditor.name,
    commit,
    producedAt: Math.floor(Date.now() / 1000),
    status: "AUDIT_UNAVAILABLE",
    findings: [],
    skipped: files.map((f) => f.path),
    unavailableReason: control.reason,
  });
} else {
  if (auditor.status() === "available") {
    console.log(`  one request per file, spaced by the client's rate limiter — this takes a few minutes`);
    console.log("");
  }
  report = await runAudit(bundle);
}

clearTimeout(timer);

/**
 * Audit one deliberately vulnerable fixture through the same provider, prompt and parser as the
 * real tree.
 *
 * This is the difference between "no findings" and "no detector". Every layer between here and the
 * model can fail silently into an empty finding list — a prompt the model stops following, a
 * response shape the parser stops recognising, an input the provider quietly refuses — and every
 * one of those failures is indistinguishable from a clean contract at this level.
 *
 * One of those failures is live today, which is why this exists rather than being a precaution.
 * `parseFindings` discards every finding as soon as NO_FINDINGS appears anywhere in the response,
 * and the model appends that line after real findings most of the time. Until that is fixed this
 * control fires intermittently, and each time it fires it is telling the truth.
 */
async function runControl() {
  const path = "fixtures/audit-control/ReentrantVault.sol";
  const abs = join(repoRoot, path);
  if (!existsSync(abs)) die(2, `the positive control ${path} is missing, so the gate cannot verify itself`);
  const source = readFileSync(abs, "utf8");

  if (auditor.status() !== "available") {
    return {
      path,
      ran: false,
      findingCount: 0,
      severities: [],
      detectorDead: false,
      reason: "CHAINGPT_API_KEY is not configured",
    };
  }

  const controlReport = await runAudit({ commit: `${commit}+control`, solcVersion, files: [{ path, source }] });

  if (controlReport.status === "AUDIT_UNAVAILABLE") {
    return {
      path,
      ran: false,
      findingCount: 0,
      severities: [],
      detectorDead: false,
      reason: `the positive control could not be audited: ${controlReport.unavailableReason}`,
    };
  }

  const findingCount = controlReport.findings.length;
  return {
    path,
    ran: true,
    findingCount,
    severities: controlReport.findings.map((f) => f.severity),
    detectorDead: findingCount === 0,
    reason:
      findingCount === 0
        ? `the positive control ${path} produced no finding, so this pipeline cannot report one`
        : null,
  };
}

const skippedPaths = new Set(report.skipped.map((entry) => entry.split(": ")[0]));
const audited = files.map((f) => f.path).filter((p) => !skippedPaths.has(p));

const suppressed = report.findings.filter((f) => active.has(f.findingId));
const surviving = report.findings.filter((f) => !active.has(f.findingId));
const blocking = surviving.filter((f) => severityAtLeast(f.severity, floor));

// ---------------------------------------------------------------------------------------------
// Artifact
// ---------------------------------------------------------------------------------------------

const artifactDir = join(repoRoot, "artifacts", "security", "chaingpt");
mkdirSync(artifactDir, { recursive: true });
const artifactPath = join(artifactDir, `${commit.replace(/[^A-Za-z0-9._-]/g, "_")}.json`);

const exitCode = decide();

writeFileSync(
  artifactPath,
  `${JSON.stringify(
    {
      artifactVersion: 1,
      commit,
      commitSource,
      workingTreeDirty: dirty,
      sourceDigestSha256: sourceDigest,
      bundle: {
        solcVersion,
        roots: SOURCE_ROOTS,
        fileCount: files.length,
        sourceChars: Object.fromEntries(files.map((f) => [f.path, f.source.length])),
      },
      coverage: {
        audited,
        // Carries the provider's reason string, so "the model rejected this file" and "the request
        // timed out" stay distinguishable a month later.
        skipped: report.skipped,
        /** Audited, but larger than the provider was measured to analyse. See ANALYSABLE_SOURCE_CHARS. */
        aboveMeasuredAnalysableSize: oversized,
        analysableSourceCharsThreshold: ANALYSABLE_SOURCE_CHARS,
      },
      gate: {
        severityFloor: floor,
        exitCode,
        control,
        blockingFindingIds: blocking.map((f) => f.findingId),
        suppressedFindingIds: suppressed.map((f) => f.findingId),
        expiredSuppressionIds: expired.map((s) => s.findingId),
        allowUnavailable,
      },
      report,
    },
    null,
    2,
  )}\n`,
);

// ---------------------------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------------------------

function decide() {
  // Checked first and never tolerated: every other verdict is read through the detector, so a dead
  // detector makes the rest of this report meaningless rather than merely incomplete.
  if (control.detectorDead) return 5;
  if (report.status === "AUDIT_UNAVAILABLE") return allowUnavailable ? 0 : 3;
  if (report.skipped.length > 0) return blocking.length > 0 ? 1 : allowUnavailable ? 0 : 4;
  return blocking.length > 0 ? 1 : 0;
}

const counts = SEVERITIES.map((s) => [s, surviving.filter((f) => f.severity === s).length]).filter(
  ([, n]) => n > 0,
);

if (control.detectorDead) {
  console.log(`  ####################################################################`);
  console.log(`  #  POSITIVE CONTROL FAILED — THIS GATE CANNOT REPORT A FINDING     #`);
  console.log(`  ####################################################################`);
  console.log("");
  console.log(`  control     ${control.path}`);
  console.log(`  findings    0`);
  console.log("");
  console.log(`  That fixture sends Ether with a low-level call and decrements the balance`);
  console.log(`  afterwards. The pipeline reported nothing on it, so either the provider stopped`);
  console.log(`  detecting the defect or the response parser is discarding findings — see`);
  console.log(`  parseFindings in packages/chaingpt/src/auditor.ts.`);
  console.log("");
  console.log(`  No file in contracts/src was audited. A pipeline that cannot fail a known-bad`);
  console.log(`  contract cannot pass a real one.`);
} else if (report.status === "AUDIT_UNAVAILABLE") {
  console.log(`  ####################################################################`);
  console.log(`  #  AUDIT_UNAVAILABLE — NO AUDIT WAS PERFORMED                      #`);
  console.log(`  ####################################################################`);
  console.log("");
  console.log(`  reason      ${report.unavailableReason}`);
  console.log(`  covered     0 of ${files.length} files`);
  console.log("");
  console.log(`  This is not a pass and not a finding. Nothing was checked.`);
} else {
  console.log(`  status      COMPLETED`);
  console.log(`  control     ${control.findingCount} finding(s) on ${control.path} — detector alive`);
  console.log(`  covered     ${audited.length} of ${files.length} files`);
  console.log(
    `  findings    ${surviving.length}${counts.length > 0 ? ` (${counts.map(([s, n]) => `${n} ${s}`).join(", ")})` : ""}`,
  );
  if (suppressed.length > 0) console.log(`  suppressed  ${suppressed.length}`);
  console.log("");

  for (const path of report.skipped) console.log(`  NO COVERAGE  ${path}`);
  if (report.skipped.length > 0) console.log("");

  for (const path of oversized) {
    const chars = files.find((f) => f.path === path).source.length;
    console.log(`  OVERSIZED    ${path} (${chars} chars) — beyond the measured analysable input`);
  }
  if (oversized.length > 0) {
    console.log("");
    console.log(`  The provider was measured to stop analysing somewhere between 8,620 and 9,651`);
    console.log(`  characters of source. On the files above, no finding is weak evidence, not good`);
    console.log(`  evidence. Forge tests, Slither and review carry those files, not this gate.`);
    console.log("");
  }

  for (const f of [...surviving].sort(
    (a, b) => SEVERITIES.indexOf(b.severity) - SEVERITIES.indexOf(a.severity),
  )) {
    const gated = severityAtLeast(f.severity, floor) ? "BLOCKS" : "note  ";
    console.log(`  ${gated} ${f.severity.padEnd(8)} ${f.contract}${f.line === null ? "" : `:${f.line}`}`);
    console.log(`         ${f.title}`);
    console.log(`         ${f.findingId}`);
    console.log("");
  }
}

for (const s of expired) {
  console.log(`  EXPIRED SUPPRESSION  ${s.findingId} (expired ${s.expiresOn}) — it no longer suppresses`);
}

console.log(`  artifact    ${artifactPath.slice(repoRoot.length + 1)}`);
console.log("");

switch (exitCode) {
  case 0:
    if (report.status === "AUDIT_UNAVAILABLE") {
      console.log(`TOLERATED: --allow-unavailable was passed, so an unrun audit does not block this branch.`);
    } else if (report.skipped.length > 0) {
      console.log(`TOLERATED: --allow-unavailable was passed, so partial coverage does not block this branch.`);
    } else if (oversized.length > 0) {
      console.log(`PASS: all ${files.length} files audited, nothing reached ${floor}.`);
      console.log(`      ${oversized.length} of them exceed the provider's measured analysable size and are`);
      console.log(`      therefore not covered in any useful sense. This is not a clean bill of health.`);
    } else {
      console.log(`PASS: every file was audited and nothing reached ${floor}.`);
    }
    break;
  case 1:
    console.log(`FAIL: ${blocking.length} finding(s) at or above ${floor}.`);
    console.log(`      Fix them, or record a reviewed judgement in .chaingpt-suppressions.json.`);
    break;
  case 3:
    console.log(`FAIL: the audit did not run. Pass --allow-unavailable to tolerate that on this branch.`);
    break;
  case 4:
    console.log(`FAIL: ${report.skipped.length} file(s) have no audit coverage, so this run is not a clean audit.`);
    console.log(`      Pass --allow-unavailable to tolerate partial coverage on this branch.`);
    break;
  case 5:
    console.log(`FAIL: the positive control produced no finding. This gate is broken, not satisfied.`);
    console.log(`      --allow-unavailable deliberately does not cover this: it is our defect, not an outage.`);
    break;
  default:
    break;
}
console.log("");
process.exit(exitCode);

function die(code, message) {
  console.error("");
  console.error(`AUDIT GATE ERROR: ${message}`);
  console.error("");
  process.exit(code);
}

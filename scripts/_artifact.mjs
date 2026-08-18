/**
 * Provenance for generated verification artifacts.
 *
 * The same failure showed up three times in one session: a deployment manifest describing
 * superseded contracts, a proof record citing a retired registry, and a Slither gate reading the
 * previous run's JSON because Slither refuses to overwrite an existing output file. In every case
 * the consumer checked that a file existed, found one, and reported success.
 *
 * So an artifact carries what it takes to prove it is current, and a failed run is never allowed to
 * leave the previous successful artifact looking fresh. `writeArtifact` builds into a temporary path
 * and renames only after the caller has produced a complete value; a rename on the same filesystem
 * is atomic, so a reader sees the old file or the new one and never a half-written one.
 *
 *     NO FRESH DATA != SUCCESS
 */
import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function gitCommit() {
  try {
    const sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot }).toString().trim();
    const dirty = execFileSync("git", ["status", "--porcelain"], { cwd: repoRoot }).toString().trim().length > 0;
    return dirty ? `${sha}-dirty` : sha;
  } catch {
    return "unknown";
  }
}

export function digestOf(value) {
  const bytes = typeof value === "string" || Buffer.isBuffer(value) ? value : JSON.stringify(value);
  return `0x${createHash("sha256").update(bytes).digest("hex")}`;
}

/** Digest of the deployment manifest an artifact was produced against, or null when not applicable. */
export function deploymentDigest(chainId) {
  const p = resolve(repoRoot, `deployments/${chainId}.json`);
  return existsSync(p) ? digestOf(readFileSync(p, "utf8")) : null;
}

/**
 * Write `body` with a provenance block, atomically.
 *
 * `generatedAt` is a wall-clock timestamp and is deliberately NOT what freshness is judged on — a
 * clock says when a file was written, not what it was written from. The load-bearing fields are the
 * digests: `inputDigest` and `deploymentDigest` change when the thing being described changes, and
 * a checker compares those rather than trusting a date.
 */
/**
 * Move an existing artifact aside before it is replaced.
 *
 * A proof record describes what happened on one deployment. When contracts are replaced the record
 * does not stop being true — it stops being *current*, and those are different things. Overwriting
 * it destroys evidence that was correct when it was written, and repointing the claims that cite it
 * at a newer transaction quietly rewrites history to match the present.
 *
 * So the superseded record is kept, named by the ClearingHouse it ran against, and marked. Claims
 * about the current deployment cite the new record; claims about what was proven before can still
 * resolve to the old one.
 */
export function archiveArtifact(relPath, { reason } = {}) {
  const full = resolve(repoRoot, relPath);
  if (!existsSync(full)) return null;

  const doc = JSON.parse(readFileSync(full, "utf8"));
  const contracts = doc.contracts ?? {};
  const stamp = (doc.clearingHouse ?? contracts.clearingHouse ?? doc.chainId ?? "unknown")
    .toString()
    .slice(2, 12) || "unknown";

  const dir = resolve(repoRoot, "proof/historical");
  mkdirSync(dir, { recursive: true });
  const base = relPath.split("/").pop().replace(/\.json$/, "");
  const target = resolve(dir, `${base}-${stamp}.json`);
  if (existsSync(target)) return target;

  doc.$superseded = {
    archivedAt: new Date().toISOString(),
    reason: reason ?? "the contracts this record was produced against were replaced",
    note:
      "Still true of the deployment it ran on. Kept rather than overwritten because a proof record " +
      "that stops being current does not stop being accurate, and repointing the claims that cite " +
      "it would rewrite history to match the present.",
  };
  writeFileSync(target, JSON.stringify(doc, null, 2) + "\n");
  return `proof/historical/${base}-${stamp}.json`;
}

export function writeArtifact(relPath, body, { chainId, inputDigest, tool, run } = {}) {
  const full = resolve(repoRoot, relPath);
  mkdirSync(dirname(full), { recursive: true });

  const doc = {
    $provenance: {
      generatedAt: new Date().toISOString(),
      generatedBy: relPath.startsWith("artifacts/") ? tool ?? "unknown" : tool ?? "unknown",
      gitCommit: gitCommit(),
      ...(chainId === undefined ? {} : { chainId, deploymentDigest: deploymentDigest(chainId) }),
      ...(inputDigest === undefined ? {} : { inputDigest }),
      ...(run === undefined ? {} : { run }),
      schema: 1,
    },
    ...body,
  };

  const tmp = `${full}.tmp-${process.pid}`;
  try {
    writeFileSync(tmp, JSON.stringify(doc, null, 2) + "\n");
    renameSync(tmp, full);
  } catch (e) {
    rmSync(tmp, { force: true });
    throw e;
  }
  return doc;
}

/**
 * Read an artifact and refuse it when it does not describe the current world.
 *
 * Returns `{ ok, doc, reasons }`. A missing file is not ok — a check that produced no artifact
 * failed, and treating its absence as "nothing to verify" is how a green gate ends up sitting on
 * top of a run that never happened.
 */
export function readArtifact(relPath, { chainId, inputDigest, maxAgeSeconds } = {}) {
  const full = resolve(repoRoot, relPath);
  const reasons = [];
  if (!existsSync(full)) return { ok: false, doc: null, reasons: [`${relPath} does not exist; the run that produces it did not complete`] };

  const doc = JSON.parse(readFileSync(full, "utf8"));
  const p = doc.$provenance;
  if (!p) return { ok: false, doc, reasons: [`${relPath} has no provenance block, so nothing about it can be trusted`] };

  if (chainId !== undefined) {
    if (p.chainId !== chainId) reasons.push(`built against chain ${p.chainId}, checked against ${chainId}`);
    const current = deploymentDigest(chainId);
    if (current && p.deploymentDigest && p.deploymentDigest !== current) {
      reasons.push("the deployment manifest changed after this artifact was produced");
    }
  }
  if (inputDigest !== undefined && p.inputDigest !== inputDigest) {
    reasons.push("the input changed after this artifact was produced");
  }
  if (maxAgeSeconds !== undefined) {
    const age = (Date.now() - Date.parse(p.generatedAt)) / 1000;
    if (!Number.isFinite(age)) reasons.push("generatedAt is unreadable");
    else if (age > maxAgeSeconds) reasons.push(`is ${Math.round(age / 3600)}h old, older than the ${Math.round(maxAgeSeconds / 3600)}h bound`);
  }
  return { ok: reasons.length === 0, doc, reasons };
}

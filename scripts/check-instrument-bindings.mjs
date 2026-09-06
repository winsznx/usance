/**
 * Refuse a hand-edited or stale deployments/instrument-bindings.json.
 *
 * Three checks:
 *   1. it validates against `instrumentBindingsArtifactSchema`;
 *   2. its `instruments` + `bindings` + input/deployment digests are byte-identical to a fresh
 *      run of `scripts/gen-instrument-bindings.mjs` (so a hand edit or a stale manifest fails);
 *   3. every `assetId` in `deployments/1952.json` and every `assetId` in `proof/*.json` resolves
 *      through the bindings — no historical id is left unbound.
 *
 * Exit non-zero on any failure. Restores the artifact exactly: a check that leaves damage behind
 * is indistinguishable from the damage.
 */
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { registerWorkspaceResolver, repoRoot } from "./_workspace.mjs";

registerWorkspaceResolver();
const { instrumentBindingsArtifactSchema, resolveInstrument } = await import("@usance/schemas");

const ARTIFACT = "deployments/instrument-bindings.json";
const full = resolve(repoRoot, ARTIFACT);
const failures = [];

const committedBytes = readFileSync(full, "utf8");
const committed = JSON.parse(committedBytes);

// 1. schema
const parsed = instrumentBindingsArtifactSchema.safeParse(committed);
if (!parsed.success) {
  failures.push(
    `schema: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
  );
}

// 2. byte-identical to a fresh run
let regenerated;
try {
  execFileSync(
    process.execPath,
    [
      "--experimental-transform-types",
      "--disable-warning=ExperimentalWarning",
      resolve(repoRoot, "scripts/gen-instrument-bindings.mjs"),
    ],
    { cwd: repoRoot, stdio: ["ignore", "ignore", "inherit"] },
  );
  regenerated = JSON.parse(readFileSync(full, "utf8"));
} finally {
  writeFileSync(full, committedBytes);
}

const stable = (d) => ({
  instruments: d.instruments,
  bindings: d.bindings,
  inputDigest: d.$provenance?.inputDigest,
  deploymentDigest: d.$provenance?.deploymentDigest,
});
if (regenerated && JSON.stringify(stable(committed)) !== JSON.stringify(stable(regenerated))) {
  failures.push(
    "the committed artifact is not what scripts/gen-instrument-bindings.mjs produces from the " +
      "current deployment manifest and identity inputs — regenerate it",
  );
}

// 3. coverage — every historical assetId resolves
const bindings = committed.bindings ?? [];
const wanted = new Map();

const manifest = JSON.parse(readFileSync(resolve(repoRoot, "deployments/1952.json"), "utf8"));
if (manifest.settlementAsset?.assetId) {
  wanted.set(manifest.settlementAsset.assetId.toLowerCase(), "1952.json settlementAsset");
}
if (manifest.testnetFixtures?.collateralAssetId) {
  wanted.set(manifest.testnetFixtures.collateralAssetId.toLowerCase(), "1952.json testnetFixtures");
}
for (const f of readdirSync(resolve(repoRoot, "proof"))) {
  if (!f.endsWith(".json")) continue;
  const doc = JSON.parse(readFileSync(resolve(repoRoot, "proof", f), "utf8"));
  if (typeof doc.assetId === "string" && /^0x[0-9a-fA-F]{64}$/.test(doc.assetId)) {
    wanted.set(doc.assetId.toLowerCase(), `proof/${f}`);
  }
}
for (const [assetId, source] of wanted) {
  if (!resolveInstrument(bindings, assetId)) {
    failures.push(`assetId ${assetId} (${source}) does not resolve through the bindings`);
  }
}

if (failures.length > 0) {
  console.error("instrument-bindings check FAILED:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(
  `instrument-bindings OK: ${committed.instruments.length} instruments, ` +
    `${committed.bindings.length} bindings, ${wanted.size} historical assetIds all resolve`,
);

/**
 * Refuse a hand-edited or stale deployments/facility-descriptors.json.
 *
 *   1. validates against `facilityDescriptorsArtifactSchema`;
 *   2. `domains` + `facilities` + digests are byte-identical to a fresh generator run;
 *   3. every facility's controller address matches the live deployment manifest — a redeploy of
 *      ClearingHouse changes the controller, and therefore the facilityId, and this catches it.
 *
 * Restores the artifact exactly.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { registerWorkspaceResolver, repoRoot } from "./_workspace.mjs";

registerWorkspaceResolver();
const { facilityDescriptorsArtifactSchema } = await import("@usance/schemas");

const ARTIFACT = "deployments/facility-descriptors.json";
const full = resolve(repoRoot, ARTIFACT);
const failures = [];

const committedBytes = readFileSync(full, "utf8");
const committed = JSON.parse(committedBytes);

const parsed = facilityDescriptorsArtifactSchema.safeParse(committed);
if (!parsed.success) {
  failures.push(
    `schema: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
  );
}

let regenerated;
try {
  execFileSync(
    process.execPath,
    [
      "--experimental-transform-types",
      "--disable-warning=ExperimentalWarning",
      resolve(repoRoot, "scripts/gen-facility-descriptors.mjs"),
    ],
    { cwd: repoRoot, stdio: ["ignore", "ignore", "inherit"] },
  );
  regenerated = JSON.parse(readFileSync(full, "utf8"));
} finally {
  writeFileSync(full, committedBytes);
}

const stable = (d) => ({
  domains: d.domains,
  facilities: d.facilities,
  inputDigest: d.$provenance?.inputDigest,
  deploymentDigest: d.$provenance?.deploymentDigest,
});
if (regenerated && JSON.stringify(stable(committed)) !== JSON.stringify(stable(regenerated))) {
  failures.push(
    "the committed artifact is not what scripts/gen-facility-descriptors.mjs produces from the " +
      "current deployment manifest and domain inputs — regenerate it",
  );
}

const manifest = JSON.parse(readFileSync(resolve(repoRoot, "deployments/1952.json"), "utf8"));
const liveController = manifest.contracts?.clearingHouse?.toLowerCase();
for (const f of committed.facilities ?? []) {
  if (
    f.homeDomainCaip2 === "eip155:1952" &&
    f.facilityType === "REVOLVING_CREDIT" &&
    f.controllerAddress?.toLowerCase() !== liveController
  ) {
    failures.push(
      `facility ${f.facilityId} controller ${f.controllerAddress} != live ClearingHouse ${liveController} ` +
        "— the deployment was replaced; this is a facility migration, not an edit",
    );
  }
}

if (failures.length > 0) {
  console.error("facility-descriptors check FAILED:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(
  `facility-descriptors OK: ${committed.domains.length} domains, ${committed.facilities.length} facilities, ` +
    "controllers match the live manifest",
);

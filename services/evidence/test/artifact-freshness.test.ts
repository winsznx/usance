import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createRequire } from "node:module";

const require_ = createRequire(import.meta.url);
const artifactPath = resolve(__dirname, "../../../scripts/_artifact.mjs");

/**
 * The standing rule, tested.
 *
 *   NO FRESH DATA != SUCCESS
 *
 * Three artifacts falsely reported success in one session because their consumer checked that a
 * file existed and found one: a deployment manifest describing superseded contracts, a proof record
 * citing a retired registry, and a Slither gate reading the previous run's JSON. Every one of them
 * would have been caught by asking "is this describing the world I am checking?" instead of "is
 * this here?".
 */
describe("generated artifacts prove their own freshness", () => {
  let mod: typeof import("../../../scripts/_artifact.mjs");
  let dir: string;

  beforeEach(async () => {
    mod = await import(artifactPath);
    dir = mkdtempSync(resolve(tmpdir(), "usance-artifact-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const rel = (name: string) => resolve(dir, name).replace(`${mod.repoRoot}/`, "");

  it("a written artifact carries commit, timestamp and schema", () => {
    const doc = mod.writeArtifact(rel("a.json"), { value: 1 }, { tool: "test" });
    expect(doc.$provenance.gitCommit).toMatch(/^[0-9a-f]{40}(-dirty)?$|^unknown$/);
    expect(doc.$provenance.generatedBy).toBe("test");
    expect(Date.parse(doc.$provenance.generatedAt)).toBeGreaterThan(0);
    expect(doc.$provenance.schema).toBe(1);
  });

  it("a missing artifact is a failure, never a clean result", () => {
    // The whole bug class in one assertion. "Nothing to verify" and "the run never happened" are
    // the same observation, and only one of them is safe to treat as success.
    const r = mod.readArtifact(rel("never-written.json"));
    expect(r.ok).toBe(false);
    expect(r.reasons[0]).toMatch(/did not complete/);
  });

  it("an artifact with no provenance block is refused", () => {
    writeFileSync(resolve(dir, "bare.json"), JSON.stringify({ value: 1 }));
    const r = mod.readArtifact(rel("bare.json"));
    expect(r.ok).toBe(false);
    expect(r.reasons[0]).toMatch(/no provenance/);
  });

  it("an artifact is refused when its input has changed", () => {
    mod.writeArtifact(rel("b.json"), { value: 1 }, { tool: "test", inputDigest: mod.digestOf("v1") });
    expect(mod.readArtifact(rel("b.json"), { inputDigest: mod.digestOf("v1") }).ok).toBe(true);

    const stale = mod.readArtifact(rel("b.json"), { inputDigest: mod.digestOf("v2") });
    expect(stale.ok).toBe(false);
    expect(stale.reasons[0]).toMatch(/input changed/);
  });

  it("an artifact is refused when it is older than its bound", () => {
    mod.writeArtifact(rel("c.json"), { value: 1 }, { tool: "test" });
    const doc = JSON.parse(readFileSync(resolve(dir, "c.json"), "utf8"));
    doc.$provenance.generatedAt = new Date(Date.now() - 90 * 3600 * 1000).toISOString();
    writeFileSync(resolve(dir, "c.json"), JSON.stringify(doc));

    const r = mod.readArtifact(rel("c.json"), { maxAgeSeconds: 24 * 3600 });
    expect(r.ok).toBe(false);
    expect(r.reasons[0]).toMatch(/older than/);
  });

  it("an artifact built against another chain is refused", () => {
    mod.writeArtifact(rel("d.json"), { value: 1 }, { tool: "test", chainId: 196 });
    const r = mod.readArtifact(rel("d.json"), { chainId: 1952 });
    expect(r.ok).toBe(false);
    expect(r.reasons.join(" ")).toMatch(/chain 196/);
  });

  it("a failed write leaves the previous artifact untouched rather than half-written", () => {
    mod.writeArtifact(rel("e.json"), { value: "first" }, { tool: "test" });
    const before = readFileSync(resolve(dir, "e.json"), "utf8");

    // A value JSON.stringify cannot serialise. The write must fail without touching the old file:
    // a truncated artifact is worse than a stale one, because it fails at parse time in whatever
    // consumer happens to read it next rather than at the gate.
    const circular: Record<string, unknown> = {};
    circular["self"] = circular;
    expect(() => mod.writeArtifact(rel("e.json"), circular as never, { tool: "test" })).toThrow();

    expect(readFileSync(resolve(dir, "e.json"), "utf8")).toBe(before);
    expect(existsSync(resolve(dir, "e.json"))).toBe(true);
  });
});

describe("the oracle characterization artifact", () => {
  const path = resolve(__dirname, "../../../artifacts/oracles/xlayer-mainnet-feeds.json");

  it("exists, and its measured bound justifies the configured threshold", async () => {
    const mod = await import(artifactPath);
    const r = mod.readArtifact("artifacts/oracles/xlayer-mainnet-feeds.json", { chainId: 196 });
    expect(r.ok, r.reasons.join("; ")).toBe(true);

    const doc = JSON.parse(readFileSync(path, "utf8"));
    const measured = doc.feeds.filter((f: { observedMaxInterval?: number }) => f.observedMaxInterval !== undefined);
    expect(measured.length).toBeGreaterThan(0);

    // The load-bearing measurement: the worst observed gap EXCEEDS the documented heartbeat, so a
    // threshold set at one heartbeat would reject feeds that are behaving normally. Two heartbeats
    // is above every gap actually seen.
    const worst = Math.max(...measured.map((f: { observedMaxInterval: number }) => f.observedMaxInterval));
    expect(worst).toBe(doc.recommended.observedMaxIntervalSeconds);
    expect(doc.recommended.hardStaleAgeSeconds).toBeGreaterThan(worst);
    expect(doc.recommended.hardStaleAgeSeconds).toBe(172_800);
  });
});

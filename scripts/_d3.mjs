import { existsSync } from "node:fs";
import nodeModule from "node:module";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const ts = (u) => ({ url: u, format: "module-typescript", shortCircuit: true });
nodeModule.registerHooks({ resolve(sp, cx, nx) {
  const w = /^@usance\/([a-z][a-z0-9-]*)$/.exec(sp);
  if (w) for (const r of ["packages","services"]) { const e = join(repoRoot,r,w[1],"src","index.ts"); if (existsSync(e)) return ts(pathToFileURL(e).href); }
  if (sp.startsWith(".") && !/\.[cm]?[jt]s$/.test(sp) && cx.parentURL) {
    const b = new URL(sp, cx.parentURL).href;
    for (const c of [`${b}.ts`, `${b}/index.ts`]) if (existsSync(fileURLToPath(c))) return ts(c);
  }
  return nx(sp, cx);
}});
const { loadManifest, loadFixture, decodeToText } = await import("@usance/evidence");
const s = await import("@usance/schemas");
const { ChainGptClient, ChainGptEvidenceExtractor } = await import("@usance/chaingpt");
const m = await loadManifest();
const e = m.documents.find(d => d.id === "franklin-fobxx-2026");
const f = await loadFixture("franklin-fobxx-2026");
const text = s.canonicalizeText(decodeToText(f.bytes, e.mediaType));
const doc = { evidenceId: e.evidenceId, contentHash: e.contentHash, sourceHash: e.sourceHash,
  sourceClass: e.sourceClass, canonicalizerVersion: s.CANONICALIZER_VERSION, mediaType: "text/plain",
  bytes: new TextEncoder().encode(text), retrievedAt: e.retrievedAt, effectiveAt: e.effectiveAt };
const cl = new ChainGptClient({ minIntervalMs: 500, timeoutMs: 240000 });
console.log("status:", cl.status(), "| chars:", text.length);
try {
  const r = await new ChainGptEvidenceExtractor(cl).extract(doc);
  console.log("KEPT:", r.claims.length);
  for (const c of r.claims) console.log("   +", c.field, JSON.stringify(c.value).slice(0,60));
  console.log("DROPPED:", r.warnings.length);
  for (const w of r.warnings) console.log("   -", w);
} catch (err) {
  console.log("THREW:", err.constructor.name, "|", String(err.message).slice(0,600));
}

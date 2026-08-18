/**
 * Let a plain .mjs script import the workspace's TypeScript packages.
 *
 * `packages/*` and `services/*` are TypeScript with extensionless relative imports. Node strips
 * types but resolves specifiers exactly, so both mappings are needed: `@usance/x` to its source
 * entry, and `./thing` to `./thing.ts` or `./thing/index.ts`.
 *
 * Resolution goes through the repository layout rather than node_modules so a script and the
 * packages it loads share one module graph. Two copies of the same module means two copies of
 * every module-level constant, and the resulting bugs look like the code is lying about itself.
 *
 * Call this before any dynamic import of a workspace package, and import those packages
 * dynamically — a static import is resolved before the first statement runs.
 */
import { existsSync } from "node:fs";
import nodeModule from "node:module";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

export function registerWorkspaceResolver() {
  const tsModule = (url) => ({ url, format: "module-typescript", shortCircuit: true });

  nodeModule.registerHooks({
    resolve(specifier, context, nextResolve) {
      const ws = /^@usance\/([a-z][a-z0-9-]*)$/.exec(specifier);
      if (ws) {
        for (const root of ["packages", "services"]) {
          const entry = join(repoRoot, root, ws[1], "src", "index.ts");
          if (existsSync(entry)) return tsModule(pathToFileURL(entry).href);
        }
      }
      if (specifier.startsWith(".") && !/\.[cm]?[jt]s$/.test(specifier) && context.parentURL) {
        const base = new URL(specifier, context.parentURL).href;
        for (const c of [`${base}.ts`, `${base}/index.ts`]) {
          if (existsSync(fileURLToPath(c))) return tsModule(c);
        }
      }
      return nextResolve(specifier, context);
    },
  });
}

export { repoRoot };

import { defineCloudflareConfig } from "@opennextjs/cloudflare";
import staticAssetsIncrementalCache from "@opennextjs/cloudflare/overrides/incremental-cache/static-assets-incremental-cache";

/**
 * OpenNext → Cloudflare Workers adapter config.
 *
 * The incremental cache is not optional here, even though the app has no ISR. Every public page is
 * SSG and lives in Next's prerender manifest, so OpenNext treats it as cacheable. With no cache
 * configured it falls back to regenerating each page in the Worker on every request — and the
 * evidence pages (`/assets`, `/simulate`) build their data at build time from files under
 * `services/evidence/fixtures` and `proof/`. The Worker has no filesystem, so regenerating them at
 * request time throws and the route 500s.
 *
 * The static-assets cache serves the prerendered output straight from the deployed Worker assets
 * and never regenerates. It needs no R2/KV because nothing revalidates: the pages are built once at
 * deploy. Dynamic paths (`/api/*`, the wallet app) do not touch the incremental cache and are
 * unaffected.
 */
export default defineCloudflareConfig({
  incrementalCache: staticAssetsIncrementalCache,
});

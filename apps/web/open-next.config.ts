import { defineCloudflareConfig } from "@opennextjs/cloudflare";

/**
 * OpenNext → Cloudflare Workers adapter config.
 *
 * Defaults are deliberate: the app has no ISR/revalidation and no server cache to wire to KV/R2 —
 * the public pages are SSG and everything dynamic reads the chain live on each request. If caching
 * is added later, an incremental cache goes here.
 */
export default defineCloudflareConfig({});

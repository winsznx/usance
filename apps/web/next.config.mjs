import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The Worker bundle (OpenNext) traces from the monorepo root, or it misses hoisted workspace
  // deps under the pnpm store and ships a Worker that cannot resolve @usance/* at runtime.
  outputFileTracingRoot: join(here, "../../"),
  transpilePackages: ["@usance/domain", "@usance/xlayer", "@usance/schemas", "@usance/chaingpt", "@usance/evidence"],
  env: {
    NEXT_PUBLIC_XLAYER_CHAIN_ID: process.env.XLAYER_CHAIN_ID ?? "1952",
    NEXT_PUBLIC_BUILDER_CODE: process.env.USANCE_BUILDER_CODE ?? "usance",
  },
};
export default nextConfig;


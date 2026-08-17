/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@usance/domain", "@usance/xlayer", "@usance/schemas", "@usance/chaingpt", "@usance/evidence"],
  env: {
    NEXT_PUBLIC_XLAYER_CHAIN_ID: process.env.XLAYER_CHAIN_ID ?? "1952",
    NEXT_PUBLIC_BUILDER_CODE: process.env.USANCE_BUILDER_CODE ?? "usance",
  },
};
export default nextConfig;

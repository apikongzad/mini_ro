import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // shared-types and data-gen are TS source workspace packages; let Next compile them.
  transpilePackages: ["@mini-ro/shared-types", "@mini-ro/data-gen"],
};

export default nextConfig;

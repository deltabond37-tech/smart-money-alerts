import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@sma/core"],
  experimental: { serverActions: { bodySizeLimit: "2mb" } },
};

export default nextConfig;

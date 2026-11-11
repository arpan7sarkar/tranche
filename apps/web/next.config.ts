import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: path.join(process.cwd(), "../.."),
  cacheComponents: true,
  partialPrefetching: true,
  transpilePackages: [
    "@tranche/agents",
    "@tranche/agents-service",
    "@tranche/contracts",
    "@tranche/core",
    "@tranche/db",
    "@tranche/paypal",
  ],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;

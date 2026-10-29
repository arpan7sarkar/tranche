import type { NextConfig } from "next";

if (process.env.TRANCHE_DEPLOYMENT === "1" && process.env.NEXT_PUBLIC_E2E_FAKE_PAYPAL) {
  throw new Error("Fake checkout cannot be included in a deployment build");
}

const nextConfig: NextConfig = {
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

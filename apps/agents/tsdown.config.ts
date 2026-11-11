import { defineConfig } from "tsdown";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "vps/index": "src/vps/index.ts",
    "vps/job": "src/vps/job.ts",
  },
  platform: "node",
  format: "esm",
  deps: { alwaysBundle: [/^@tranche\//, /^postgres$/], neverBundle: ["playwright"] },
});

import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts", "src/cron-tick.ts", "src/cron-reconcile.ts"],
  platform: "node",
  format: "esm",
  deps: { alwaysBundle: [/^@tranche\//], neverBundle: ["playwright"] },
});

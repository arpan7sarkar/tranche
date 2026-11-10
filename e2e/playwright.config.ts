import { defineConfig, devices } from "@playwright/test";
import { openFixtureDb } from "./support/database";
import { appEnv } from "./support/environment";

const db = await openFixtureDb();
await db.$client.end();
export default defineConfig({
  testDir: "specs",
  timeout: 120_000,
  expect: { timeout: 45_000 },
  workers: 1,
  retries: 0,
  use: { baseURL: appEnv.APP_URL, trace: "retain-on-failure", serviceWorkers: "block" },
  projects: [
    { name: "setup", testMatch: /.*\.setup\.ts/ },
    {
      name: "journeys",
      testMatch: /.*\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], storageState: ".state/agency.json" },
      dependencies: ["setup"],
    },
  ],
  webServer: [
    {
      command: "node --require ./support/network-guard.cjs --import tsx scripts/services.ts",
      port: 4030,
      env: appEnv,
      timeout: 120_000,
    },
    { command: "pnpm exec tsx scripts/web.ts", port: 3100, env: appEnv, timeout: 240_000 },
  ],
});

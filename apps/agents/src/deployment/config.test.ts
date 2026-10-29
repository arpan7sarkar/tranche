import { expect, it } from "vitest";
import { deploymentIssues } from "./config";

const env = {
  RENDER_API_KEY: "secret",
  RENDER_WORKFLOW_SLUG: "tranche-agents",
  DATABASE_URL: "postgres://test",
  PAYPAL_CLIENT_ID: "sandbox",
  PAYPAL_CLIENT_SECRET: "secret",
  PAYPAL_ENV: "sandbox",
  HOLD_MECHANISM: "authorization",
  SUBCONTRACTOR_SPLIT: "agency_pays",
  APP_URL: "https://tranche.example.com",
  BETTER_AUTH_URL: "https://tranche.example.com",
  BETTER_AUTH_SECRET: "s".repeat(32),
  NEXT_PUBLIC_PAYPAL_CLIENT_ID: "sandbox",
  TRANCHE_LLM: "off",
};
it("allows deployment with models disabled and webhook registration still pending", () => {
  expect(deploymentIssues("web", env)).toEqual([]);
  expect(deploymentIssues("workflow", env)).toEqual([]);
});
it("rejects fake checkout, live credentials configuration, and mismatched auth origins", () => {
  expect(
    deploymentIssues("web", {
      ...env,
      NEXT_PUBLIC_E2E_FAKE_PAYPAL: "1",
      PAYPAL_ENV: "live",
      BETTER_AUTH_URL: "https://other.example",
    }),
  ).toEqual(
    expect.arrayContaining([
      "NEXT_PUBLIC_E2E_FAKE_PAYPAL:test_setting_forbidden",
      "PAYPAL_ENV:must_be_sandbox",
      "BETTER_AUTH_URL:must_match_app_url",
    ]),
  );
});
it("never includes secret values in validation errors", () => {
  expect(
    JSON.stringify(
      deploymentIssues("web", { ...env, PAYPAL_API_BASE: "https://user:private@other.example" }),
    ),
  ).not.toContain("private");
});
it("gives cron only workflow credentials and an explicit operating mode", () => {
  expect(
    deploymentIssues("cron", {
      RENDER_API_KEY: "key",
      RENDER_WORKFLOW_SLUG: "agents",
      TRANCHE_CRON_MODE: "health",
    }),
  ).toEqual([]);
  expect(deploymentIssues("cron", {})).toContain("TRANCHE_CRON_MODE:invalid");
});

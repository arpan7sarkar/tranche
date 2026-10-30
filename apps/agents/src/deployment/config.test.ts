import { expect, it } from "vitest";
import { deploymentIssues } from "./config";

const env = {
  DATABASE_URL: "postgres://test",
  DATABASE_SSL: "verify-full",
  WORKER_TOKEN: "s".repeat(32),
  WORKER_URL: "https://worker.example.com",
  WORKER_MODE: "health",
  PAYPAL_CLIENT_ID: "sandbox",
  PAYPAL_CLIENT_SECRET: "secret",
  PAYPAL_ENV: "sandbox",
  HOLD_MECHANISM: "authorization",
  SUBCONTRACTOR_SPLIT: "agency_pays",
  APP_URL: "https://app.example.com",
  BETTER_AUTH_URL: "https://app.example.com",
  BETTER_AUTH_SECRET: "s".repeat(32),
  NEXT_PUBLIC_PAYPAL_CLIENT_ID: "sandbox",
  TRANCHE_LLM: "off",
};
it("accepts Vercel and VPS settings without Render credentials", () => {
  expect(deploymentIssues("web", env)).toEqual([]);
  expect(deploymentIssues("worker", env)).toEqual([]);
});
it("requires verified database TLS and HTTPS worker transport on Vercel", () => {
  expect(
    deploymentIssues("web", { ...env, DATABASE_SSL: "", WORKER_URL: "http://worker.example.com" }),
  ).toEqual(
    expect.arrayContaining([
      "DATABASE_SSL:verify_full_required",
      "WORKER_URL:https_origin_required",
    ]),
  );
});
it("rejects fake and live settings without exposing secrets", () => {
  const issues = deploymentIssues("worker", {
    ...env,
    WORKER_MODE: "unknown",
    PAYPAL_ENV: "live",
    PAYPAL_API_BASE: "https://user:private@other.example",
    TEST_DATABASE_URL: "test",
  });
  expect(issues).toContain("WORKER_MODE:invalid");
  expect(issues).toContain("PAYPAL_ENV:must_be_sandbox");
  expect(issues).toContain("TEST_DATABASE_URL:test_setting_forbidden");
  expect(JSON.stringify(issues)).not.toContain("private");
});

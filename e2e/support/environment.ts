const {
  TRANCHE_E2E_CONTAINER_ID,
  TRANCHE_E2E_IMAGE_ID,
  TRANCHE_E2E_MARKER,
  TRANCHE_E2E_DB_PORT,
  TRANCHE_E2E_DB_PASSWORD,
} = process.env;
if (
  !TRANCHE_E2E_CONTAINER_ID ||
  !/^[a-f0-9]{64}$/.test(TRANCHE_E2E_CONTAINER_ID) ||
  !TRANCHE_E2E_IMAGE_ID ||
  !/^sha256:[a-f0-9]{64}$/.test(TRANCHE_E2E_IMAGE_ID) ||
  !TRANCHE_E2E_MARKER ||
  !/^[a-f0-9]{32}$/.test(TRANCHE_E2E_MARKER) ||
  !TRANCHE_E2E_DB_PORT ||
  !/^\d+$/.test(TRANCHE_E2E_DB_PORT) ||
  !TRANCHE_E2E_DB_PASSWORD ||
  !/^[a-f0-9]{32}$/.test(TRANCHE_E2E_DB_PASSWORD)
)
  throw new Error("e2e_fixture_configuration_required");
export const fixture = {
  containerId: TRANCHE_E2E_CONTAINER_ID,
  imageId: TRANCHE_E2E_IMAGE_ID,
  marker: TRANCHE_E2E_MARKER,
  port: Number(TRANCHE_E2E_DB_PORT),
};
export const databaseUrl = `postgres://tranche_e2e:${TRANCHE_E2E_DB_PASSWORD}@127.0.0.1:${fixture.port}/postgres`;
if (
  (process.env.DATABASE_URL && process.env.DATABASE_URL !== databaseUrl) ||
  process.env.TEST_DATABASE_URL
)
  throw new Error("inherited_database_url_forbidden");
export const workspaceId = "becb60b4-33c4-4e3a-93d7-a542ec693302";
export const appEnv = {
  NODE_ENV: "test",
  DATABASE_URL: databaseUrl,
  WEB_MONEY_ENABLED: "true",
  APP_URL: "http://localhost:3100",
  BETTER_AUTH_URL: "http://localhost:3100",
  BETTER_AUTH_SECRET: "e2e-secret-not-for-production-000000",
  PAYPAL_API_BASE: "https://api-m.sandbox.paypal.com",
  PAYPAL_CLIENT_ID: "fake",
  PAYPAL_CLIENT_SECRET: "fake",
  PAYPAL_WEBHOOK_ID: "fake",
  NEXT_PUBLIC_E2E_FAKE_PAYPAL: "1",
  PAGESPEED_API_BASE: "http://localhost:4020",
  VERIFIER_ALLOW_TEST_LOCALHOST: "1",
  TRANCHE_LLM: "off",
  HOLD_MECHANISM: "authorization",
  SUBCONTRACTOR_SPLIT: "agency_pays",
  RESEND_API_KEY: "",
  EMAIL_FROM: "",
  GEMINI_API_KEY: "",
  GOOGLE_GENERATIVE_AI_API_KEY: "",
  OPENAI_API_KEY: "",
  RENDER_WORKFLOW_SLUG: "",
  RENDER_API_KEY: "",
  GITHUB_APP_ID: "",
  GITHUB_APP_PRIVATE_KEY: "",
  GITHUB_WEBHOOK_SECRET: "offline-github-webhook-secret",
  GITHUB_WORKSPACE_REPOSITORIES: JSON.stringify({ [workspaceId]: ["test/site"] }),
};

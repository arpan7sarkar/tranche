export type DeploymentRole = "web" | "workflow" | "cron";

export function deploymentIssues(
  role: DeploymentRole,
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const issues: string[] = [];
  const requireValue = (key: string) => {
    if (!env[key]?.trim()) issues.push(`${key}:missing`);
  };
  if (role !== "workflow") {
    requireValue("RENDER_API_KEY");
    requireValue("RENDER_WORKFLOW_SLUG");
  }
  if (env.RENDER_WORKFLOW_SLUG && !/^[a-zA-Z0-9_-]+$/.test(env.RENDER_WORKFLOW_SLUG))
    issues.push("RENDER_WORKFLOW_SLUG:invalid");
  if (role === "cron") {
    if (!["health", "active", "disabled"].includes(env.TRANCHE_CRON_MODE ?? ""))
      issues.push("TRANCHE_CRON_MODE:invalid");
    return issues;
  }
  requireValue("DATABASE_URL");
  requireValue("PAYPAL_CLIENT_ID");
  requireValue("PAYPAL_CLIENT_SECRET");
  if (env.PAYPAL_ENV !== "sandbox") issues.push("PAYPAL_ENV:must_be_sandbox");
  if (env.PAYPAL_API_BASE && env.PAYPAL_API_BASE !== "https://api-m.sandbox.paypal.com")
    issues.push("PAYPAL_API_BASE:must_be_sandbox");
  if (env.HOLD_MECHANISM !== "authorization") issues.push("HOLD_MECHANISM:must_be_authorization");
  if (env.SUBCONTRACTOR_SPLIT !== "agency_pays")
    issues.push("SUBCONTRACTOR_SPLIT:must_be_agency_pays");
  for (const key of [
    "NEXT_PUBLIC_E2E_FAKE_PAYPAL",
    "VERIFIER_ALLOW_TEST_LOCALHOST",
    "TEST_DATABASE_URL",
  ]) {
    if (env[key]) issues.push(`${key}:test_setting_forbidden`);
  }
  if (env.PAGESPEED_API_BASE && env.PAGESPEED_API_BASE !== "https://www.googleapis.com")
    issues.push("PAGESPEED_API_BASE:invalid");
  try {
    const url = new URL(env.APP_URL ?? "");
    if (
      url.protocol !== "https:" ||
      url.origin !== env.APP_URL ||
      url.username ||
      url.password ||
      /localhost|127\.0\.0\.1/.test(url.hostname)
    )
      throw new Error();
  } catch {
    issues.push("APP_URL:public_https_origin_required");
  }
  if (role === "web") {
    if (env.BETTER_AUTH_URL !== env.APP_URL) issues.push("BETTER_AUTH_URL:must_match_app_url");
    if ((env.BETTER_AUTH_SECRET?.length ?? 0) < 32)
      issues.push("BETTER_AUTH_SECRET:at_least_32_characters");
    if (
      !env.NEXT_PUBLIC_PAYPAL_CLIENT_ID ||
      env.NEXT_PUBLIC_PAYPAL_CLIENT_ID !== env.PAYPAL_CLIENT_ID
    )
      issues.push("NEXT_PUBLIC_PAYPAL_CLIENT_ID:must_match_server");
  }
  if (Boolean(env.EMAIL_FROM) !== Boolean(env.RESEND_API_KEY))
    issues.push("email:incomplete_configuration");
  if (
    env.TRANCHE_LLM !== "off" &&
    !(env.AI_FALLBACK === "openai" ? env.OPENAI_API_KEY : env.GOOGLE_GENERATIVE_AI_API_KEY)
  )
    issues.push("model:credentials_missing");
  return issues;
}

export function assertDeployment(role: DeploymentRole, env: NodeJS.ProcessEnv = process.env) {
  const issues = deploymentIssues(role, env);
  if (issues.length) throw new Error(`deployment_configuration:${issues.join(",")}`);
}

export type HealthObservation = {
  kind: string;
  source: string;
  ok: boolean;
  schemaReady: boolean;
  webhookConfigured: boolean;
  observedAt: string;
};
export type SmokeDeps = {
  fetch: typeof fetch;
  workflow: () => Promise<HealthObservation>;
  cron: () => Promise<HealthObservation[]>;
};
export async function deploymentSmoke(
  origin: string,
  deps: SmokeDeps,
  stage: "bootstrap" | "ready" = "ready",
  now = Date.now(),
) {
  const url = new URL(origin);
  if (url.protocol !== "https:" || url.origin !== origin || url.username || url.password)
    throw new Error("SMOKE_URL_must_be_https_origin");
  const checks: Record<string, boolean> = {};
  try {
    const response = await deps.fetch(`${origin}/api/health`, {
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
    checks.webDatabase = response.ok && (await response.json()).ok === true;
  } catch {
    checks.webDatabase = false;
  }
  try {
    const response = await deps.fetch(`${origin}/api/webhooks/paypal`, {
      method: "GET",
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
    checks.webhookRoute = response.status === 405;
  } catch {
    checks.webhookRoute = false;
  }
  const valid = (value: HealthObservation, source: string, age: number) =>
    value.kind === "tranche-deployment-health" &&
    value.source === source &&
    value.ok &&
    value.schemaReady &&
    Number.isFinite(Date.parse(value.observedAt)) &&
    now - Date.parse(value.observedAt) >= -60_000 &&
    now - Date.parse(value.observedAt) < age;
  try {
    const result = await deps.workflow();
    checks.workflowDatabase = valid(result, "smoke", 5 * 60_000);
    if (stage === "ready") checks.webhookConfiguration = result.webhookConfigured;
  } catch {
    checks.workflowDatabase = false;
  }
  try {
    const observations = await deps.cron();
    checks.tickCron = observations.some((value) => valid(value, "cron:tick", 5 * 60_000));
    checks.reconcileCron = observations.some((value) =>
      valid(value, "cron:reconcile", 90 * 60_000),
    );
  } catch {
    checks.tickCron = false;
    checks.reconcileCron = false;
  }
  return { stage, ok: Object.values(checks).every(Boolean), checks };
}

import { deploymentSmoke, type HealthObservation } from "../support/deployment-smoke";

const origin = process.env.SMOKE_URL ?? "";
const worker = new URL(process.env.WORKER_URL ?? "");
if (
  worker.protocol !== "https:" ||
  worker.origin !== process.env.WORKER_URL ||
  worker.username ||
  worker.password ||
  (process.env.WORKER_TOKEN?.length ?? 0) < 32
)
  throw new Error("smoke_worker_configuration_required");
const stage = process.env.SMOKE_STAGE ?? "ready";
if (stage !== "ready" && stage !== "bootstrap") throw new Error("invalid_smoke_stage");
try {
  const response = await fetch(`${worker.origin}/status`, {
    headers: { Authorization: `Bearer ${process.env.WORKER_TOKEN}` },
    redirect: "error",
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error("worker_unavailable");
  const status = (await response.json()) as HealthObservation & { cron: HealthObservation[] };
  const result = await deploymentSmoke(
    origin,
    { fetch, workflow: async () => status, cron: async () => status.cron },
    stage,
  );
  console.log(JSON.stringify(result));
  process.exitCode = result.ok ? 0 : 1;
} catch {
  console.error("deployment_smoke_failed: check web, worker, database, and scheduler");
  process.exitCode = 1;
}

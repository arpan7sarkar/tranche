import { Render } from "@renderinc/sdk";
import { deploymentSmoke, type HealthObservation } from "../support/deployment-smoke";

const origin = process.env.SMOKE_URL ?? "";
const slug = process.env.RENDER_WORKFLOW_SLUG;
if (!slug || !/^[a-zA-Z0-9_-]+$/.test(slug) || !process.env.RENDER_API_KEY)
  throw new Error("smoke_workflow_configuration_required");
const stage = process.env.SMOKE_STAGE ?? "ready";
if (stage !== "ready" && stage !== "bootstrap") throw new Error("invalid_smoke_stage");
const client = new Render();
function observation(run: { status: string; results: unknown }): HealthObservation {
  if (
    !["completed", "succeeded"].includes(run.status) ||
    !Array.isArray(run.results) ||
    !run.results[0] ||
    typeof run.results[0] !== "object"
  )
    throw new Error("health_run_incomplete");
  return run.results[0] as HealthObservation;
}
try {
  const result = await deploymentSmoke(
    origin,
    {
      fetch,
      workflow: async () =>
        observation(
          await client.workflows.runTask(`${slug}/deploymentHealth`, ["smoke"], {
            idempotencyKey: `deployment-smoke:${crypto.randomUUID()}`,
            signal: AbortSignal.timeout(60_000),
          }),
        ),
      cron: async () => {
        const runs = await client.workflows.listTaskRuns({
          taskSlug: [`${slug}/deploymentHealth`],
          limit: 100,
        });
        const recent: HealthObservation[] = [];
        for (const { taskRun } of runs) {
          if (!["completed", "succeeded"].includes(taskRun.status)) continue;
          const detail = await client.workflows.getTaskRun(taskRun.id);
          recent.push(observation(detail));
          if (
            ["cron:tick", "cron:reconcile"].every((source) =>
              recent.some((item) => item.source === source),
            )
          )
            break;
        }
        return recent;
      },
    },
    stage,
  );
  console.log(JSON.stringify(result));
  process.exitCode = result.ok ? 0 : 1;
} catch {
  console.error(
    "deployment_smoke_failed: check URL, workflow credentials, migrations, and cron history",
  );
  process.exitCode = 1;
}

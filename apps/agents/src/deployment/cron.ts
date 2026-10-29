import { Render } from "@renderinc/sdk";
import { AGENT_TICK_TASKS } from "../agents/schedule";
import { MONEY_TICK_TASKS, RECONCILE_TASK } from "../money/schedule";
import { assertDeployment } from "./config";

type TickTask = { name: string; everyMinutes: number };
export function dueTasks(tasks: readonly TickTask[], minute: number) {
  if (!Number.isSafeInteger(minute) || minute < 0) throw new Error("invalid_minute");
  const names = new Set<string>();
  for (const task of tasks) {
    if (
      !task.name ||
      names.has(task.name) ||
      !Number.isSafeInteger(task.everyMinutes) ||
      task.everyMinutes < 1 ||
      task.everyMinutes > 60
    )
      throw new Error("invalid_tick_schedule");
    names.add(task.name);
  }
  return tasks.filter((task) => minute % task.everyMinutes === 0);
}

export type Start = (
  slug: string,
  args: unknown[],
  options: { idempotencyKey: string; signal: AbortSignal },
) => Promise<unknown>;
export async function dispatchCron(
  kind: "tick" | "reconcile",
  env = process.env,
  now = new Date(),
  start?: Start,
) {
  assertDeployment("cron", env);
  if (env.TRANCHE_CRON_MODE === "disabled") return { mode: "disabled", started: [], failed: [] };
  const minute = Math.floor(now.getTime() / 60_000);
  if (!Number.isSafeInteger(minute)) throw new Error("invalid_clock");
  const healthTask = { name: "deploymentHealth", args: [`cron:${kind}`] };
  const tasks =
    env.TRANCHE_CRON_MODE === "health"
      ? [healthTask]
      : kind === "reconcile"
        ? [healthTask, { name: RECONCILE_TASK, args: [] }]
        : [
            healthTask,
            ...dueTasks([...MONEY_TICK_TASKS, ...AGENT_TICK_TASKS], minute).map(({ name }) => ({
              name,
              args: [],
            })),
          ];
  const launch: Start =
    start ??
    ((slug, args, options) =>
      new Render({ token: env.RENDER_API_KEY ?? "" }).workflows.startTask(slug, args, options));
  const results = await Promise.allSettled(
    tasks.map((task) =>
      launch(`${env.RENDER_WORKFLOW_SLUG}/${task.name}`, task.args, {
        idempotencyKey: `cron:${kind}:${task.name}:${kind === "reconcile" ? Math.floor(minute / 60) : minute}`,
        signal: AbortSignal.timeout(20_000),
      }),
    ),
  );
  return {
    mode: env.TRANCHE_CRON_MODE,
    started: tasks.filter((_, i) => results[i]?.status === "fulfilled").map((task) => task.name),
    failed: tasks.filter((_, i) => results[i]?.status === "rejected").map((task) => task.name),
  };
}

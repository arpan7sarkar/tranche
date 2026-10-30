import { databaseTlsOptions } from "@tranche/db";
import { PgBoss } from "pg-boss";
import { AGENT_TICK_TASKS } from "../agents/schedule";
import { MONEY_TICK_TASKS, RECONCILE_TASK } from "../money/schedule";
import { taskNames, validateTask } from "./registry";

export function createQueue(connectionString = process.env.DATABASE_URL) {
  if (!connectionString) throw new Error("DATABASE_URL_missing");
  const ssl = databaseTlsOptions(connectionString);
  return new PgBoss({ connectionString, schema: "tranche_jobs", max: 5, ...(ssl ? { ssl } : {}) });
}

export async function initializeQueues(boss: PgBoss) {
  for (const name of taskNames) {
    await boss.createQueue(name, {
      policy: "exclusive",
      retryLimit: 5,
      retryDelay: 30,
      retryBackoff: true,
      expireInSeconds: 3600,
      heartbeatSeconds: 60,
      retentionSeconds: 7 * 86400,
    });
  }
}

export async function enqueue(boss: PgBoss, name: string, args: unknown[], key: string) {
  validateTask(name, args);
  if (!key || key.length > 200) throw new Error("invalid_task_key");
  return boss.send(name, { args }, { singletonKey: key });
}

export async function configureSchedules(boss: PgBoss, active: boolean) {
  for (const { name, everyMinutes } of [...MONEY_TICK_TASKS, ...AGENT_TICK_TASKS]) {
    if (!active) await boss.unschedule(name);
    else
      await boss.schedule(
        name,
        `*/${everyMinutes} * * * *`,
        { args: [] },
        { singletonKey: `scheduled:${name}`, tz: "UTC" },
      );
  }
  if (!active) await boss.unschedule(RECONCILE_TASK);
  else
    await boss.schedule(
      RECONCILE_TASK,
      "0 * * * *",
      { args: [] },
      { singletonKey: "scheduled:reconcile", tz: "UTC" },
    );
}

import type { Db } from "@tranche/db";
import { sql } from "drizzle-orm";
import { deploymentIssues } from "./config";

export async function deploymentHealth(db: Db, source: string, env = process.env) {
  if (!["smoke", "cron:tick", "cron:reconcile"].includes(source))
    throw new Error("invalid_health_source");
  const [row] = await db.execute<{ ready: boolean }>(sql`select
    to_regclass('public.event') is not null and to_regclass('public.outbox') is not null
    and to_regclass('public.notification_job') is not null and to_regclass('public.v_cashflow_daily') is not null as ready`);
  return {
    kind: "tranche-deployment-health",
    source,
    ok: Boolean(row?.ready) && !deploymentIssues("worker", env).length,
    schemaReady: Boolean(row?.ready),
    webhookConfigured: Boolean(env.PAYPAL_WEBHOOK_ID),
    modelEnabled: env.TRANCHE_LLM !== "off",
    observedAt: new Date().toISOString(),
  };
}

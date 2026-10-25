import { createHash } from "node:crypto";
import { PlanDraft } from "@tranche/contracts";
import { asc, eq } from "drizzle-orm";
import type { Db } from "./index";
import * as schema from "./schema";

export type DbTransaction = Parameters<Parameters<Db["transaction"]>[0]>[0];
export async function loadNegotiationPlan(db: Db | DbTransaction, dealId: string) {
  const [deal] = await db.select().from(schema.deal).where(eq(schema.deal.id, dealId));
  if (!deal) return null;
  const milestones = await db
    .select()
    .from(schema.milestone)
    .where(eq(schema.milestone.dealId, dealId))
    .orderBy(asc(schema.milestone.position));
  const tasks = await db
    .select()
    .from(schema.task)
    .where(eq(schema.task.dealId, dealId))
    .orderBy(asc(schema.task.position));
  if (!milestones.length || !tasks.length) return null;
  const edges = await db
    .select({ from: schema.taskDependency.fromTaskId, to: schema.taskDependency.toTaskId })
    .from(schema.taskDependency)
    .innerJoin(schema.task, eq(schema.task.id, schema.taskDependency.toTaskId))
    .where(eq(schema.task.dealId, dealId));
  const keys = new Map(tasks.map((t) => [t.id, t.key]));
  const msKeys = new Map(milestones.map((m) => [m.id, m.key]));
  const plan = PlanDraft.parse({
    summary: deal.title,
    currency: deal.currency,
    milestones: milestones.map((m) => ({
      key: m.key,
      title: m.title,
      price: { currency: deal.currency, minor: m.priceMinor },
      criteria: m.criteria,
      payees: m.payees,
    })),
    tasks: tasks.map((t) => ({
      key: t.key,
      title: t.title,
      durationDays: t.durationDays,
      milestoneKey: msKeys.get(t.milestoneId),
      dependsOn: edges
        .filter((e) => e.to === t.id)
        .map((e) => keys.get(e.from))
        .sort(),
    })),
  });
  const startDate = tasks.map((t) => t.startDate).sort()[0];
  if (!startDate) return null;
  const version = createHash("sha256")
    .update(
      JSON.stringify([
        plan,
        tasks.map((t) => [t.id, t.startDate]),
        milestones.map((m) => [m.id, m.startDate, m.endDate]),
      ]),
    )
    .digest("hex");
  return { plan, startDate, version, editable: milestones.every((m) => m.state === "draft") };
}

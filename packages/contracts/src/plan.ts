import { z } from "zod";
import { AcceptanceCriteria } from "./criteria";
import { Key } from "./ids";
import { CurrencyCode, Money } from "./money";

export const Payee = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("agency"), shareBps: z.number().int().min(1).max(10000) }),
  z.object({
    kind: z.literal("subcontractor"),
    name: z.string().min(1).max(200),
    email: z.email(),
    shareBps: z.number().int().min(1).max(10000),
  }),
]);
export type Payee = z.infer<typeof Payee>;

export const PlanTask = z.object({
  key: Key,
  title: z.string().min(1).max(200),
  durationDays: z.number().int().min(1).max(120),
  dependsOn: z.array(Key).max(20),
  milestoneKey: Key,
});
export type PlanTask = z.infer<typeof PlanTask>;

export const PlanMilestone = z.object({
  key: Key,
  title: z.string().min(1).max(200),
  price: Money,
  criteria: AcceptanceCriteria,
  payees: z.array(Payee).min(1).max(10),
});
export type PlanMilestone = z.infer<typeof PlanMilestone>;

const PlanShape = z.object({
  summary: z.string().min(1).max(4000),
  currency: CurrencyCode,
  milestones: z.array(PlanMilestone).min(1).max(12),
  tasks: z.array(PlanTask).min(1).max(80),
});

export function planIssues(plan: z.infer<typeof PlanShape>): string[] {
  const issues: string[] = [];
  const taskKeys = new Set<string>();
  const milestoneKeys = new Set<string>();

  for (const m of plan.milestones) {
    if (milestoneKeys.has(m.key)) issues.push(`duplicate milestone key "${m.key}"`);
    milestoneKeys.add(m.key);
    if (m.price.currency !== plan.currency) {
      issues.push(
        `milestone "${m.key}" is priced in ${m.price.currency}, plan currency is ${plan.currency}`,
      );
    }
    const bps = m.payees.reduce((sum, p) => sum + p.shareBps, 0);
    if (bps !== 10000)
      issues.push(`milestone "${m.key}" payee shares sum to ${bps} bps, expected 10000`);
  }

  for (const t of plan.tasks) {
    if (taskKeys.has(t.key)) issues.push(`duplicate task key "${t.key}"`);
    taskKeys.add(t.key);
  }

  for (const t of plan.tasks) {
    if (!milestoneKeys.has(t.milestoneKey)) {
      issues.push(`task "${t.key}" references unknown milestone "${t.milestoneKey}"`);
    }
    for (const d of t.dependsOn) {
      if (!taskKeys.has(d)) issues.push(`task "${t.key}" depends on unknown task "${d}"`);
    }
  }

  for (const m of plan.milestones) {
    if (!plan.tasks.some((t) => t.milestoneKey === m.key))
      issues.push(`milestone "${m.key}" has no tasks`);
  }

  const indegree = new Map(plan.tasks.map((t) => [t.key, 0]));
  for (const t of plan.tasks) {
    for (const d of t.dependsOn)
      if (taskKeys.has(d)) indegree.set(t.key, (indegree.get(t.key) ?? 0) + 1);
  }
  const queue = [...indegree].filter(([, n]) => n === 0).map(([k]) => k);
  let visited = 0;
  while (queue.length > 0) {
    const k = queue.shift() as string;
    visited++;
    for (const t of plan.tasks) {
      if (!t.dependsOn.includes(k)) continue;
      const n = (indegree.get(t.key) ?? 0) - 1;
      indegree.set(t.key, n);
      if (n === 0) queue.push(t.key);
    }
  }
  if (visited < indegree.size) issues.push("tasks contain a dependency cycle");

  return issues;
}

export const PlanDraft = PlanShape.superRefine((plan, ctx) => {
  for (const message of planIssues(plan)) ctx.addIssue({ code: "custom", message });
});
export type PlanDraft = z.infer<typeof PlanDraft>;

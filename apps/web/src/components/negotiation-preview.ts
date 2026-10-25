import type { PlanDraft } from "@tranche/contracts";
import { milestoneWindows, schedulePlan } from "@tranche/core";
import type { DealView } from "@/server/deals";

export function negotiationPreview(view: DealView, plan: PlanDraft, startDate: string): DealView {
  const schedule = schedulePlan(plan.tasks, startDate);
  const windows = milestoneWindows(plan.tasks, schedule);
  return {
    ...view,
    milestones: plan.milestones.map((m, position) => ({
      id: m.key,
      key: m.key,
      title: m.title,
      position,
      priceMinor: m.price.minor,
      state: "draft",
      startDate: windows.get(m.key)?.start ?? null,
      endDate: windows.get(m.key)?.end ?? null,
      criteria: m.criteria,
      hold: null,
      evidence: [],
    })),
    tasks: plan.tasks.map((t) => ({
      id: t.key,
      key: t.key,
      title: t.title,
      milestoneId: t.milestoneKey,
      durationDays: t.durationDays,
      startDate: schedule.get(t.key)?.start ?? startDate,
    })),
    dependencies: plan.tasks.flatMap((t) =>
      t.dependsOn.map((fromTaskId) => ({ fromTaskId, toTaskId: t.key })),
    ),
  };
}

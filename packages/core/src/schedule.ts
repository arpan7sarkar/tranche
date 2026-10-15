import type { Mandate, PlanDraft } from "@tranche/contracts";
import { addDays, maxDate, minDate } from "./dates";

export type Window = { start: string; end: string };
export type ScheduleTask = { key: string; durationDays: number; dependsOn: string[] };

export function schedulePlan(tasks: ScheduleTask[], startDate: string): Map<string, Window> {
  const byKey = new Map(tasks.map((t) => [t.key, t]));
  const result = new Map<string, Window>();
  const visiting = new Set<string>();

  const visit = (key: string): Window => {
    const done = result.get(key);
    if (done) return done;
    const task = byKey.get(key);
    if (!task) throw new Error(`Unknown task "${key}"`);
    if (visiting.has(key)) throw new Error(`Dependency cycle at "${key}"`);
    visiting.add(key);
    let start = startDate;
    for (const dep of task.dependsOn) start = maxDate(start, visit(dep).end);
    visiting.delete(key);
    const window = { start, end: addDays(start, task.durationDays) };
    result.set(key, window);
    return window;
  };

  for (const t of tasks) visit(t.key);
  return result;
}

export function milestoneWindows(
  tasks: Array<{ key: string; milestoneKey: string }>,
  schedule: Map<string, Window>,
): Map<string, Window> {
  const out = new Map<string, Window>();
  for (const t of tasks) {
    const w = schedule.get(t.key);
    if (!w) throw new Error(`Task "${t.key}" is not scheduled`);
    const cur = out.get(t.milestoneKey);
    out.set(
      t.milestoneKey,
      cur ? { start: minDate(cur.start, w.start), end: maxDate(cur.end, w.end) } : w,
    );
  }
  return out;
}

export const FUND_LEAD_DAYS = 3;

export function fundingDueDate(milestoneStart: string, today: string): string {
  return maxDate(today, addDays(milestoneStart, -FUND_LEAD_DAYS));
}

export function withinMandate(
  plan: PlanDraft,
  mandate: Mandate,
  startDate: string,
): { ok: true } | { ok: false; reason: string } {
  const total = plan.milestones.reduce((sum, m) => sum + m.price.minor, 0);
  if (mandate.side === "client" && total > mandate.limitMinor) {
    return { ok: false, reason: `total ${total} exceeds the client limit ${mandate.limitMinor}` };
  }
  if (mandate.side === "agency" && total < mandate.limitMinor) {
    return {
      ok: false,
      reason: `total ${total} is below the agency minimum ${mandate.limitMinor}`,
    };
  }
  if (mandate.latestEndDate) {
    const schedule = schedulePlan(plan.tasks, startDate);
    const end = [...schedule.values()].reduce((e, w) => maxDate(e, w.end), startDate);
    if (end > mandate.latestEndDate) {
      return {
        ok: false,
        reason: `plan ends ${end}, after the latest end date ${mandate.latestEndDate}`,
      };
    }
  }
  return { ok: true };
}

export type PlacedTask = { key: string; start: string; durationDays: number; dependsOn: string[] };

export function rescheduleTasks(
  tasks: PlacedTask[],
  moves: Array<{ key: string; start: string }>,
): { ok: true; schedule: Map<string, Window> } | { ok: false; reason: string } {
  const byKey = new Map(tasks.map((t) => [t.key, t]));
  const requested = new Map<string, string>();
  for (const m of moves) {
    if (!byKey.has(m.key)) return { ok: false, reason: `unknown task "${m.key}"` };
    requested.set(m.key, m.start);
  }
  const out = new Map<string, Window>();
  const visiting = new Set<string>();

  const visit = (key: string): Window => {
    const done = out.get(key);
    if (done) return done;
    const task = byKey.get(key);
    if (!task) throw new Error(`unknown task "${key}"`);
    if (visiting.has(key)) throw new Error(`dependency cycle at "${key}"`);
    visiting.add(key);
    let earliest: string | null = null;
    let blocker = "";
    for (const d of task.dependsOn) {
      if (!byKey.has(d)) throw new Error(`task "${key}" depends on missing task "${d}"`);
      const w = visit(d);
      if (earliest === null || w.end > earliest) {
        earliest = w.end;
        blocker = d;
      }
    }
    visiting.delete(key);
    const want = requested.get(key);
    let start: string;
    if (want !== undefined) {
      if (earliest !== null && want < earliest) {
        throw new Error(`task "${key}" cannot start before "${blocker}" ends on ${earliest}`);
      }
      start = want;
    } else {
      start = earliest === null ? task.start : maxDate(task.start, earliest);
    }
    const w = { start, end: addDays(start, task.durationDays) };
    out.set(key, w);
    return w;
  };

  try {
    for (const t of tasks) visit(t.key);
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
  return { ok: true, schedule: out };
}

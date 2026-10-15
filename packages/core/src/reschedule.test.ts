import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type PlacedTask, rescheduleTasks, schedulePlan } from "./schedule";

const tasks: PlacedTask[] = [
  { key: "a", start: "2026-10-10", durationDays: 3, dependsOn: [] },
  { key: "b", start: "2026-10-13", durationDays: 2, dependsOn: ["a"] },
  { key: "c", start: "2026-10-15", durationDays: 1, dependsOn: ["b"] },
  { key: "x", start: "2026-10-10", durationDays: 4, dependsOn: [] },
];

describe("rescheduleTasks", () => {
  it("pushes dependents when a task moves later", () => {
    const r = rescheduleTasks(tasks, [{ key: "a", start: "2026-10-12" }]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.schedule.get("a")).toEqual({ start: "2026-10-12", end: "2026-10-15" });
    expect(r.schedule.get("b")?.start).toBe("2026-10-15");
    expect(r.schedule.get("c")?.start).toBe("2026-10-17");
    expect(r.schedule.get("x")?.start).toBe("2026-10-10");
  });

  it("does not pull dependents earlier when a task moves earlier", () => {
    const later = tasks.map((t) => (t.key === "b" ? { ...t, start: "2026-10-20" } : t));
    const r = rescheduleTasks(later, [{ key: "a", start: "2026-10-09" }]);
    expect(r.ok && r.schedule.get("b")?.start).toBe("2026-10-20");
  });

  it("refuses a move before a dependency ends, naming the blocking task", () => {
    expect(rescheduleTasks(tasks, [{ key: "b", start: "2026-10-12" }])).toEqual({
      ok: false,
      reason: 'task "b" cannot start before "a" ends on 2026-10-13',
    });
  });

  it("keeps every dependency satisfied and never pulls a task earlier (property)", () => {
    const dag = fc.integer({ min: 1, max: 12 }).chain((n) =>
      fc.tuple(
        fc.tuple(
          ...Array.from({ length: n }, (_, i) =>
            fc.record({
              durationDays: fc.integer({ min: 1, max: 8 }),
              deps: fc.subarray(Array.from({ length: i }, (_, j) => j)),
            }),
          ),
        ),
        fc.integer({ min: 0, max: n - 1 }),
        fc.integer({ min: -6, max: 15 }),
      ),
    );
    fc.assert(
      fc.property(dag, ([spec, moved, offset]) => {
        const base = spec.map((t, i) => ({
          key: `t${i}`,
          durationDays: t.durationDays,
          dependsOn: t.deps.map((d) => `t${d}`),
        }));
        const initial = schedulePlan(base, "2026-10-10");
        const placed = base.map((t) => ({ ...t, start: initial.get(t.key)?.start ?? "" }));
        const target = new Date(
          Date.parse(`${initial.get(`t${moved}`)?.start}T00:00:00Z`) + offset * 86_400_000,
        )
          .toISOString()
          .slice(0, 10);
        const r = rescheduleTasks(placed, [{ key: `t${moved}`, start: target }]);
        if (!r.ok) {
          expect(r.reason).toMatch(/cannot start before/);
          return;
        }
        expect(r.schedule.get(`t${moved}`)?.start).toBe(target);
        for (const t of placed) {
          const w = r.schedule.get(t.key);
          if (!w) throw new Error(`missing ${t.key}`);
          for (const d of t.dependsOn) expect(w.start >= (r.schedule.get(d)?.end ?? "")).toBe(true);
          if (t.key !== `t${moved}`) expect(w.start >= t.start).toBe(true);
        }
      }),
    );
  });
});

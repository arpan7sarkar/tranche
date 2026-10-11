import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { fundingDueDate, milestoneWindows, schedulePlan } from "./schedule";

describe("schedulePlan", () => {
  it("starts tasks without dependencies on the start date", () => {
    const s = schedulePlan([{ key: "a", durationDays: 3, dependsOn: [] }], "2026-10-10");
    expect(s.get("a")).toEqual({ start: "2026-10-10", end: "2026-10-13" });
  });

  it("starts a task when its latest dependency ends", () => {
    const s = schedulePlan(
      [
        { key: "a", durationDays: 3, dependsOn: [] },
        { key: "b", durationDays: 5, dependsOn: [] },
        { key: "c", durationDays: 2, dependsOn: ["a", "b"] },
      ],
      "2026-10-10",
    );
    expect(s.get("c")).toEqual({ start: "2026-10-15", end: "2026-10-17" });
  });

  it("does not depend on input order", () => {
    const s = schedulePlan(
      [
        { key: "c", durationDays: 2, dependsOn: ["a"] },
        { key: "a", durationDays: 3, dependsOn: [] },
      ],
      "2026-10-10",
    );
    expect(s.get("c")?.start).toBe("2026-10-13");
  });

  it("throws on cycles and unknown dependencies", () => {
    expect(() =>
      schedulePlan(
        [
          { key: "a", durationDays: 1, dependsOn: ["b"] },
          { key: "b", durationDays: 1, dependsOn: ["a"] },
        ],
        "2026-10-10",
      ),
    ).toThrow(/cycle/);
    expect(() =>
      schedulePlan([{ key: "a", durationDays: 1, dependsOn: ["x"] }], "2026-10-10"),
    ).toThrow(/Unknown task/);
  });

  it("respects every dependency (property)", () => {
    const dag = fc.integer({ min: 1, max: 15 }).chain((n) =>
      fc.tuple(
        ...Array.from({ length: n }, (_, i) =>
          fc.record({
            durationDays: fc.integer({ min: 1, max: 10 }),
            deps: fc.subarray(Array.from({ length: i }, (_, j) => j)),
          }),
        ),
      ),
    );
    fc.assert(
      fc.property(dag, (spec) => {
        const tasks = spec.map((t, i) => ({
          key: `t${i}`,
          durationDays: t.durationDays,
          dependsOn: t.deps.map((d) => `t${d}`),
        }));
        const s = schedulePlan(tasks, "2026-10-10");
        const at = (key: string) => {
          const w = s.get(key);
          if (!w) throw new Error(`missing window for ${key}`);
          return w;
        };
        for (const t of tasks) {
          const w = at(t.key);
          const latestDepEnd =
            t.dependsOn
              .map((d) => at(d).end)
              .sort()
              .at(-1) ?? "2026-10-10";
          expect(w.start).toBe(latestDepEnd > "2026-10-10" ? latestDepEnd : "2026-10-10");
          for (const d of t.dependsOn) expect(w.start >= at(d).end).toBe(true);
        }
      }),
    );
  });
});

describe("milestoneWindows", () => {
  it("spans the earliest start and latest end of a milestone's tasks", () => {
    const s = schedulePlan(
      [
        { key: "a", durationDays: 3, dependsOn: [] },
        { key: "b", durationDays: 2, dependsOn: ["a"] },
        { key: "c", durationDays: 1, dependsOn: ["b"] },
      ],
      "2026-10-10",
    );
    const w = milestoneWindows(
      [
        { key: "a", milestoneKey: "m1" },
        { key: "b", milestoneKey: "m1" },
        { key: "c", milestoneKey: "m2" },
      ],
      s,
    );
    expect(w.get("m1")).toEqual({ start: "2026-10-10", end: "2026-10-15" });
    expect(w.get("m2")).toEqual({ start: "2026-10-15", end: "2026-10-16" });
  });
});

describe("fundingDueDate", () => {
  it("funds three days before the milestone starts", () => {
    expect(fundingDueDate("2026-10-20", "2026-10-01")).toBe("2026-10-17");
  });

  it("never schedules funding in the past", () => {
    expect(fundingDueDate("2026-10-02", "2026-10-01")).toBe("2026-10-01");
  });
});

import { MilestoneState } from "@tranche/contracts";
import { describe, expect, it } from "vitest";
import { milestoneTone } from "@/lib/milestone-tone";
import { formatMoney } from "@/lib/money";
import type { DealView } from "@/server/deals";
import { addDays, type GanttTask, LOCKED_STATES, toGanttData, toIsoDate } from "./gantt-data";

type Milestone = DealView["milestones"][number];
type Task = DealView["tasks"][number];

function milestone(overrides: Partial<Milestone> = {}): Milestone {
  return {
    id: "m1",
    key: "design",
    title: "Design",
    position: 0,
    priceMinor: 240000,
    state: "held",
    startDate: "2026-10-12",
    endDate: "2026-10-20",
    criteria: { checks: [{ kind: "url_live", url: "https://x.dev" }], prose: [] },
    hold: { status: "active", expiresAt: "2026-11-01T00:00:00Z" },
    evidence: [],
    ...overrides,
  };
}

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: "t1",
    milestoneId: "m1",
    key: "wire",
    title: "Wireframes",
    durationDays: 3,
    startDate: "2026-10-12",
    ...overrides,
  };
}

function view(state: MilestoneState = "held"): DealView {
  return {
    deal: {
      id: "d",
      title: "D",
      status: "active",
      currency: "USD",
      clientName: "C",
      clientEmail: "c@x.dev",
      clientPolicy: null,
    },
    milestones: [milestone({ state })],
    tasks: [
      task(),
      task({ id: "t2", key: "vis", title: "Visual", durationDays: 5, startDate: "2026-10-15" }),
    ],
    dependencies: [{ fromTaskId: "t1", toTaskId: "t2" }],
    activity: [],
    approvals: [],
  };
}

function withMilestones(
  milestones: Milestone[],
  tasks: Task[],
  deps: DealView["dependencies"] = [],
) {
  return { ...view(), milestones, tasks, dependencies: deps } satisfies DealView;
}

function walk(tasks: GanttTask[]): GanttTask[] {
  return tasks.flatMap((t) => [t, ...walk(t.children ?? [])]);
}

describe("toGanttData", () => {
  it("groups tasks under their milestone with a payment diamond", () => {
    const { tasks } = toGanttData(view());
    const group = tasks[0] as GanttTask;
    expect(group.kind).toBe("group");
    expect(group.children?.map((c) => c.kind)).toEqual(["task", "task", "payment"]);
    const diamond = group.children?.at(-1) as GanttTask;
    expect(diamond.startDate).toBe("2026-10-20");
    expect(diamond.endDate).toBe("2026-10-20");
    expect(diamond.price).toBe("$2,400.00");
    expect(diamond.holdLabel).toBe("Funds held");
    expect(diamond.draggable).toBe(false);
  });

  it("keeps server dates and computes task ends", () => {
    const task = toGanttData(view()).tasks[0]?.children?.[1] as GanttTask;
    expect(task).toMatchObject({
      startDate: "2026-10-15",
      endDate: "2026-10-20",
      manuallyScheduled: true,
      draggable: true,
    });
  });

  it("links tasks to each other and every task to the diamond", () => {
    const { dependencies } = toGanttData(view());
    expect(dependencies).toContainEqual({ id: "t1->t2", fromTask: "t1", toTask: "t2" });
    expect(dependencies).toContainEqual({ id: "t1->pay:m1", fromTask: "t1", toTask: "pay:m1" });
    expect(dependencies).toContainEqual({ id: "t2->pay:m1", fromTask: "t2", toTask: "pay:m1" });
  });

  it("locks tasks of a released milestone", () => {
    const task = toGanttData(view("released")).tasks[0]?.children?.[0] as GanttTask;
    expect(task.readOnly).toBe(true);
    expect(task.draggable).toBe(false);
  });

  it("formats dates without timezone drift", () => {
    expect(addDays("2026-12-30", 3)).toBe("2027-01-02");
    expect(toIsoDate(new Date(2026, 9, 5))).toBe("2026-10-05");
  });

  describe("groups", () => {
    it("emits one expanded, immovable group per milestone in the view's order", () => {
      const data = toGanttData(
        withMilestones(
          [
            milestone({ id: "m1", title: "Design" }),
            milestone({ id: "m2", title: "Build", position: 1 }),
            milestone({ id: "m3", title: "Launch", position: 2 }),
          ],
          [],
        ),
      );
      expect(data.tasks.map((t) => [t.kind, t.name])).toEqual([
        ["group", "Design"],
        ["group", "Build"],
        ["group", "Launch"],
      ]);
      for (const group of data.tasks) {
        expect(group).toMatchObject({ expanded: true, draggable: false, resizable: false });
      }
    });

    it("puts each task under its own milestone and nowhere else", () => {
      const { tasks } = toGanttData(
        withMilestones(
          [milestone({ id: "m1" }), milestone({ id: "m2", title: "Build", endDate: "2026-11-10" })],
          [
            task({ id: "a", milestoneId: "m1" }),
            task({ id: "b", milestoneId: "m2", startDate: "2026-11-01" }),
            task({ id: "c", milestoneId: "m2", startDate: "2026-11-04" }),
          ],
        ),
      );
      const ids = (t: GanttTask | undefined) =>
        t?.children?.filter((c) => c.kind === "task").map((c) => c.id);
      expect(ids(tasks[0])).toEqual(["a"]);
      expect(ids(tasks[1])).toEqual(["b", "c"]);
    });

    it("returns empty data for a deal with no milestones", () => {
      expect(toGanttData(withMilestones([], []))).toEqual({ tasks: [], dependencies: [] });
    });
  });

  describe("milestone with no tasks", () => {
    const data = toGanttData(withMilestones([milestone({ endDate: "2026-10-20" })], []));

    it("still gets its group and a payment diamond", () => {
      expect(data.tasks).toHaveLength(1);
      const group = data.tasks[0] as GanttTask;
      expect(group.kind).toBe("group");
      expect(group.children?.map((c) => c.kind)).toEqual(["payment"]);
      expect(group.children?.[0]).toMatchObject({
        id: "pay:m1",
        startDate: "2026-10-20",
        endDate: "2026-10-20",
        price: "$2,400.00",
        holdLabel: "Funds held",
      });
    });

    it("has no dependencies to draw", () => {
      expect(data.dependencies).toEqual([]);
    });
  });

  describe("missing dates", () => {
    it("does not throw for null start and end dates and leaves the diamond undated", () => {
      const { tasks } = toGanttData(
        withMilestones([milestone({ startDate: null, endDate: null })], []),
      );
      const diamond = tasks[0]?.children?.[0] as GanttTask;
      expect(diamond.kind).toBe("payment");
      expect(diamond.startDate).toBeUndefined();
      expect(diamond.endDate).toBeUndefined();
    });

    it("dates the diamond at the last task end when the milestone has no end date", () => {
      const { tasks } = toGanttData(
        withMilestones(
          [milestone({ startDate: null, endDate: null })],
          [
            task({ id: "a", startDate: "2026-10-12", durationDays: 3 }),
            task({ id: "b", startDate: "2026-10-14", durationDays: 9 }),
            task({ id: "c", startDate: "2026-10-13", durationDays: 1 }),
          ],
        ),
      );
      const diamond = tasks[0]?.children?.at(-1) as GanttTask;
      expect(diamond).toMatchObject({ startDate: "2026-10-23", endDate: "2026-10-23" });
    });

    it("prefers the milestone end over the last task end", () => {
      const { tasks } = toGanttData(
        withMilestones([milestone({ endDate: "2026-10-25" })], [task({ durationDays: 3 })]),
      );
      const diamond = tasks[0]?.children?.at(-1) as GanttTask;
      expect(diamond).toMatchObject({ startDate: "2026-10-25", endDate: "2026-10-25" });
    });
  });

  describe("payment diamond", () => {
    it("is a zero-duration, fixed, read-only marker for every milestone state", () => {
      for (const state of MilestoneState.options) {
        const diamond = toGanttData(view(state)).tasks[0]?.children?.at(-1) as GanttTask;
        expect(diamond).toMatchObject({
          id: "pay:m1",
          kind: "payment",
          manuallyScheduled: true,
          readOnly: true,
          draggable: false,
          resizable: false,
        });
        expect(diamond.endDate).toBe(diamond.startDate);
      }
    });

    it.each(MilestoneState.options)("labels the %s milestone through milestoneTone", (state) => {
      const diamond = toGanttData(view(state)).tasks[0]?.children?.at(-1) as GanttTask;
      expect(diamond.holdLabel).toBe(milestoneTone(state).label);
    });

    it.each([
      ["USD", 240000],
      ["EUR", 1],
      ["JPY", 240000],
      ["USD", 0],
    ])("formats %s %i minor units only through formatMoney", (currency, priceMinor) => {
      const input = { ...withMilestones([milestone({ priceMinor })], []) };
      input.deal = { ...input.deal, currency };
      const diamond = toGanttData(input).tasks[0]?.children?.at(-1) as GanttTask;
      expect(diamond.price).toBe(formatMoney({ currency, minor: priceMinor }));
    });
  });

  describe("tasks", () => {
    it("are manually scheduled, not resizable, and end start plus duration", () => {
      const { tasks } = toGanttData(
        withMilestones(
          [milestone()],
          [task({ id: "a", startDate: "2026-12-30", durationDays: 3 })],
        ),
      );
      expect(tasks[0]?.children?.[0]).toMatchObject({
        id: "a",
        kind: "task",
        startDate: "2026-12-30",
        endDate: "2027-01-02",
        manuallyScheduled: true,
        resizable: false,
      });
    });

    it("passes agent-written titles through untouched so the renderer treats them as text", () => {
      const title = `<img src=x onerror="alert(1)"> & "quotes"`;
      const { tasks } = toGanttData(withMilestones([milestone()], [task({ title })]));
      expect(tasks[0]?.children?.[0]?.name).toBe(title);
    });
  });

  describe("locked milestones", () => {
    it("lists exactly released, paid_out, refunded, cancelled and disputed", () => {
      expect([...LOCKED_STATES].sort()).toEqual(
        ["cancelled", "disputed", "paid_out", "refunded", "released"].sort(),
      );
    });

    it.each([...LOCKED_STATES])("makes every task of a %s milestone read-only", (state) => {
      const { tasks } = toGanttData(view(state));
      const group = tasks[0] as GanttTask;
      expect(group.readOnly).toBe(true);
      for (const t of group.children?.filter((c) => c.kind === "task") ?? []) {
        expect(t).toMatchObject({ readOnly: true, draggable: false, resizable: false });
      }
    });

    it.each(MilestoneState.options.filter((s) => !LOCKED_STATES.has(s)))(
      "keeps the tasks of a %s milestone draggable",
      (state) => {
        const { tasks } = toGanttData(view(state));
        const group = tasks[0] as GanttTask;
        expect(group.readOnly).toBe(false);
        for (const t of group.children?.filter((c) => c.kind === "task") ?? []) {
          expect(t).toMatchObject({ readOnly: false, draggable: true });
        }
      },
    );

    it("locks only the milestone that is locked", () => {
      const { tasks } = toGanttData(
        withMilestones(
          [
            milestone({ id: "m1", state: "released" }),
            milestone({ id: "m2", state: "in_progress" }),
          ],
          [task({ id: "a", milestoneId: "m1" }), task({ id: "b", milestoneId: "m2" })],
        ),
      );
      expect(tasks[0]?.children?.[0]).toMatchObject({ id: "a", readOnly: true, draggable: false });
      expect(tasks[1]?.children?.[0]).toMatchObject({ id: "b", readOnly: false, draggable: true });
    });
  });

  describe("dependencies", () => {
    const multi = withMilestones(
      [milestone({ id: "m1" }), milestone({ id: "m2", title: "Build", endDate: "2026-11-10" })],
      [
        task({ id: "a", milestoneId: "m1" }),
        task({ id: "b", milestoneId: "m1", startDate: "2026-10-15" }),
        task({ id: "c", milestoneId: "m2", startDate: "2026-11-01" }),
        task({ id: "d", milestoneId: "m2", startDate: "2026-11-05" }),
      ],
      [
        { fromTaskId: "a", toTaskId: "b" },
        { fromTaskId: "b", toTaskId: "c" },
        { fromTaskId: "c", toTaskId: "d" },
      ],
    );

    it("gives every dependency a unique id", () => {
      const { dependencies } = toGanttData(multi);
      const ids = dependencies.map((d) => d.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it("keeps the view's task links, including those across milestones", () => {
      const { dependencies } = toGanttData(multi);
      expect(dependencies).toContainEqual({ id: "a->b", fromTask: "a", toTask: "b" });
      expect(dependencies).toContainEqual({ id: "b->c", fromTask: "b", toTask: "c" });
      expect(dependencies).toContainEqual({ id: "c->d", fromTask: "c", toTask: "d" });
    });

    it("links every task of a milestone to that milestone's diamond and no other", () => {
      const { dependencies } = toGanttData(multi);
      const toDiamond = dependencies.filter((d) => d.toTask.startsWith("pay:"));
      expect(toDiamond.map((d) => [d.fromTask, d.toTask]).sort()).toEqual([
        ["a", "pay:m1"],
        ["b", "pay:m1"],
        ["c", "pay:m2"],
        ["d", "pay:m2"],
      ]);
    });

    it("only references tasks that exist in the tree", () => {
      const data = toGanttData(multi);
      const known = new Set(walk(data.tasks).map((t) => t.id));
      for (const d of data.dependencies) {
        expect(known.has(d.fromTask)).toBe(true);
        expect(known.has(d.toTask)).toBe(true);
      }
    });

    it("gives every row in the tree a unique id", () => {
      const ids = walk(toGanttData(multi).tasks).map((t) => t.id);
      expect(new Set(ids).size).toBe(ids.length);
    });
  });

  it("does not mutate its input", () => {
    const input = view();
    const before = structuredClone(input);
    toGanttData(input);
    toGanttData(input);
    expect(input).toEqual(before);
  });

  it("returns the same data for the same view", () => {
    expect(toGanttData(view())).toEqual(toGanttData(view()));
  });
});

describe("addDays", () => {
  it.each([
    ["2026-10-12", 0, "2026-10-12"],
    ["2026-10-31", 1, "2026-11-01"],
    ["2027-12-31", 1, "2028-01-01"],
    ["2028-02-28", 1, "2028-02-29"],
    ["2026-02-28", 1, "2026-03-01"],
    ["2026-03-01", -1, "2026-02-28"],
    ["2026-10-12", 365, "2027-10-12"],
  ])("addDays(%s, %i) is %s", (iso, days, expected) => {
    expect(addDays(iso, days)).toBe(expected);
  });

  it("is not affected by daylight saving transitions", () => {
    expect(addDays("2026-03-07", 2)).toBe("2026-03-09");
    expect(addDays("2026-10-31", 2)).toBe("2026-11-02");
  });
});

describe("toIsoDate", () => {
  it.each([
    [new Date(2026, 0, 5), "2026-01-05"],
    [new Date(2026, 11, 31), "2026-12-31"],
    [new Date(2028, 1, 29), "2028-02-29"],
    [new Date(2026, 9, 5, 23, 59, 59), "2026-10-05"],
    [new Date(2026, 9, 5, 0, 0, 0), "2026-10-05"],
  ])("formats the local calendar day of %s", (date, expected) => {
    expect(toIsoDate(date)).toBe(expected);
  });
});

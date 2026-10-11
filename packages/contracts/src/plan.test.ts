import { describe, expect, it } from "vitest";
import { AcceptanceCriteria } from "./criteria";
import { PlanDraft, planIssues } from "./plan";

const criteria = {
  checks: [{ kind: "url_live" as const, url: "https://staging.example.com" }],
  prose: ["Homepage matches the approved design"],
};

function at<T>(items: readonly T[], index: number): T {
  const item = items[index];
  if (item === undefined) throw new Error(`no item at index ${index}`);
  return item;
}

function plan(overrides: Partial<PlanDraft> = {}): PlanDraft {
  return {
    summary: "Storefront rebuild",
    currency: "USD",
    milestones: [
      {
        key: "m1",
        title: "Design",
        price: { currency: "USD", minor: 100000 },
        criteria,
        payees: [{ kind: "agency", shareBps: 10000 }],
      },
    ],
    tasks: [
      { key: "t1", title: "Wireframes", durationDays: 3, dependsOn: [], milestoneKey: "m1" },
      { key: "t2", title: "Visual design", durationDays: 5, dependsOn: ["t1"], milestoneKey: "m1" },
    ],
    ...overrides,
  };
}

describe("planIssues", () => {
  it("accepts a valid plan", () => {
    expect(planIssues(plan())).toEqual([]);
    expect(PlanDraft.safeParse(plan()).success).toBe(true);
  });

  it("detects dependency cycles", () => {
    const p = plan({
      tasks: [
        { key: "t1", title: "A", durationDays: 1, dependsOn: ["t2"], milestoneKey: "m1" },
        { key: "t2", title: "B", durationDays: 1, dependsOn: ["t1"], milestoneKey: "m1" },
      ],
    });
    expect(planIssues(p)).toContain("tasks contain a dependency cycle");
    expect(PlanDraft.safeParse(p).success).toBe(false);
  });

  it("detects unknown dependencies and milestones", () => {
    const p = plan({
      tasks: [{ key: "t1", title: "A", durationDays: 1, dependsOn: ["nope"], milestoneKey: "mX" }],
    });
    const issues = planIssues(p);
    expect(issues).toContain('task "t1" depends on unknown task "nope"');
    expect(issues).toContain('task "t1" references unknown milestone "mX"');
  });

  it("requires every milestone to have a task", () => {
    const base = plan();
    const p = plan({
      milestones: [...base.milestones, { ...at(base.milestones, 0), key: "m2", title: "Build" }],
    });
    expect(planIssues(p)).toContain('milestone "m2" has no tasks');
  });

  it("requires payee shares to sum to 100%", () => {
    const base = plan();
    const p = plan({
      milestones: [
        {
          ...at(base.milestones, 0),
          payees: [
            { kind: "agency", shareBps: 6000 },
            { kind: "subcontractor", name: "Dev", email: "dev@example.com", shareBps: 3000 },
          ],
        },
      ],
    });
    expect(planIssues(p)).toContain('milestone "m1" payee shares sum to 9000 bps, expected 10000');
  });

  it("requires milestone prices in the plan currency", () => {
    const base = plan();
    const p = plan({
      milestones: [{ ...at(base.milestones, 0), price: { currency: "EUR", minor: 100 } }],
    });
    expect(planIssues(p)).toContain('milestone "m1" is priced in EUR, plan currency is USD');
  });

  it("rejects duplicate keys", () => {
    const base = plan();
    const p = plan({ tasks: [at(base.tasks, 0), { ...at(base.tasks, 1), key: "t1" }] });
    expect(planIssues(p)).toContain('duplicate task key "t1"');
  });
  it("does not report a cycle when a task lists the same dependency twice", () => {
    const p = plan({
      tasks: [
        { key: "a", title: "A", durationDays: 1, dependsOn: [], milestoneKey: "m1" },
        { key: "b", title: "B", durationDays: 1, dependsOn: ["a", "a"], milestoneKey: "m1" },
      ],
    });
    expect(planIssues(p)).not.toContain("tasks contain a dependency cycle");
  });

  it("still reports a cycle that includes a duplicated dependency", () => {
    const p = plan({
      tasks: [
        { key: "a", title: "A", durationDays: 1, dependsOn: ["b", "b"], milestoneKey: "m1" },
        { key: "b", title: "B", durationDays: 1, dependsOn: ["a"], milestoneKey: "m1" },
      ],
    });
    expect(planIssues(p)).toContain("tasks contain a dependency cycle");
  });
});

describe("AcceptanceCriteria", () => {
  it("requires at least one machine check", () => {
    expect(AcceptanceCriteria.safeParse({ checks: [], prose: ["looks good"] }).success).toBe(false);
  });
});

describe("plan review focus", () => {
  it("rejects a dependency cycle through PlanDraft.parse", () => {
    const p = plan({
      tasks: [
        { key: "t1", title: "A", durationDays: 1, dependsOn: ["t2"], milestoneKey: "m1" },
        { key: "t2", title: "B", durationDays: 1, dependsOn: ["t1"], milestoneKey: "m1" },
      ],
    });
    expect(() => PlanDraft.parse(p)).toThrow(/dependency cycle/);
  });

  it("detects a task that depends on itself", () => {
    const p = plan({
      tasks: [{ key: "t1", title: "A", durationDays: 1, dependsOn: ["t1"], milestoneKey: "m1" }],
    });
    expect(planIssues(p)).toContain("tasks contain a dependency cycle");
  });

  it("detects a longer cycle that hangs off an acyclic task", () => {
    const p = plan({
      tasks: [
        { key: "t1", title: "A", durationDays: 1, dependsOn: [], milestoneKey: "m1" },
        { key: "t2", title: "B", durationDays: 1, dependsOn: ["t1", "t4"], milestoneKey: "m1" },
        { key: "t3", title: "C", durationDays: 1, dependsOn: ["t2"], milestoneKey: "m1" },
        { key: "t4", title: "D", durationDays: 1, dependsOn: ["t3"], milestoneKey: "m1" },
      ],
    });
    expect(planIssues(p)).toContain("tasks contain a dependency cycle");
  });

  it("accepts a diamond dependency graph", () => {
    const p = plan({
      tasks: [
        { key: "t1", title: "A", durationDays: 1, dependsOn: [], milestoneKey: "m1" },
        { key: "t2", title: "B", durationDays: 1, dependsOn: ["t1"], milestoneKey: "m1" },
        { key: "t3", title: "C", durationDays: 1, dependsOn: ["t1"], milestoneKey: "m1" },
        { key: "t4", title: "D", durationDays: 1, dependsOn: ["t2", "t3"], milestoneKey: "m1" },
      ],
    });
    expect(planIssues(p)).toEqual([]);
    expect(PlanDraft.safeParse(p).success).toBe(true);
  });

  it("rejects payee shares that do not sum to 100% through PlanDraft.parse", () => {
    const base = plan();
    const p = plan({
      milestones: [
        {
          ...at(base.milestones, 0),
          payees: [
            { kind: "agency", shareBps: 6000 },
            { kind: "subcontractor", name: "Dev", email: "dev@example.com", shareBps: 3000 },
          ],
        },
      ],
    });
    expect(() => PlanDraft.parse(p)).toThrow(/9000 bps/);
  });

  it("rejects payee shares above 100%", () => {
    const base = plan();
    const p = plan({
      milestones: [
        {
          ...at(base.milestones, 0),
          payees: [
            { kind: "agency", shareBps: 7000 },
            { kind: "subcontractor", name: "Dev", email: "dev@example.com", shareBps: 4000 },
          ],
        },
      ],
    });
    expect(planIssues(p)).toContain('milestone "m1" payee shares sum to 11000 bps, expected 10000');
  });

  it("accepts payee shares that split exactly to 100%", () => {
    const base = plan();
    const p = plan({
      milestones: [
        {
          ...at(base.milestones, 0),
          payees: [
            { kind: "agency", shareBps: 7000 },
            { kind: "subcontractor", name: "Dev", email: "dev@example.com", shareBps: 3000 },
          ],
        },
      ],
    });
    expect(planIssues(p)).toEqual([]);
    expect(PlanDraft.safeParse(p).success).toBe(true);
  });

  it("rejects a milestone whose criteria have no machine check", () => {
    const base = plan();
    const p = plan({
      milestones: [{ ...at(base.milestones, 0), criteria: { checks: [], prose: ["looks good"] } }],
    });
    expect(PlanDraft.safeParse(p).success).toBe(false);
  });
});

describe("AcceptanceCriteria shapes", () => {
  it("accepts one machine check with prose", () => {
    expect(AcceptanceCriteria.safeParse(criteria).success).toBe(true);
  });

  it("accepts a machine check with no prose", () => {
    expect(AcceptanceCriteria.safeParse({ checks: criteria.checks, prose: [] }).success).toBe(true);
  });

  it("does not let prose stand in for a machine check", () => {
    expect(AcceptanceCriteria.safeParse({ checks: [], prose: ["a", "b", "c"] }).success).toBe(
      false,
    );
    expect(AcceptanceCriteria.safeParse({ prose: ["looks good"] }).success).toBe(false);
  });

  it("rejects an unknown check kind", () => {
    const result = AcceptanceCriteria.safeParse({ checks: [{ kind: "vibes_ok" }], prose: [] });
    expect(result.success).toBe(false);
  });

  it("accepts each machine check kind", () => {
    const checks = [
      { kind: "pr_merged", repo: "acme/shop", base: "main" },
      { kind: "ci_green", repo: "acme/shop" },
      { kind: "url_live", url: "https://staging.example.com" },
      { kind: "lighthouse", url: "https://staging.example.com", category: "performance", min: 90 },
    ];
    for (const check of checks) {
      expect(AcceptanceCriteria.safeParse({ checks: [check], prose: [] }).success).toBe(true);
    }
  });
});

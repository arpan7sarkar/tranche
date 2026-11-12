import type { PlanDraft } from "@tranche/contracts";
import { expect, it } from "vitest";
import { plannerIssues } from "./planner";

const plan: PlanDraft = {
  summary: "Portfolio",
  currency: "USD",
  milestones: [
    {
      key: "build",
      title: "Build",
      price: { currency: "USD", minor: 20000 },
      criteria: { checks: [{ kind: "url_live" }], prose: ["An accessible portfolio"] },
      payees: [{ kind: "agency", shareBps: 10000 }],
    },
  ],
  tasks: [{ key: "build", title: "Build", durationDays: 2, dependsOn: [], milestoneKey: "build" }],
};
const rate = { currency: "USD", dailyRateMinor: 10000, minimumProjectMinor: 10000 };
it("plans without a deployment URL and treats references only as context", () => {
  const options = {
    repo: null,
    stagingUrl: null,
    referenceUrl: "https://www.figma.com/design/abc",
    startDate: "2026-11-12",
  };
  expect(plannerIssues(plan, rate, options)).toEqual([]);
  const invalid = structuredClone(plan);
  const milestone = invalid.milestones[0];
  if (!milestone) throw new Error("missing_test_milestone");
  milestone.criteria.checks = [{ kind: "url_live", url: options.referenceUrl }];
  expect(plannerIssues(invalid, rate, options).length).toBeGreaterThan(0);
  expect(
    plannerIssues(invalid, rate, { ...options, stagingUrl: options.referenceUrl }).length,
  ).toBeGreaterThan(0);
});

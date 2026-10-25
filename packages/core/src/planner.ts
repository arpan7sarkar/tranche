import { type PlanCandidate, planIssues, type RateCard } from "@tranche/contracts";
import { schedulePlan } from "./schedule";

export function plannerIssues(
  plan: PlanCandidate,
  rate: RateCard,
  allowed: {
    repo: string | null;
    stagingUrl: string;
    startDate: string;
  },
): string[] {
  const issues = planIssues(plan);
  if (plan.currency !== rate.currency) issues.push("Plan currency must match the rate card");
  const days = plan.tasks.reduce((n, t) => n + t.durationDays, 0);
  const estimate = days * rate.dailyRateMinor;
  const total = plan.milestones.reduce((n, m) => n + m.price.minor, 0);
  if (!Number.isSafeInteger(estimate) || !Number.isSafeInteger(total))
    issues.push("Price overflow");
  if (total < rate.minimumProjectMinor) issues.push("Total is below the minimum project price");
  if (total < estimate * 0.7 || total > estimate * 1.5)
    issues.push("Total must be within 70%-150% of task days times daily rate");
  const origin = new URL(allowed.stagingUrl).origin;
  for (const milestone of plan.milestones) {
    if (milestone.price.minor <= 0) issues.push("Every milestone must have a positive price");
    if (milestone.payees.length !== 1 || milestone.payees[0]?.kind !== "agency")
      issues.push("Only the agency_pays payment path is supported");
    for (const check of milestone.criteria.checks) {
      if (check.kind === "pr_merged" || check.kind === "ci_green") {
        if (!allowed.repo || check.repo !== allowed.repo)
          issues.push("Checks must use the supplied repository");
      } else {
        const url = new URL(check.url);
        if (
          !["https:", "http:"].includes(url.protocol) ||
          url.origin !== origin ||
          url.username ||
          url.password
        )
          issues.push("Checks must use the staging origin without credentials");
      }
    }
  }
  if (!issues.length) {
    try {
      schedulePlan(plan.tasks, allowed.startDate);
    } catch {
      issues.push("The plan cannot be scheduled");
    }
  }
  return issues;
}

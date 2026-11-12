import type { AcceptanceCriteria, MachineCheck } from "@tranche/contracts";

// A manual delivery has no repo, so these checks could only ever fail on it.
export const needsPullRequest = (criteria: AcceptanceCriteria): boolean =>
  criteria.checks.some((c) => c.kind === "pr_merged" || c.kind === "ci_green");

export function describeCheck(check: MachineCheck): string {
  switch (check.kind) {
    case "pr_merged":
      return `Pull request merged into ${check.base} in ${check.repo}`;
    case "ci_green":
      return `CI passes in ${check.repo}`;
    case "url_live":
      return check.url
        ? `${check.url} is live`
        : "Delivery URL required when submitting work; the deployed website must be live";
    case "lighthouse":
      return `Lighthouse ${check.category} ${check.min}+ on ${check.url}`;
  }
}

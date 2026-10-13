import type { MachineCheck } from "@tranche/contracts";

export function describeCheck(check: MachineCheck): string {
  switch (check.kind) {
    case "pr_merged":
      return `Pull request merged into ${check.base} in ${check.repo}`;
    case "ci_green":
      return `CI passes in ${check.repo}`;
    case "url_live":
      return `${check.url} is live`;
    case "lighthouse":
      return `Lighthouse ${check.category} ${check.min}+ on ${check.url}`;
  }
}

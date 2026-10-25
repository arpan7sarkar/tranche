import type { MachineCheck } from "@tranche/contracts";
import type { GitHubReader } from "./github";
import {
  assertPublicUrl,
  InfrastructureError,
  type SafeFetch,
  safeFetch,
  UnsafeUrlError,
} from "./network";

export type Delivery = {
  inboxId: string;
  repo: string | null;
  sha: string | null;
  prNumber: number | null;
  urls: string[];
  notes?: string;
};
export type CheckResult = { passed: boolean; summary: string; data: Record<string, unknown> };
export type CheckDeps = {
  github: () => GitHubReader;
  fetch: SafeFetch;
  pagespeedKey?: string | undefined;
  pagespeedBase?: string | undefined;
};
export async function runCheck(
  check: MachineCheck,
  delivery: Delivery,
  deps: CheckDeps,
): Promise<CheckResult> {
  const result = (
    passed: boolean,
    summary: string,
    data: Record<string, unknown> = {},
  ): CheckResult => ({ passed, summary, data });
  if (check.kind === "pr_merged" || check.kind === "ci_green") {
    if (
      !delivery.repo ||
      delivery.repo.toLowerCase() !== check.repo.toLowerCase() ||
      !delivery.sha ||
      !delivery.prNumber
    )
      return result(false, "Delivery does not identify the required repository and commit");
    const reader = deps.github();
    const pull = await reader.getPull(delivery.repo, delivery.prNumber);
    if (!pull.merged || pull.sha !== delivery.sha)
      return result(false, "The delivered pull request is not merged at this commit");
    if (check.kind === "pr_merged")
      return result(pull.base === check.base, `Merged target branch: ${pull.base}`, {
        sha: pull.sha,
      });
    const ci = await reader.getCiState(delivery.repo, delivery.sha);
    // A missing run may appear after the merge webhook. Leave the event unacknowledged.
    if (ci === "pending" || ci === "none")
      throw new InfrastructureError("CI is not complete; retry verification later");
    return result(ci === "success", `CI: ${ci}`, { sha: delivery.sha });
  }
  try {
    const response = await deps.fetch(check.url);
    if (response.status < 200 || response.status >= 300)
      return result(false, `Page returned HTTP ${response.status}`);
    if (check.kind === "url_live")
      return result(true, "Page is reachable", { url: response.url, status: response.status });
    await assertPublicUrl(response.url);
    const endpoint = new URL(
      "/pagespeedonline/v5/runPagespeed",
      deps.pagespeedBase || "https://www.googleapis.com",
    );
    await assertPublicUrl(endpoint.href);
    endpoint.searchParams.set("url", response.url);
    endpoint.searchParams.set("category", check.category);
    endpoint.searchParams.set("strategy", "mobile");
    if (deps.pagespeedKey) endpoint.searchParams.set("key", deps.pagespeedKey);
    const report = await deps.fetch(endpoint.href);
    if (report.status !== 200) throw new InfrastructureError("PageSpeed unavailable");
    const data = JSON.parse(report.body.toString("utf8"));
    const score = data.lighthouseResult?.categories?.[check.category]?.score;
    const finalUrl = data.lighthouseResult?.finalUrl;
    if (typeof score !== "number" || score < 0 || score > 1 || typeof finalUrl !== "string")
      throw new InfrastructureError("Invalid PageSpeed result");
    await assertPublicUrl(finalUrl);
    if (new URL(finalUrl).origin !== new URL(response.url).origin)
      return result(false, "PageSpeed navigated to a different origin");
    return result(
      score * 100 >= check.min,
      `${check.category}: ${Math.round(score * 100)} (required ${check.min})`,
      { score: score * 100, url: finalUrl },
    );
  } catch (error) {
    if (error instanceof UnsafeUrlError) return result(false, "URL safety check failed");
    throw error;
  }
}
export const defaultCheckDeps = (github: () => GitHubReader): CheckDeps => ({
  github,
  fetch: safeFetch,
  pagespeedKey: process.env.PAGESPEED_API_KEY,
  pagespeedBase: process.env.PAGESPEED_API_BASE,
});

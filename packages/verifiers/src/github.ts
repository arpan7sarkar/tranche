import { RepoRef } from "@tranche/contracts";
import { App } from "octokit";
import { InfrastructureError } from "./network";

export type CiState = "success" | "failure" | "pending" | "none";
export type Pull = {
  merged: boolean;
  base: string;
  sha: string | null;
  headSha: string;
  title: string;
  body: string;
};
export type GitHubReader = {
  getPull(repo: string, number: number): Promise<Pull>;
  getPullFiles(repo: string, number: number): Promise<string>;
  getCiState(repo: string, sha: string): Promise<CiState>;
};
export function aggregateCi(
  runs: Array<{ status: string; conclusion: string | null }>,
  combined: { state: string; totalCount: number },
): CiState {
  if (!runs.length && !combined.totalCount) return "none";
  if (
    runs.some((r) => r.status !== "completed") ||
    (combined.totalCount > 0 && combined.state === "pending")
  )
    return "pending";
  return runs.some((r) => !["success", "neutral", "skipped"].includes(r.conclusion ?? "")) ||
    (combined.totalCount > 0 && combined.state !== "success")
    ? "failure"
    : "success";
}
export function createGitHubReader(env: NodeJS.ProcessEnv = process.env): GitHubReader {
  if (!env.GITHUB_APP_ID || !env.GITHUB_APP_PRIVATE_KEY)
    throw new InfrastructureError("GitHub App is not configured");
  const app = new App({
    appId: env.GITHUB_APP_ID,
    privateKey: env.GITHUB_APP_PRIVATE_KEY.replace(/\\n/g, "\n"),
  });
  async function forRepo(raw: string) {
    const [owner, repo] = RepoRef.parse(raw).split("/") as [string, string];
    try {
      const { data } = await app.octokit.request("GET /repos/{owner}/{repo}/installation", {
        owner,
        repo,
        request: { timeout: 15000 },
      });
      return { api: await app.getInstallationOctokit(data.id), owner, repo };
    } catch {
      throw new InfrastructureError("Repository is inaccessible to the GitHub App");
    }
  }
  return {
    async getPull(repo, number) {
      const { api, ...target } = await forRepo(repo);
      const { data } = await api.rest.pulls.get({
        ...target,
        pull_number: number,
        request: { timeout: 15000 },
      });
      return {
        merged: data.merged,
        base: data.base.ref,
        sha: data.merge_commit_sha,
        headSha: data.head.sha,
        title: data.title,
        body: data.body ?? "",
      };
    },
    async getPullFiles(repo, number) {
      const { api, ...target } = await forRepo(repo);
      const { data } = await api.rest.pulls.listFiles({
        ...target,
        pull_number: number,
        per_page: 100,
        request: { timeout: 15000 },
      });
      return data
        .map((f) => `${f.filename}\n${(f.patch ?? "").slice(0, 2000)}`)
        .join("\n")
        .slice(0, 30000);
    },
    async getCiState(repo, sha) {
      const { api, ...target } = await forRepo(repo);
      const runs = await api.paginate(api.rest.checks.listForRef, {
        ...target,
        ref: sha,
        per_page: 100,
        request: { timeout: 15000 },
      });
      const { data } = await api.rest.repos.getCombinedStatusForRef({
        ...target,
        ref: sha,
        request: { timeout: 15000 },
      });
      return aggregateCi(runs, { state: data.state, totalCount: data.total_count });
    },
  };
}

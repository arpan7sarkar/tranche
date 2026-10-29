import type { GitHubReader, Pull } from "@tranche/verifiers";
export const githubFixture = {
  repo: "test/site",
  number: 1,
  pull: {
    merged: true,
    base: "main",
    sha: "a".repeat(40),
    headSha: "b".repeat(40),
    title: "Deliver work",
    body: "Implemented the agreed work",
  },
  files: "work.ts",
  ci: "success" as const,
};
export function fakeGitHub(input: {
  repo: string;
  number: number;
  pull: Pull;
  files: string;
  ci: "success" | "failure";
}): GitHubReader {
  const check = (repo: string) => {
    if (repo !== input.repo) throw new Error("fake_foreign_repository");
  };
  return {
    async getPull(repo, number) {
      check(repo);
      if (number !== input.number) throw new Error("fake_pull_missing");
      return structuredClone(input.pull);
    },
    async getPullFiles(repo, number) {
      check(repo);
      if (number !== input.number) throw new Error("fake_pull_missing");
      return input.files;
    },
    async getCiState(repo, sha) {
      check(repo);
      if (sha !== input.pull.sha) throw new Error("fake_commit_missing");
      return input.ci;
    },
  };
}

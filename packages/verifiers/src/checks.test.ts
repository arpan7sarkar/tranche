import { afterEach, expect, it, vi } from "vitest";
import { type CheckDeps, type Delivery, defaultCheckDeps, runCheck } from "./checks";
import { aggregateCi, type GitHubReader } from "./github";
import { repositoryAllowed } from "./repositories";

const delivery: Delivery = {
  inboxId: crypto.randomUUID(),
  repo: null,
  sha: null,
  prNumber: null,
  urls: [],
};
afterEach(() => vi.unstubAllEnvs());
it("uses the configured PageSpeed endpoint and applies the score threshold", async () => {
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("VERIFIER_ALLOW_TEST_LOCALHOST", "1");
  vi.stubEnv("PAGESPEED_API_BASE", "http://localhost:4020");
  const target = "http://93.184.216.34/";
  const fetch = vi.fn(async (url: string) => ({
    url,
    status: 200,
    headers: {},
    body: Buffer.from(
      JSON.stringify({
        lighthouseResult: {
          finalUrl: target,
          categories: { performance: { score: 0.79 } },
        },
      }),
    ),
  }));
  const deps = { ...defaultCheckDeps(vi.fn()), fetch };
  const result = await runCheck(
    { kind: "lighthouse", url: target, category: "performance", min: 80 },
    delivery,
    deps,
  );
  expect(result.passed).toBe(false);
  expect(fetch.mock.calls[1]?.[0]).toBe(
    "http://localhost:4020/pagespeedonline/v5/runPagespeed?url=http%3A%2F%2F93.184.216.34%2F&category=performance&strategy=mobile",
  );
});
it("rejects private PageSpeed endpoints even with the test flag in production", async () => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("VERIFIER_ALLOW_TEST_LOCALHOST", "1");
  const fetch = vi.fn(async (url: string) => ({
    url,
    status: 200,
    headers: {},
    body: Buffer.from(""),
  }));
  const result = await runCheck(
    { kind: "lighthouse", url: "http://93.184.216.34/", category: "performance", min: 80 },
    delivery,
    { github: vi.fn(), fetch, pagespeedBase: "http://localhost:4020" },
  );
  expect(result.passed).toBe(false);
  expect(fetch).toHaveBeenCalledTimes(1);
});
it("keeps PageSpeed outages retryable without recording a failed criterion", async () => {
  const fetch = vi.fn(async (url: string) => ({
    url,
    status: url.includes("runPagespeed") ? 429 : 200,
    headers: {},
    body: Buffer.from(""),
  }));
  await expect(
    runCheck(
      { kind: "lighthouse", url: "http://93.184.216.34/", category: "performance", min: 80 },
      delivery,
      { github: vi.fn(), fetch, pagespeedBase: "http://93.184.216.35" },
    ),
  ).rejects.toThrow("PageSpeed unavailable");
});
it("rejects repository checks for manual deliveries without calling GitHub", async () => {
  const deps = { github: vi.fn(), fetch: vi.fn() };
  expect((await runCheck({ kind: "ci_green", repo: "a/b" }, delivery, deps)).passed).toBe(false);
  expect(deps.github).not.toHaveBeenCalled();
});
it("keeps missing and pending CI retryable, and verifies the merged commit", async () => {
  const github: GitHubReader = {
    getPull: async () => ({
      merged: true,
      base: "main",
      sha: "merge",
      headSha: "head",
      title: "PR",
      body: "",
    }),
    getPullFiles: async () => "",
    getCiState: vi.fn(async () => "none" as const),
  };
  const deps: CheckDeps = { github: () => github, fetch: vi.fn() };
  const d = { ...delivery, repo: "a/b", sha: "merge", prNumber: 1 };
  await expect(runCheck({ kind: "ci_green", repo: "a/b" }, d, deps)).rejects.toThrow(
    "retry verification",
  );
  expect((await runCheck({ kind: "pr_merged", repo: "a/b", base: "other" }, d, deps)).passed).toBe(
    false,
  );
  expect(
    (await runCheck({ kind: "pr_merged", repo: "a/b", base: "main" }, { ...d, sha: "head" }, deps))
      .passed,
  ).toBe(false);
});
it("aggregates failing and absent CI conservatively", () => {
  expect(aggregateCi([], { state: "pending", totalCount: 0 })).toBe("none");
  expect(
    aggregateCi([{ status: "queued", conclusion: null }], { state: "success", totalCount: 1 }),
  ).toBe("pending");
  expect(
    aggregateCi([{ status: "completed", conclusion: "failure" }], {
      state: "success",
      totalCount: 1,
    }),
  ).toBe("failure");
  expect(
    aggregateCi([{ status: "completed", conclusion: "success" }], {
      state: "success",
      totalCount: 1,
    }),
  ).toBe("success");
});
it("denies repositories outside the workspace binding", () => {
  expect(repositoryAllowed("one", "a/b", '{"one":["a/b"]}')).toBe(true);
  expect(repositoryAllowed("two", "a/b", '{"one":["a/b"]}')).toBe(false);
  expect(repositoryAllowed("one", "a/b", "invalid")).toBe(false);
});

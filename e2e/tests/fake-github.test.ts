import { expect, it } from "vitest";
import { fakeGitHub } from "../fakes/github";

it("returns only the explicitly configured PR and commit", async () => {
  const reader = fakeGitHub({
    repo: "test/site",
    number: 1,
    pull: {
      merged: true,
      base: "main",
      sha: "abc",
      headSha: "head",
      title: "Cart",
      body: "Review",
    },
    files: "cart.ts",
    ci: "failure",
  });
  expect(await reader.getCiState("test/site", "abc")).toBe("failure");
  expect((await reader.getPull("test/site", 1)).merged).toBe(true);
  await expect(reader.getPull("foreign/site", 1)).rejects.toThrow("fake_foreign_repository");
  await expect(reader.getCiState("test/site", "other")).rejects.toThrow("fake_commit_missing");
});

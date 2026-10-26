import { createHmac } from "node:crypto";
import { createAgentTestDb, makeDeal } from "@tranche/agents/testing";
import { type Db, schema } from "@tranche/db";
import { truncateAll } from "@tranche/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { recordGitHubDelivery, verifyGitHubSignature } from "./github-deliveries";

it("checks the exact signed webhook body", () => {
  const body = '{"action":"closed"}';
  const signature = `sha256=${createHmac("sha256", "secret").update(body).digest("hex")}`;
  expect(verifyGitHubSignature("secret", body, signature)).toBe(true);
  expect(verifyGitHubSignature("secret", `${body} `, signature)).toBe(false);
  expect(verifyGitHubSignature(undefined, body, signature)).toBe(false);
  expect(verifyGitHubSignature("secret", body, "bad")).toBe(false);
});
describe.runIf(Boolean(process.env.TEST_DATABASE_URL))("GitHub delivery intake", () => {
  let db: Db;
  beforeAll(async () => {
    db = await createAgentTestDb("github_intake");
  });
  beforeEach(async () => {
    await truncateAll(db);
  });
  afterAll(async () => {
    await db?.$client.end();
    vi.unstubAllEnvs();
  });
  it("deduplicates semantic delivery and isolates repositories by workspace", async () => {
    const a = await makeDeal(db);
    const b = await makeDeal(db);
    await db.update(schema.milestone).set({
      state: "in_progress",
      criteria: { checks: [{ kind: "pr_merged", repo: "a/b", base: "main" }], prose: [] },
    });
    vi.stubEnv("GITHUB_WORKSPACE_REPOSITORIES", JSON.stringify({ [a.workspaceId]: ["a/b"] }));
    const payload = {
      action: "closed",
      repository: { full_name: "a/b" },
      pull_request: {
        number: 5,
        merged: true,
        merge_commit_sha: "a".repeat(40),
        base: { ref: "main" },
      },
    };
    expect(await recordGitHubDelivery(db, payload)).toBe(1);
    expect(await recordGitHubDelivery(db, payload)).toBe(0);
    const rows = await db.select().from(schema.inbox);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.message).toMatchObject({ milestoneId: a.milestoneId });
    expect(JSON.stringify(rows)).not.toContain(b.milestoneId);
    await db
      .update(schema.milestone)
      .set({ state: "changes_requested", version: 2 })
      .where(eq(schema.milestone.id, a.milestoneId));
    expect(await recordGitHubDelivery(db, payload)).toBe(1);
    expect(
      await recordGitHubDelivery(db, {
        ...payload,
        pull_request: { ...payload.pull_request, merged: false },
      }),
    ).toBe(0);
    expect(
      await recordGitHubDelivery(db, {
        ...payload,
        pull_request: { ...payload.pull_request, base: { ref: "other" } },
      }),
    ).toBe(0);
  });
});

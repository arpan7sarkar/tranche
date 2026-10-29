import { createHmac } from "node:crypto";
import { schema } from "@tranche/db";
import { eq } from "drizzle-orm";
import { githubFixture } from "../fakes/github";
import { clientContext, expect, test } from "../support/browser";
import { openFixtureDb } from "../support/database";
import { appEnv } from "../support/environment";
import { approveWithPayPal } from "../support/paypal-sandbox";
import { readState, STAGING } from "../support/state";

test("pending delivery survives reload and a failed inbox delivery can be resubmitted", async ({
  page,
  browser,
}) => {
  const { recovery } = readState();
  await page.goto(`/deals/${recovery.dealId}`);
  await page.getByTestId("send-plan").click();
  const context = await clientContext(browser);
  const client = await context.newPage();
  await client.goto(`/portal/${recovery.portalToken}`);
  await approveWithPayPal(client, () => client.getByTestId("approve-plan").click());
  await expect(page.getByTestId("milestone-work")).toHaveAttribute("data-state", "held");
  const db = await openFixtureDb();
  try {
    const [milestone] = await db
      .select()
      .from(schema.milestone)
      .where(eq(schema.milestone.id, recovery.milestoneId));
    if (!milestone) throw new Error("missing_fixture");
    // Pause this inbox row so both UI states are deterministic while other workers keep running.
    const [delivery] = await db
      .insert(schema.inbox)
      .values({
        source: "user",
        sourceEventId: `manual:${milestone.id}:${milestone.version}`,
        message: {
          type: "delivery.detected",
          milestoneId: milestone.id,
          source: "manual",
          repo: null,
          sha: null,
          prNumber: null,
          urls: [`${STAGING}/good`],
        },
        nextAttemptAt: new Date(Date.now() + 86_400_000),
      })
      .returning();
    if (!delivery) throw new Error("missing_fixture");
    await page.reload();
    await expect(page.getByTestId("delivery-pending-work")).toBeVisible();
    await expect(page.getByTestId("mark-delivered-work")).toHaveCount(0);
    await db
      .update(schema.inbox)
      .set({ attempts: 1, lastError: "Injected worker interruption" })
      .where(eq(schema.inbox.id, delivery.id));
    await page.reload();
    await expect(page.getByTestId("delivery-failed-work")).toBeVisible();
    await page.getByTestId("resubmit-delivery-work").click();
    await page.getByTestId("delivery-url-input").fill(`${STAGING}/good`);
    await page.getByTestId("delivery-notes-input").fill("Retry after worker interruption");
    await page.getByTestId("submit-delivery").click();
    await expect(page.getByTestId("milestone-work")).toHaveAttribute(
      "data-state",
      "release_pending",
    );
    const rows = await db
      .select()
      .from(schema.inbox)
      .where(eq(schema.inbox.sourceEventId, delivery.sourceEventId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(delivery.id);
    expect(rows[0]?.processedAt).not.toBeNull();
  } finally {
    await db.$client.end();
    await context.close();
  }
});

test("a signed PR webhook verifies against the fake GitHub reader", async ({
  page,
  browser,
  request,
}) => {
  const { pullRequest } = readState();
  await page.goto(`/deals/${pullRequest.dealId}`);
  await page.getByTestId("send-plan").click();
  const context = await clientContext(browser);
  try {
    const client = await context.newPage();
    await client.goto(`/portal/${pullRequest.portalToken}`);
    await approveWithPayPal(client, () => client.getByTestId("approve-plan").click());
    await expect(page.getByTestId("delivery-via-pr-work")).toBeVisible();
    await expect(page.getByTestId("mark-delivered-work")).toHaveCount(0);
    const data = JSON.stringify({
      action: "closed",
      repository: { full_name: githubFixture.repo },
      pull_request: {
        number: githubFixture.number,
        merged: true,
        merge_commit_sha: githubFixture.pull.sha,
        base: { ref: "main" },
      },
    });
    const headers = {
      "content-type": "application/json",
      "x-github-event": "pull_request",
      "x-hub-signature-256": `sha256=${createHmac("sha256", appEnv.GITHUB_WEBHOOK_SECRET).update(data).digest("hex")}`,
    };
    expect(
      (
        await request.post("/api/github/webhook", {
          data,
          headers: { ...headers, "x-hub-signature-256": `sha256=${"0".repeat(64)}` },
        })
      ).status(),
    ).toBe(401);
    expect((await request.post("/api/github/webhook", { data, headers })).status()).toBe(202);
    expect((await request.post("/api/github/webhook", { data, headers })).status()).toBe(202);
    await expect(page.getByTestId("milestone-work")).toHaveAttribute(
      "data-state",
      "release_pending",
    );
    await expect(page.getByTestId("evidence-work")).toContainText("CI: success");
  } finally {
    await context.close();
  }
});

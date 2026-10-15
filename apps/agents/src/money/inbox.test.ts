import { type Db, schema } from "@tranche/db";
import { createTestDb, truncateAll } from "@tranche/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { must } from "./errors";
import { processInbox } from "./inbox";
import { eventTypes, makeHold, makeMilestone, NOW, testDeps } from "./test-helpers";

let db: Db;

describe.runIf(Boolean(process.env.DATABASE_URL))("processInbox", () => {
  beforeAll(async () => {
    db = await createTestDb("agents");
  });
  beforeEach(async () => {
    await truncateAll(db);
  });
  afterAll(async () => {
    await db.$client.end();
  });

  it("processes a duplicated webhook once", async () => {
    const { milestoneId } = await makeMilestone(db, { state: "funding" });
    await makeHold(db, milestoneId);
    const row = {
      source: "paypal" as const,
      sourceEventId: "WH-1",
      nextAttemptAt: NOW,
      message: {
        type: "paypal.webhook" as const,
        eventType: "PAYMENT.AUTHORIZATION.CREATED",
        resource: {
          id: "AUTH-1",
          amount: { currency_code: "USD", value: "1000.00" },
          expiration_time: "2026-11-08T10:00:00Z",
          supplementary_data: { related_ids: { order_id: "ORDER-1" } },
        },
      },
    };
    await db.insert(schema.inbox).values(row).onConflictDoNothing();
    await db.insert(schema.inbox).values(row).onConflictDoNothing();
    expect(await processInbox(testDeps(db))).toBe(1);
    expect(await processInbox(testDeps(db))).toBe(0);
    expect((await eventTypes(db, milestoneId)).filter((t) => t === "milestone.held")).toHaveLength(
      1,
    );
  });

  it("rolls back a half-applied message", async () => {
    const { milestoneId } = await makeMilestone(db, {
      state: "release_pending",
      heldMinor: 100000,
      verifiedAt: NOW,
    });
    const [timer] = await db
      .insert(schema.scheduledAction)
      .values({ milestoneId, kind: "auto_release", dueAt: NOW, status: "running" })
      .returning();
    await db.insert(schema.inbox).values({
      source: "timer",
      sourceEventId: must(timer).id,
      nextAttemptAt: NOW,
      message: { type: "timer.due", scheduledActionId: must(timer).id },
    });
    await processInbox(testDeps(db));
    const [row] = await db.select().from(schema.inbox);
    expect(row).toMatchObject({ processedAt: null, attempts: 1 });
    expect(row?.lastError).toMatch(/no active hold/);
    const [m] = await db
      .select()
      .from(schema.milestone)
      .where(eq(schema.milestone.id, milestoneId));
    expect(m).toMatchObject({ releaseAuthorizedAt: null, version: 0 });
    expect(await eventTypes(db, milestoneId)).toEqual([]);
    const [t] = await db.select().from(schema.scheduledAction);
    expect(t?.status).toBe("running");
  });
});

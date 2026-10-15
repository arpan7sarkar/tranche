import type { Db } from "@tranche/db";
import { schema } from "@tranche/db";
import { createTestDb, truncateAll } from "@tranche/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { processInbox } from "./inbox";
import { makeMilestone, NOW, testDeps } from "./test-helpers";
import { claimDueTimers, fundingDueAt } from "./timers";

describe("fundingDueAt", () => {
  it("funds three days ahead, or now when that is already past", () => {
    expect(fundingDueAt("2026-10-20", NOW).toISOString()).toBe("2026-10-17T00:00:00.000Z");
    expect(fundingDueAt("2026-10-11", NOW)).toEqual(NOW);
    expect(fundingDueAt(null, NOW)).toEqual(NOW);
  });
});

let db: Db;

describe.runIf(Boolean(process.env.DATABASE_URL))("claimDueTimers", () => {
  beforeAll(async () => {
    db = await createTestDb("agents");
  });
  beforeEach(async () => {
    await truncateAll(db);
  });
  afterAll(async () => {
    await db.$client.end();
  });

  it("claims only due timers and turns a fund timer into an outbox row", async () => {
    const { milestoneId } = await makeMilestone(db, { state: "agreed" });
    const [due] = await db
      .insert(schema.scheduledAction)
      .values({ milestoneId, kind: "fund", dueAt: NOW })
      .returning();
    await db
      .insert(schema.scheduledAction)
      .values({ milestoneId, kind: "remind", dueAt: new Date("2026-10-11T00:00:00Z") });
    expect(await claimDueTimers(testDeps(db))).toBe(1);
    const [t] = await db
      .select()
      .from(schema.scheduledAction)
      .where(eq(schema.scheduledAction.id, due?.id ?? ""));
    expect(t).toMatchObject({ status: "running", attempts: 1 });

    await processInbox(testDeps(db));
    const [row] = await db.select().from(schema.outbox);
    expect(row).toMatchObject({
      kind: "fund",
      requestId: `fund:${due?.id}`,
      scheduledActionId: due?.id,
    });
  });

  it("claims a due timer once under concurrency", async () => {
    const { milestoneId } = await makeMilestone(db);
    await db.insert(schema.scheduledAction).values({ milestoneId, kind: "remind", dueAt: NOW });
    const counts = await Promise.all([claimDueTimers(testDeps(db)), claimDueTimers(testDeps(db))]);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(1);
    expect(await db.select().from(schema.inbox)).toHaveLength(1);
  });
});

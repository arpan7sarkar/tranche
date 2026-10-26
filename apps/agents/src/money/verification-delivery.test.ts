import assert from "node:assert/strict";
import { type Db, schema } from "@tranche/db";
import { createTestDb, truncateAll } from "@tranche/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { runExecutor } from "./actions";
import { makeMilestone, testDeps } from "./test-helpers";

describe.runIf(Boolean(process.env.DATABASE_URL))("stale verification settlement", () => {
  let db: Db;
  beforeAll(async () => {
    db = await createTestDb("agents");
  });
  beforeEach(async () => {
    await truncateAll(db);
  });
  afterAll(async () => {
    await db?.$client.end();
  });
  it("does not settle an old delivery while a newer delivery is verifying", async () => {
    const ids = await makeMilestone(db, { state: "verifying" });
    await db.insert(schema.event).values({
      dealId: ids.dealId,
      milestoneId: ids.milestoneId,
      type: "milestone.verification_requested",
      payload: { deliveryId: crypto.randomUUID() },
    });
    const [action] = await db
      .insert(schema.proposedAction)
      .values({
        dealId: ids.dealId,
        agent: "verifier",
        side: "agency",
        type: "mark_verified",
        payload: {
          type: "mark_verified",
          milestoneId: ids.milestoneId,
          evidenceIds: [crypto.randomUUID()],
          deliveryId: crypto.randomUUID(),
        },
        reasoning: "Old verification",
        idempotencyKey: crypto.randomUUID(),
      })
      .returning();
    assert(action);
    await expect(db.transaction((tx) => runExecutor(tx, testDeps(db), action))).rejects.toThrow(
      "stale_delivery",
    );
    const [ms] = await db
      .select()
      .from(schema.milestone)
      .where(eq(schema.milestone.id, ids.milestoneId));
    expect(ms?.state).toBe("verifying");
  });
});

import { type Db, schema } from "@tranche/db";
import { createTestDb, truncateAll } from "@tranche/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { decideApproval, processActions } from "./actions";
import { must } from "./errors";
import { makeHold, makeMilestone, NOW, openPolicy, testDeps } from "./test-helpers";

let db: Db;

describe.runIf(Boolean(process.env.DATABASE_URL))("processActions", () => {
  beforeAll(async () => {
    db = await createTestDb("agents");
  });
  beforeEach(async () => {
    await truncateAll(db);
  });
  afterAll(async () => {
    await db.$client.end();
  });

  it("holds an over-limit release for approval", async () => {
    const { dealId, milestoneId } = await makeMilestone(db, {
      state: "release_pending",
      heldMinor: 100000,
      verifiedAt: NOW,
      clientPolicy: { ...openPolicy, perActionMaxMinor: 50000 },
    });
    await makeHold(db, milestoneId, { status: "active", authorizationId: "AUTH-1" });
    const [a] = await db
      .insert(schema.proposedAction)
      .values({
        dealId,
        agent: "negotiator",
        side: "client",
        type: "release",
        payload: { type: "release", milestoneId, amount: { currency: "USD", minor: 100000 } },
        reasoning: "test",
        idempotencyKey: "release:big:1",
      })
      .returning();
    const statusOf = async () =>
      (
        await db
          .select()
          .from(schema.proposedAction)
          .where(eq(schema.proposedAction.id, must(a).id))
      )[0]?.status;

    await processActions(testDeps(db));
    expect(await statusOf()).toBe("needs_approval");
    const [approval] = await db.select().from(schema.approval);
    expect(approval).toMatchObject({
      proposedActionId: must(a).id,
      side: "client",
      decision: null,
    });
    expect(await db.select().from(schema.outbox)).toHaveLength(0);

    await decideApproval(
      db,
      { approvalId: must(approval).id, decision: "approved", decidedBy: "client-user" },
      NOW,
    );
    await processActions(testDeps(db));
    expect(await statusOf()).toBe("executed");
    expect(await db.select().from(schema.outbox)).toHaveLength(1);
  });
});

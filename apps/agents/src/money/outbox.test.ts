import { type Db, schema } from "@tranche/db";
import { createTestDb, truncateAll } from "@tranche/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { must } from "./errors";
import { executeOutbox } from "./outbox";
import { fakePayPal, makeHold, makeMilestone, NOW, testDeps } from "./test-helpers";

let db: Db;

describe.runIf(Boolean(process.env.DATABASE_URL))("executeOutbox", () => {
  beforeAll(async () => {
    db = await createTestDb("agents");
  });
  beforeEach(async () => {
    await truncateAll(db);
  });
  afterAll(async () => {
    await db.$client.end();
  });

  it("retries with the same request id and settles once", async () => {
    const { milestoneId } = await makeMilestone(db, {
      state: "release_pending",
      heldMinor: 100000,
      verifiedAt: NOW,
      releaseAuthorizedAt: NOW,
    });
    const hold = await makeHold(db, milestoneId, { status: "active", authorizationId: "AUTH-1" });
    await db.insert(schema.outbox).values({
      kind: "release",
      request: { holdId: hold.id, amountMinor: 100000 },
      requestId: `release:${hold.id}`,
      nextAttemptAt: NOW,
    });
    const releaseHold = vi
      .fn()
      .mockRejectedValueOnce(new Error("socket hang up"))
      .mockResolvedValueOnce({ releaseRef: "CAPTURE-REL-1" });
    const paypal = fakePayPal({ releaseHold });

    await executeOutbox(testDeps(db, paypal));
    const [failed] = await db.select().from(schema.outbox).where(eq(schema.outbox.kind, "release"));
    expect(failed).toMatchObject({ status: "pending", attempts: 1, lastError: "socket hang up" });
    expect(must(failed).nextAttemptAt.toISOString()).toBe("2026-10-10T10:01:00.000Z");

    await executeOutbox(testDeps(db, paypal, () => new Date("2026-10-10T10:02:00Z")));
    expect(releaseHold.mock.calls.map((c) => c[0].requestId)).toEqual([
      `release:${hold.id}`,
      `release:${hold.id}`,
    ]);
    const [m] = await db
      .select()
      .from(schema.milestone)
      .where(eq(schema.milestone.id, milestoneId));
    expect(m).toMatchObject({ state: "released", releasedMinor: 100000 });
    const released = await db
      .select()
      .from(schema.event)
      .where(eq(schema.event.type, "milestone.released"));
    expect(released).toHaveLength(1);
  });
});

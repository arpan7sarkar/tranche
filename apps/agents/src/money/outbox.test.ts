import { type Db, schema } from "@tranche/db";
import { createTestDb, truncateAll } from "@tranche/db/testing";
import { PayPalError } from "@tranche/paypal";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { must } from "./errors";
import { executeOutbox } from "./outbox-executor";
import { fakePayPal, makeHold, makeMilestone, NOW, testDeps } from "./test-helpers";

let db: Db;

async function releaseReady(attempts = 0) {
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
    attempts,
  });
  return { milestoneId, hold };
}
const releaseRow = async () =>
  must((await db.select().from(schema.outbox).where(eq(schema.outbox.kind, "release")))[0]);
const milestoneOf = async (id: string) =>
  must((await db.select().from(schema.milestone).where(eq(schema.milestone.id, id)))[0]);
const alertKinds = async () =>
  (await db.select().from(schema.event).where(eq(schema.event.type, "alert.raised"))).map(
    (e) => e.payload.kind,
  );

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
    const { milestoneId, hold } = await releaseReady();
    const releaseHold = vi
      .fn()
      .mockRejectedValueOnce(new Error("socket hang up"))
      .mockResolvedValueOnce({ releaseRef: "CAPTURE-REL-1" });
    const paypal = fakePayPal({ releaseHold });

    await executeOutbox(testDeps(db, paypal));
    const failed = await releaseRow();
    expect(failed).toMatchObject({ status: "pending", attempts: 1, lastError: "socket hang up" });
    expect(failed.nextAttemptAt.toISOString()).toBe("2026-10-10T10:01:00.000Z");

    await executeOutbox(testDeps(db, paypal, () => new Date("2026-10-10T10:02:00Z")));
    expect(releaseHold.mock.calls.map((c) => c[0].requestId)).toEqual([
      `release:${hold.id}`,
      `release:${hold.id}`,
    ]);
    expect(await milestoneOf(milestoneId)).toMatchObject({
      state: "paid_out",
      releasedMinor: 100000,
    });
    const released = await db
      .select()
      .from(schema.event)
      .where(eq(schema.event.type, "milestone.released"));
    expect(released).toHaveLength(1);
  });

  it("does not settle a row whose lease was taken over during the call", async () => {
    const { milestoneId } = await releaseReady();
    // While PayPal is slow, the lease expires and another worker re-claims the row.
    const releaseHold = vi.fn(async () => {
      await db.update(schema.outbox).set({ attempts: sql`${schema.outbox.attempts} + 1` });
      return { releaseRef: "CAPTURE-REL-1" };
    });

    await executeOutbox(testDeps(db, fakePayPal({ releaseHold })));
    expect(await releaseRow()).toMatchObject({ status: "sent", attempts: 2, response: null });
    expect(await milestoneOf(milestoneId)).toMatchObject({ state: "release_pending" });
  });

  it("keeps replaying an unknown outcome and only compensates a definite refusal", async () => {
    const { milestoneId } = await releaseReady(7);
    const timeout = new PayPalError({
      status: 0,
      name: "NETWORK_ERROR",
      message: "timeout",
      issue: null,
      debugId: null,
      retryable: true,
    });
    await executeOutbox(
      testDeps(db, fakePayPal({ releaseHold: vi.fn().mockRejectedValue(timeout) })),
    );
    expect(await releaseRow()).toMatchObject({ status: "pending", attempts: 8 });
    expect(await milestoneOf(milestoneId)).toMatchObject({ state: "release_pending" });
    expect((await milestoneOf(milestoneId)).releaseAuthorizedAt).not.toBeNull();
    expect(await alertKinds()).toEqual(["outbox_stuck"]);

    const voided = new PayPalError({
      status: 422,
      name: "UNPROCESSABLE_ENTITY",
      message: "Authorization has been voided",
      issue: "AUTHORIZATION_VOIDED",
      debugId: null,
      retryable: false,
    });
    const later = () => new Date("2026-10-10T12:00:00Z");
    await executeOutbox(
      testDeps(db, fakePayPal({ releaseHold: vi.fn().mockRejectedValue(voided) }), later),
    );
    expect(await releaseRow()).toMatchObject({ status: "failed" });
    expect((await milestoneOf(milestoneId)).releaseAuthorizedAt).toBeNull();
    expect(await alertKinds()).toEqual(["outbox_stuck", "release_failed", "outbox_failed"]);
  });
});

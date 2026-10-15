import { type Db, schema } from "@tranche/db";
import { createTestDb, truncateAll } from "@tranche/db/testing";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PermanentError } from "./errors";
import { activateHold } from "./holds";
import { renewHandler } from "./holds-renew";
import { handlePayPalEvent } from "./paypal-events";
import {
  fakePayPal,
  makeHold,
  makeMilestone,
  NOW,
  runOutboxHandler,
  testDeps,
} from "./test-helpers";

const DAY = 86_400_000;
const daysAfter = (n: number) => () => new Date(NOW.getTime() + n * DAY);

let db: Db;

const renew = (paypal: ReturnType<typeof fakePayPal>, milestoneId: string, day: number, n = 1) =>
  runOutboxHandler(renewHandler, testDeps(db, paypal, daysAfter(day)), {
    kind: "renew_hold",
    request: { milestoneId },
    requestId: `renew:${milestoneId}:${n}`,
  });

const pendingRenewals = (milestoneId: string) =>
  db
    .select()
    .from(schema.scheduledAction)
    .where(
      and(
        eq(schema.scheduledAction.milestoneId, milestoneId),
        eq(schema.scheduledAction.kind, "renew_hold"),
        eq(schema.scheduledAction.status, "pending"),
      ),
    );

describe.runIf(Boolean(process.env.DATABASE_URL))("hold renewal", () => {
  beforeAll(async () => {
    db = await createTestDb("agents");
  });
  beforeEach(async () => {
    await truncateAll(db);
  });
  afterAll(async () => {
    await db.$client.end();
  });

  it("plans the renewal 27 days after the authorization", async () => {
    const { milestoneId } = await makeMilestone(db, { state: "funding" });
    const hold = await makeHold(db, milestoneId);
    await db.transaction((tx) =>
      activateHold(
        tx,
        hold,
        {
          authorizationId: "AUTH-1",
          anchorAt: NOW,
          expiresAt: new Date(NOW.getTime() + 29 * DAY),
          amountMinor: 100000,
        },
        NOW,
      ),
    );
    const [t] = await pendingRenewals(milestoneId);
    expect(t?.dueAt.toISOString()).toBe("2026-11-06T10:00:00.000Z");
  });

  it("replaces the authorization from the vault at day 27 without a false void alert", async () => {
    const { milestoneId, dealId } = await makeMilestone(db, {
      state: "in_progress",
      heldMinor: 100000,
    });
    const old = await makeHold(db, milestoneId, {
      status: "active",
      authorizationId: "AUTH-1",
      anchorAt: NOW,
    });
    const paypal = fakePayPal();
    await renew(paypal, milestoneId, 27);
    expect(paypal.createFundingOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: `renew:${milestoneId}:1:order`,
        vaultId: "VAULT-1",
        mechanism: "authorization",
      }),
    );
    expect(paypal.placeHold).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: `renew:${milestoneId}:1:hold`, orderId: "ORDER-2" }),
    );
    expect(await db.select().from(schema.hold)).toHaveLength(2);
    const [voidRow] = await db
      .select()
      .from(schema.outbox)
      .where(eq(schema.outbox.kind, "void_hold"));
    expect(voidRow?.requestId).toBe(`void:${old.id}`);
    const [t] = await pendingRenewals(milestoneId);
    expect(t?.dueAt.toISOString()).toBe(new Date(NOW.getTime() + 54 * DAY).toISOString());
    const [held] = await db
      .select()
      .from(schema.event)
      .where(eq(schema.event.type, "milestone.held"));
    expect(held).toMatchObject({ dealId, milestoneId });
    expect(held?.payload).toMatchObject({ renewed: true, title: "Build" });

    await db.transaction((tx) =>
      handlePayPalEvent(tx, testDeps(db), "PAYMENT.AUTHORIZATION.VOIDED", { id: "AUTH-1" }),
    );
    expect(
      await db.select().from(schema.event).where(eq(schema.event.type, "alert.raised")),
    ).toHaveLength(0);
  });

  it("reauthorizes once, then waits for the day-27 replacement", async () => {
    const { milestoneId } = await makeMilestone(db, { state: "in_progress", heldMinor: 100000 });
    const hold = await makeHold(db, milestoneId, {
      status: "active",
      authorizationId: "AUTH-1",
      anchorAt: NOW,
    });
    const paypal = fakePayPal();
    await renew(paypal, milestoneId, 10);
    expect(paypal.renewHold).toHaveBeenCalledWith({
      requestId: `renew:${milestoneId}:1`,
      authorizationId: "AUTH-1",
      amount: { currency: "USD", minor: 100000 },
    });
    const [h] = await db.select().from(schema.hold).where(eq(schema.hold.id, hold.id));
    expect(h?.paypalAuthorizationId).toBe("AUTH-2");
    expect(h?.lastReauthorizedAt?.toISOString()).toBe(daysAfter(10)().toISOString());

    await renew(paypal, milestoneId, 12, 2);
    expect(paypal.renewHold).toHaveBeenCalledTimes(1);
    expect(paypal.createFundingOrder).not.toHaveBeenCalled();
  });

  it("alerts before a delayed hold auto-disburses", async () => {
    const { milestoneId } = await makeMilestone(db, { state: "in_progress", heldMinor: 100000 });
    await makeHold(db, milestoneId, {
      status: "active",
      mechanism: "delayed_disbursement",
      captureId: "CAP-1",
      anchorAt: NOW,
    });
    const paypal = fakePayPal();
    await renew(paypal, milestoneId, 25);
    const events = await db.select().from(schema.event);
    expect(events.map((e) => e.type).sort()).toEqual(["alert.raised", "milestone.hold_expiring"]);
    expect(paypal.createFundingOrder).not.toHaveBeenCalled();
  });

  it("skips renewal when the hold is no longer active", async () => {
    const { milestoneId } = await makeMilestone(db, {
      state: "released",
      heldMinor: 100000,
      releasedMinor: 100000,
    });
    await makeHold(db, milestoneId, {
      status: "released",
      authorizationId: "AUTH-1",
      anchorAt: NOW,
    });
    const paypal = fakePayPal();
    await renew(paypal, milestoneId, 27);
    expect(paypal.createFundingOrder).not.toHaveBeenCalled();
    expect(paypal.renewHold).not.toHaveBeenCalled();
  });

  it("fails permanently without a vaulted payment method", async () => {
    const { milestoneId } = await makeMilestone(db, {
      state: "in_progress",
      heldMinor: 100000,
      vaultId: null,
    });
    await makeHold(db, milestoneId, { status: "active", authorizationId: "AUTH-1", anchorAt: NOW });
    const paypal = fakePayPal();
    const run = renew(paypal, milestoneId, 27);
    await expect(run).rejects.toBeInstanceOf(PermanentError);
    await expect(run).rejects.toThrow("no vaulted payment method to renew the hold");
    expect(paypal.createFundingOrder).not.toHaveBeenCalled();
  });

  describe("never renews against the milestone's state", () => {
    const gateWith = async (state: "cancelled" | "released", extra?: () => Promise<void>) => {
      const { milestoneId } = await makeMilestone(db, { state, heldMinor: 100000 });
      const old = await makeHold(db, milestoneId, {
        status: "active",
        authorizationId: "AUTH-1",
        anchorAt: NOW,
      });
      await extra?.();
      return { milestoneId, old };
    };
    const voidRows = () =>
      db.select().from(schema.outbox).where(eq(schema.outbox.kind, "void_hold"));

    it("voids the hold of a cancelled milestone instead of renewing it", async () => {
      const { milestoneId, old } = await gateWith("cancelled");
      const paypal = fakePayPal();
      await renew(paypal, milestoneId, 27);
      expect(paypal.createFundingOrder).not.toHaveBeenCalled();
      expect((await voidRows()).map((r) => r.requestId)).toEqual([`void:${old.id}`]);
      expect(await pendingRenewals(milestoneId)).toHaveLength(0);
    });

    it("does not renew while a release of the hold is in flight", async () => {
      const { milestoneId, old } = await makeMilestone(db, {
        state: "release_pending",
        heldMinor: 100000,
      }).then(async (m) => ({
        ...m,
        old: await makeHold(db, m.milestoneId, {
          status: "active",
          authorizationId: "AUTH-1",
          anchorAt: NOW,
        }),
      }));
      await db.insert(schema.outbox).values({
        kind: "release",
        request: { holdId: old.id, amountMinor: 100000 },
        requestId: `release:${old.id}`,
        nextAttemptAt: NOW,
      });
      const paypal = fakePayPal();
      await renew(paypal, milestoneId, 27);
      expect(paypal.createFundingOrder).not.toHaveBeenCalled();
      expect(await db.select().from(schema.hold)).toHaveLength(1);
    });

    it("voids a fresh authorization when the milestone was cancelled during the renewal", async () => {
      const { milestoneId } = await makeMilestone(db, { state: "in_progress", heldMinor: 100000 });
      const old = await makeHold(db, milestoneId, {
        status: "active",
        authorizationId: "AUTH-1",
        anchorAt: NOW,
      });
      const deps = testDeps(db, fakePayPal(), daysAfter(27));
      const [row] = await db
        .insert(schema.outbox)
        .values({
          kind: "renew_hold",
          request: { milestoneId },
          requestId: `renew:${milestoneId}:1`,
          nextAttemptAt: NOW,
        })
        .returning();
      const response = await renewHandler.call(deps, row as never);
      await db
        .update(schema.milestone)
        .set({ state: "cancelled" })
        .where(eq(schema.milestone.id, milestoneId));
      await db.transaction((tx) => renewHandler.settle(tx, deps, row as never, response));
      const fresh = (await db.select().from(schema.hold)).find((h) => h.id !== old.id);
      expect((await voidRows()).map((r) => r.requestId).sort()).toEqual(
        [`void:${old.id}`, `void:${fresh?.id}`].sort(),
      );
      expect(await pendingRenewals(milestoneId)).toHaveLength(0);
    });

    it("plans no renewal for a hold confirmed after the milestone was cancelled", async () => {
      const { milestoneId } = await gateWith("cancelled");
      const orphan = await makeHold(db, milestoneId);
      await db.transaction((tx) =>
        activateHold(
          tx,
          orphan,
          {
            authorizationId: "AUTH-9",
            anchorAt: NOW,
            expiresAt: new Date(NOW.getTime() + 29 * DAY),
            amountMinor: 100000,
          },
          NOW,
        ),
      );
      expect(await pendingRenewals(milestoneId)).toHaveLength(0);
      expect((await voidRows()).map((r) => r.requestId)).toContain(`void:${orphan.id}`);
    });
  });
});

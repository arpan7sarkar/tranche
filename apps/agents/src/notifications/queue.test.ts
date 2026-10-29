import { type Db, schema } from "@tranche/db";
import { createTestDb, openSandboxTestDb, truncateAll } from "@tranche/db/testing";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { makeMilestone } from "../money/test-helpers";
import { deliverNotifications, enqueueNotification, queueNotifications } from "./queue";

describe.runIf(Boolean(process.env.TEST_DATABASE_URL))("durable notifications", () => {
  let db: Db;
  beforeAll(async () => {
    const fixture = await openSandboxTestDb(process.env.TEST_DATABASE_URL);
    await fixture.$client.end();
    db = await createTestDb("notifications", process.env.TEST_DATABASE_URL);
  });
  beforeEach(async () => {
    await truncateAll(db);
  });
  afterAll(async () => {
    await db?.$client.end();
  });
  async function queue() {
    const { dealId } = await makeMilestone(db);
    const input = {
      key: "test:one",
      dealId,
      side: "client" as const,
      subject: "Review",
      body: "Please review",
    };
    await Promise.all([enqueueNotification(db, input), enqueueNotification(db, input)]);
    return dealId;
  }
  it("deduplicates enqueue and concurrent delivery while keeping portal tokens out of events", async () => {
    await queue();
    const send = vi.fn(async () => "provider-one");
    await Promise.all([deliverNotifications(db, send), deliverNotifications(db, send)]);
    expect(send).toHaveBeenCalledTimes(1);
    const rows = await db.select().from(schema.notificationJob);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("sent");
    expect(rows[0]?.body).toContain("/portal/");
    expect(await db.select().from(schema.magicLink)).toHaveLength(1);
    expect(await db.select().from(schema.event)).toHaveLength(0);
  });
  it("retries an ambiguous provider result with exactly the same key and payload", async () => {
    await queue();
    const send = vi
      .fn()
      .mockRejectedValueOnce(new Error("timeout after acceptance"))
      .mockResolvedValue("provider-one");
    expect(await deliverNotifications(db, send)).toBe(0);
    await db.update(schema.notificationJob).set({ nextAttemptAt: sql`now()` });
    expect(await deliverNotifications(db, send)).toBe(1);
    expect(send.mock.calls[0]).toEqual(send.mock.calls[1]);
  });
  it("stops uncertain sends before the provider idempotency window expires", async () => {
    await queue();
    await db
      .update(schema.notificationJob)
      .set({ dispatchedAt: sql`now() - interval '24 hours'`, status: "sending" });
    const send = vi.fn(async () => "unexpected");
    await deliverNotifications(db, send);
    expect(send).not.toHaveBeenCalled();
    expect((await db.select().from(schema.notificationJob))[0]?.status).toBe("review");
  });
  it("recovers a failed database confirmation after provider acceptance without duplicating email", async () => {
    await queue();
    const accepted = new Map<string, string>();
    const send = vi.fn(async (email: { key: string }) => {
      if (!accepted.has(email.key)) accepted.set(email.key, "provider-one");
      return accepted.get(email.key) as string;
    });
    await db.execute(sql`create function fail_notification_confirmation() returns trigger language plpgsql as $$
      begin
        if new.status = 'sent' then raise exception 'injected confirmation failure'; end if;
        return new;
      end;
    $$`);
    try {
      await db.execute(sql`create trigger fail_notification_confirmation before update on notification_job
        for each row execute function fail_notification_confirmation()`);
      expect(await deliverNotifications(db, send)).toBe(0);
      expect(accepted.size).toBe(1);
      expect((await db.select().from(schema.notificationJob))[0]?.status).toBe("sending");
    } finally {
      await db.execute(
        sql`drop trigger if exists fail_notification_confirmation on notification_job`,
      );
      await db.execute(sql`drop function fail_notification_confirmation()`);
    }
    await db.update(schema.notificationJob).set({ nextAttemptAt: sql`now()` });
    expect(await deliverNotifications(db, send)).toBe(1);
    expect(send.mock.calls[0]).toEqual(send.mock.calls[1]);
    expect(accepted.size).toBe(1);
    expect((await db.select().from(schema.notificationJob))[0]?.status).toBe("sent");
  });
  it("does not send expired links or to changed recipients", async () => {
    await queue();
    await db.update(schema.client).set({ email: "changed@example.com" });
    const send = vi.fn(async () => "unexpected");
    await deliverNotifications(db, send);
    expect(send).not.toHaveBeenCalled();
    expect((await db.select().from(schema.notificationJob))[0]?.status).toBe("cancelled");
    await truncateAll(db);
    await queue();
    await db
      .update(schema.notificationJob)
      .set({ linkExpiresAt: sql`now() - interval '1 second'` });
    await deliverNotifications(db, send);
    expect(send).not.toHaveBeenCalled();
  });
  it("only executes an approved reminder after the provider confirms acceptance", async () => {
    const { dealId } = await makeMilestone(db);
    const [action] = await db
      .insert(schema.proposedAction)
      .values({
        dealId,
        agent: "monitor",
        side: "agency",
        type: "send_reminder",
        status: "pending",
        reasoning: "Waiting",
        idempotencyKey: "notification-action",
        payload: {
          type: "send_reminder",
          to: "client",
          milestoneId: null,
          subject: "Review",
          body: "Review please",
        },
      })
      .returning();
    if (!action) throw new Error("fixture");
    await queueNotifications(db);
    expect(await db.select().from(schema.notificationJob)).toHaveLength(0);
    await db
      .update(schema.proposedAction)
      .set({ status: "approved" })
      .where(eq(schema.proposedAction.id, action.id));
    await queueNotifications(db);
    await deliverNotifications(db, async () => {
      throw new Error("timeout");
    });
    expect((await db.select().from(schema.proposedAction))[0]?.status).toBe("approved");
    await db.update(schema.notificationJob).set({ nextAttemptAt: sql`now()` });
    await deliverNotifications(db, async () => "provider-one");
    await deliverNotifications(db, async () => "provider-one");
    expect((await db.select().from(schema.proposedAction))[0]?.status).toBe("executed");
    expect(
      await db.select().from(schema.event).where(eq(schema.event.type, "action.executed")),
    ).toHaveLength(1);
  });
  it("queues plan, funding and approval events once with private fresh links", async () => {
    const { dealId } = await makeMilestone(db);
    const [action] = await db
      .insert(schema.proposedAction)
      .values({
        dealId,
        agent: "monitor",
        side: "agency",
        type: "flag_risk",
        status: "needs_approval",
        reasoning: "Review",
        idempotencyKey: "approval-email",
        payload: { type: "flag_risk", milestoneId: null, severity: "low", message: "Review" },
      })
      .returning();
    if (!action) throw new Error("fixture");
    const [approval] = await db
      .insert(schema.approval)
      .values({ proposedActionId: action.id, side: "client" })
      .returning();
    if (!approval) throw new Error("fixture");
    await db.insert(schema.event).values([
      { type: "deal.plan_sent", dealId, payload: {} },
      {
        type: "milestone.funding_requested",
        dealId,
        payload: {
          orderId: "fake-order",
          approveUrl: "https://www.sandbox.paypal.com/checkoutnow",
        },
      },
      {
        type: "approval.requested",
        dealId,
        payload: { approvalId: approval.id, proposedActionId: action.id, side: "client" },
      },
    ]);
    await queueNotifications(db);
    await queueNotifications(db);
    const jobs = await db.select().from(schema.notificationJob);
    expect(jobs).toHaveLength(3);
    expect(new Set(jobs.map((job) => job.body.match(/\/portal\/([^\s]+)/)?.[1])).size).toBe(3);
    expect(JSON.stringify(await db.select().from(schema.event))).not.toContain("/portal/");
    expect(jobs.every((job) => job.to === "buyer@acme.test")).toBe(true);
  });
  it("requires both escalation audiences before executing the action", async () => {
    const { dealId, workspaceId } = await makeMilestone(db);
    const [action] = await db
      .insert(schema.proposedAction)
      .values({
        dealId,
        agent: "negotiator",
        side: "agency",
        type: "escalate",
        status: "approved",
        reasoning: "Review",
        idempotencyKey: "escalation-email",
        payload: { type: "escalate", negotiationId: null, reason: "Human review required" },
      })
      .returning();
    if (!action) throw new Error("fixture");
    await expect(queueNotifications(db)).rejects.toThrow("notification_recipient_unavailable");
    await db
      .insert(schema.user)
      .values({ id: "owner", name: "Owner", email: "owner@example.test" });
    await db.insert(schema.workspaceMember).values({ workspaceId, userId: "owner", role: "owner" });
    await queueNotifications(db);
    const send = vi.fn(async () => "fake-accepted");
    await deliverNotifications(db, send);
    expect(send).toHaveBeenCalledTimes(2);
    expect(
      (
        await db.select().from(schema.proposedAction).where(eq(schema.proposedAction.id, action.id))
      )[0]?.status,
    ).toBe("executed");
  });
});

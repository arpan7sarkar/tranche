import { createDb, type Db, migrateDb, schema } from "@tranche/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { confirmApproval, startFunding } from "./funding";
import { createDeal, one } from "./test-fixtures";

const url = process.env.DATABASE_URL;

describe.runIf(Boolean(url))("funding", { timeout: 20_000 }, () => {
  let db: Db;
  beforeAll(async () => {
    db = createDb(url);
    await migrateDb(db);
  });
  afterAll(async () => {
    await db.$client.end();
  });

  async function fundable() {
    const f = await createDeal(db, { milestones: 1 });
    await db
      .update(schema.workspace)
      .set({ paypalMerchantId: "SELLER1", paypalOnboarding: "active" })
      .where(eq(schema.workspace.id, f.workspaceId));
    const milestone = one(f.milestones);
    await db
      .update(schema.milestone)
      .set({ state: "funding" })
      .where(eq(schema.milestone.id, milestone.id));
    return { dealId: f.deal.id, milestoneId: milestone.id };
  }

  let seq = 0;
  const newOrderId = () => `ORDER${Date.now()}${seq++}`;
  const fakePayPal = (status = "APPROVED") => {
    const orderIds: string[] = [];
    return {
      orderIds,
      createFundingOrder: vi.fn(async () => {
        const orderId = newOrderId();
        orderIds.push(orderId);
        return { orderId, approveUrl: `https://paypal.test/${orderId}`, status: "CREATED" };
      }),
      getOrder: vi.fn(async (id: string) => ({ id, status })),
    };
  };
  const base = {
    mechanism: "authorization" as const,
    appUrl: "https://app.test",
    portalToken: "t",
  };
  const holdsOf = (milestoneId: string) =>
    db.select().from(schema.hold).where(eq(schema.hold.milestoneId, milestoneId));
  const placeHoldRows = (holdId: string) =>
    db
      .select()
      .from(schema.outbox)
      .where(eq(schema.outbox.requestId, `place:${holdId}`));

  it("refuses a milestone from another deal", async () => {
    const a = await fundable();
    const b = await fundable();
    const paypal = fakePayPal();
    await expect(
      startFunding(db, paypal, { ...base, dealId: a.dealId, milestoneId: b.milestoneId }),
    ).rejects.toMatchObject({ status: 404 });
    expect(paypal.createFundingOrder).not.toHaveBeenCalled();
  });

  it("refuses an order from another deal", async () => {
    const a = await fundable();
    const b = await fundable();
    const paypal = fakePayPal();
    await startFunding(db, paypal, { ...base, ...a });
    const orderId = paypal.orderIds[0] ?? "";
    await expect(confirmApproval(db, paypal, { dealId: b.dealId, orderId })).rejects.toMatchObject({
      status: 404,
    });
    const hold = one(await holdsOf(a.milestoneId));
    expect(await placeHoldRows(hold.id)).toHaveLength(0);
  });

  it("enqueues place_hold once even when confirmed twice", async () => {
    const f = await fundable();
    const paypal = fakePayPal();
    await startFunding(db, paypal, { ...base, ...f });
    const orderId = paypal.orderIds[0] ?? "";
    const first = await confirmApproval(db, paypal, { dealId: f.dealId, orderId });
    const second = await confirmApproval(db, paypal, { dealId: f.dealId, orderId });
    expect(second.holdId).toBe(first.holdId);
    const rows = await placeHoldRows(first.holdId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "place_hold", request: { holdId: first.holdId } });
  });

  it("enqueues nothing when the order is not approved yet", async () => {
    const f = await fundable();
    const paypal = fakePayPal("PAYER_ACTION_REQUIRED");
    await startFunding(db, paypal, { ...base, ...f });
    const orderId = paypal.orderIds[0] ?? "";
    await expect(confirmApproval(db, paypal, { dealId: f.dealId, orderId })).rejects.toMatchObject({
      status: 409,
    });
    expect(await placeHoldRows(one(await holdsOf(f.milestoneId)).id)).toHaveLength(0);
  });

  it("confirms a completed order instead of creating a second one", async () => {
    const f = await fundable();
    const paypal = fakePayPal("COMPLETED");
    await startFunding(db, paypal, { ...base, ...f });
    await db
      .update(schema.hold)
      .set({ expiresAt: new Date(0) })
      .where(eq(schema.hold.milestoneId, f.milestoneId));
    await expect(startFunding(db, paypal, { ...base, ...f })).rejects.toMatchObject({
      status: 409,
    });
    expect(paypal.createFundingOrder).toHaveBeenCalledOnce();
    const hold = one(await holdsOf(f.milestoneId));
    expect(hold.status).toBe("pending");
    expect(await placeHoldRows(hold.id)).toHaveLength(1);
  });

  it("replaces an expired order that was never paid", async () => {
    const f = await fundable();
    const paypal = fakePayPal("PAYER_ACTION_REQUIRED");
    await startFunding(db, paypal, { ...base, ...f });
    await db
      .update(schema.hold)
      .set({ expiresAt: new Date(0) })
      .where(eq(schema.hold.milestoneId, f.milestoneId));
    const res = await startFunding(db, paypal, { ...base, ...f });
    expect(res.orderId).toBe(paypal.orderIds[1]);
    const statuses = (await holdsOf(f.milestoneId)).map((h) => h.status).sort();
    expect(statuses).toEqual(["failed", "pending"]);
  });
});

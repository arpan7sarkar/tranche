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

  const fakePayPal = (orderId: string) => ({
    createFundingOrder: vi.fn(async () => ({
      orderId,
      approveUrl: `https://paypal.test/${orderId}`,
      status: "PAYER_ACTION_REQUIRED",
    })),
    getOrder: vi.fn(),
  });
  const base = {
    mechanism: "authorization" as const,
    appUrl: "https://app.test",
    portalToken: "t",
  };
  const placeHoldRows = (holdId: string) =>
    db
      .select()
      .from(schema.outbox)
      .where(eq(schema.outbox.requestId, `place:${holdId}`));

  it("refuses a milestone from another deal", async () => {
    const a = await fundable();
    const b = await fundable();
    const paypal = fakePayPal("ORDERX1");
    await expect(
      startFunding(db, paypal, { ...base, dealId: a.dealId, milestoneId: b.milestoneId }),
    ).rejects.toMatchObject({ status: 404 });
    expect(paypal.createFundingOrder).not.toHaveBeenCalled();
  });

  it("refuses an order from another deal", async () => {
    const a = await fundable();
    const b = await fundable();
    const orderId = `ORDER${Date.now()}A`;
    await startFunding(db, fakePayPal(orderId), { ...base, ...a });
    await expect(confirmApproval(db, { dealId: b.dealId, orderId })).rejects.toMatchObject({
      status: 404,
    });
    const [hold] = await db
      .select()
      .from(schema.hold)
      .where(eq(schema.hold.paypalOrderId, orderId));
    expect(await placeHoldRows(hold?.id ?? "")).toHaveLength(0);
  });

  it("enqueues place_hold once even when confirmed twice", async () => {
    const f = await fundable();
    const orderId = `ORDER${Date.now()}B`;
    await startFunding(db, fakePayPal(orderId), { ...base, ...f });
    const first = await confirmApproval(db, { dealId: f.dealId, orderId });
    const second = await confirmApproval(db, { dealId: f.dealId, orderId });
    expect(second.holdId).toBe(first.holdId);
    const rows = await placeHoldRows(first.holdId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "place_hold", request: { holdId: first.holdId } });
  });
});

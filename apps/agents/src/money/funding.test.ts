import { type Db, schema } from "@tranche/db";
import { createTestDb, truncateAll } from "@tranche/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fakePayPal, makeHold, makeMilestone, runOutboxHandler, testDeps } from "./test-helpers";
import { fundHandler } from "./timers-fund";

let db: Db;

describe.runIf(Boolean(process.env.DATABASE_URL))("fund handler", () => {
  beforeAll(async () => {
    db = await createTestDb("agents");
  });
  beforeEach(async () => {
    await truncateAll(db);
    vi.stubEnv("APP_URL", "https://tranche.test");
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    await db.$client.end();
  });

  const fund = (paypal: ReturnType<typeof fakePayPal>, milestoneId: string) =>
    runOutboxHandler(fundHandler, testDeps(db, paypal), {
      kind: "fund",
      request: { milestoneId },
      requestId: `fund:${milestoneId}`,
    });

  it("funds from the vault, places the hold and returns to the token-less page", async () => {
    const { milestoneId } = await makeMilestone(db, { state: "agreed" });
    const paypal = fakePayPal();
    await fund(paypal, milestoneId);
    expect(paypal.createFundingOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: `fund:${milestoneId}:0`,
        mechanism: "authorization",
        amount: { currency: "USD", minor: 100000 },
        platformFee: { currency: "USD", minor: 2000 },
        payeeMerchantId: "MERCHANT-AGENCY",
        vaultId: "VAULT-1",
        returnUrl: `https://tranche.test/portal/return?milestoneId=${milestoneId}`,
      }),
    );
    const [m] = await db.select().from(schema.milestone);
    expect(m?.state).toBe("funding");
    const [h] = await db.select().from(schema.hold);
    expect(h).toMatchObject({ status: "pending", paypalOrderId: "ORDER-2", amountMinor: 100000 });
    const queued = await db
      .select()
      .from(schema.outbox)
      .where(eq(schema.outbox.kind, "place_hold"));
    expect(queued.map((r) => r.requestId)).toEqual([`place:${h?.id}`]);
  });

  it("asks the client to approve when there is no vaulted method", async () => {
    const { milestoneId } = await makeMilestone(db, { state: "agreed", vaultId: null });
    const paypal = fakePayPal({
      createFundingOrder: vi.fn(async () => ({
        orderId: "ORDER-3",
        approveUrl: "https://sandbox.paypal.test/approve",
        status: "CREATED",
      })),
    });
    await fund(paypal, milestoneId);
    const [e] = await db
      .select()
      .from(schema.event)
      .where(eq(schema.event.type, "milestone.funding_requested"));
    expect(e?.payload).toMatchObject({
      orderId: "ORDER-3",
      approveUrl: "https://sandbox.paypal.test/approve",
    });
    expect(
      await db.select().from(schema.outbox).where(eq(schema.outbox.kind, "place_hold")),
    ).toHaveLength(0);
  });

  it("skips a milestone that already has a hold", async () => {
    const { milestoneId } = await makeMilestone(db, { state: "funding" });
    await makeHold(db, milestoneId, { status: "pending" });
    const paypal = fakePayPal();
    await fund(paypal, milestoneId);
    expect(paypal.createFundingOrder).not.toHaveBeenCalled();
  });
});

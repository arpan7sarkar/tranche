import { type Db, schema } from "@tranche/db";
import { createTestDb, truncateAll } from "@tranche/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { recoverCreation, registerPayPalWebhook, startSellerOnboarding } from "./creation";
import { startFunding } from "./funding";
import { executeOutbox } from "./outbox-executor";
import { handlePayPalEvent } from "./paypal-events";
import { fakePayPal, makeMilestone, NOW, testDeps } from "./test-helpers";

let db: Db;
describe.runIf(Boolean(process.env.DATABASE_URL))("BASE-01 durable creation", () => {
  beforeAll(async () => {
    db = await createTestDb("agents");
  });
  beforeEach(async () => {
    await truncateAll(db);
  });
  afterAll(async () => {
    await db.$client.end();
  });
  const due = async () => db.update(schema.outbox).set({ nextAttemptAt: NOW });
  const fund = (paypal: ReturnType<typeof fakePayPal>, milestoneId: string) =>
    startFunding(db, paypal, {
      milestoneId,
      states: ["agreed", "funding"],
      mechanism: "authorization",
      requestId: "parent",
      returnUrl: "https://tranche.test/portal/return",
      cancelUrl: "https://tranche.test",
      now: NOW,
    });

  it("keeps unknown order creation pending and adopts only the exact frozen request", async () => {
    const { milestoneId } = await makeMilestone(db, { state: "funding" });
    const paypal = fakePayPal({
      createFundingOrder: vi.fn(async (input: { beforeDispatch?: () => Promise<void> }) => {
        await input.beforeDispatch?.();
        throw new Error("lost response");
      }),
    });
    await expect(fund(paypal, milestoneId)).rejects.toThrow("pending_recovery");
    const [intent] = await db.select().from(schema.outbox);
    if (!intent) throw new Error("missing_intent");
    expect(intent.request).toMatchObject({ milestoneId, amount: { minor: 100000 } });
    await due();
    await expect(fund(paypal, milestoneId)).rejects.toThrow("pending_recovery");
    expect(paypal.createFundingOrder).toHaveBeenCalledOnce();
    const order = {
      id: "RECOVERED",
      intent: "AUTHORIZE",
      status: "APPROVED",
      purchase_units: [
        {
          reference_id: milestoneId,
          custom_id: intent.requestId,
          amount: { currency_code: "USD", value: "1000.00" },
          payee: { merchant_id: "MERCHANT-AGENCY" },
        },
      ],
    };
    paypal.getOrder = vi.fn(async () => order);
    await due();
    const unit = order.purchase_units[0];
    if (!unit) throw new Error("missing_unit");
    unit.amount.value = "1.00";
    await expect(recoverCreation(testDeps(db, paypal), intent.id, "RECOVERED")).rejects.toThrow(
      "funding_order_identity_mismatch",
    );
    expect(await db.select().from(schema.hold)).toHaveLength(0);
    unit.amount.value = "1000.00";
    await recoverCreation(testDeps(db, paypal), intent.id, "RECOVERED");
    const [hold] = await db.select().from(schema.hold);
    expect(hold).toMatchObject({
      paypalOrderId: "RECOVERED",
      status: "pending",
      amountMinor: 100000,
    });
    expect(paypal.createFundingOrder).toHaveBeenCalledOnce();
    expect(
      await db.select().from(schema.outbox).where(eq(schema.outbox.kind, "place_hold")),
    ).toHaveLength(1);
  });

  it("retries a proven pre-dispatch failure using the same frozen intent", async () => {
    const { milestoneId } = await makeMilestone(db, { state: "funding" });
    const createFundingOrder = vi
      .fn()
      .mockRejectedValueOnce(new Error("oauth unavailable"))
      .mockImplementation(async (input: { beforeDispatch?: () => Promise<void> }) => {
        await input.beforeDispatch?.();
        return { orderId: "RETRIED", approveUrl: null, status: "APPROVED" };
      });
    const paypal = fakePayPal({ createFundingOrder });
    await expect(fund(paypal, milestoneId)).rejects.toThrow("pending_recovery");
    await due();
    await fund(paypal, milestoneId);
    expect(createFundingOrder.mock.calls[0]?.[0].requestId).toBe(
      createFundingOrder.mock.calls[1]?.[0].requestId,
    );
    const [intent] = await db
      .select()
      .from(schema.outbox)
      .where(eq(schema.outbox.kind, "create_funding_order"));
    expect(intent?.status).toBe("succeeded");
    expect(intent?.request._dispatched).toBe(true);
  });

  it("refuses a queued creation after cancellation", async () => {
    const { milestoneId } = await makeMilestone(db, { state: "funding" });
    const paypal = fakePayPal({
      createFundingOrder: vi.fn(async () => {
        throw new Error("oauth unavailable");
      }),
    });
    await expect(fund(paypal, milestoneId)).rejects.toThrow();
    await db
      .update(schema.milestone)
      .set({ state: "cancelled" })
      .where(eq(schema.milestone.id, milestoneId));
    await due();
    await executeOutbox(testDeps(db, paypal));
    expect(paypal.createFundingOrder).toHaveBeenCalledOnce();
    const [intent] = await db
      .select()
      .from(schema.outbox)
      .where(eq(schema.outbox.kind, "create_funding_order"));
    expect(intent).toMatchObject({ status: "failed", lastError: "funding_terms_changed" });
  });

  it("voids a late authorization after cancellation during order creation", async () => {
    const { milestoneId } = await makeMilestone(db, { state: "funding" });
    const paypal = fakePayPal({
      createFundingOrder: vi.fn(async (input: { beforeDispatch?: () => Promise<void> }) => {
        await input.beforeDispatch?.();
        await db
          .update(schema.milestone)
          .set({ state: "cancelled" })
          .where(eq(schema.milestone.id, milestoneId));
        return { orderId: "LATEORDER", approveUrl: null, status: "APPROVED" };
      }),
    });
    const deps = testDeps(db, paypal);
    await fund(paypal, milestoneId);
    await executeOutbox(deps);
    await db.transaction((tx) =>
      handlePayPalEvent(tx, deps, "PAYMENT.AUTHORIZATION.CREATED", {
        id: "LATEAUTH",
        status: "CREATED",
        amount: { currency_code: "USD", value: "1000.00" },
        create_time: NOW.toISOString(),
        expiration_time: "2026-11-08T10:00:00Z",
        supplementary_data: { related_ids: { order_id: "LATEORDER" } },
      }),
    );
    await executeOutbox(deps);
    expect(paypal.placeHold).not.toHaveBeenCalled();
    expect(paypal.voidHold).toHaveBeenCalledOnce();
    expect((await db.select().from(schema.hold))[0]?.status).toBe("voided");
  });

  it("does not place a queued hold after cancellation", async () => {
    const { milestoneId } = await makeMilestone(db, { state: "funding" });
    const paypal = fakePayPal();
    await fund(paypal, milestoneId);
    await db
      .update(schema.milestone)
      .set({ state: "cancelled" })
      .where(eq(schema.milestone.id, milestoneId));
    await executeOutbox(testDeps(db, paypal));
    expect(paypal.placeHold).not.toHaveBeenCalled();
  });

  it("keeps scheduled funding and portal funding on the same unresolved creation", async () => {
    const { milestoneId } = await makeMilestone(db, { state: "funding" });
    const paypal = fakePayPal({
      createFundingOrder: vi.fn(async (input: { beforeDispatch?: () => Promise<void> }) => {
        await input.beforeDispatch?.();
        throw new Error("lost response");
      }),
    });
    await db.insert(schema.outbox).values({
      kind: "fund",
      request: { milestoneId },
      requestId: "timer-fund",
      nextAttemptAt: NOW,
    });
    await executeOutbox(testDeps(db, paypal), 1);
    await due();
    await expect(fund(paypal, milestoneId)).rejects.toThrow("pending_recovery");
    expect(paypal.createFundingOrder).toHaveBeenCalledOnce();
    expect(
      await db.select().from(schema.outbox).where(eq(schema.outbox.kind, "create_funding_order")),
    ).toHaveLength(1);
  });

  it("settles a kept response after restart without creating another order", async () => {
    const { milestoneId } = await makeMilestone(db, { state: "funding" });
    const paypal = fakePayPal();
    await fund(paypal, milestoneId);
    const [intent] = await db
      .select()
      .from(schema.outbox)
      .where(eq(schema.outbox.kind, "create_funding_order"));
    if (!intent) throw new Error("missing_intent");
    await db
      .update(schema.outbox)
      .set({ status: "called", nextAttemptAt: NOW })
      .where(eq(schema.outbox.id, intent.id));
    await executeOutbox(testDeps(db, paypal), 1, intent.id);
    expect(paypal.createFundingOrder).toHaveBeenCalledOnce();
    expect(await db.select().from(schema.hold)).toHaveLength(1);
  });

  it("concurrent funding callers share one committed creation", async () => {
    const { milestoneId } = await makeMilestone(db, { state: "funding" });
    const paypal = fakePayPal();
    await Promise.allSettled([fund(paypal, milestoneId), fund(paypal, milestoneId)]);
    expect(paypal.createFundingOrder).toHaveBeenCalledOnce();
    expect(
      await db.select().from(schema.outbox).where(eq(schema.outbox.kind, "create_funding_order")),
    ).toHaveLength(1);
    expect(await db.select().from(schema.hold)).toHaveLength(1);
  });

  it("journals seller referral before dispatch and preserves its response across retries", async () => {
    const { workspaceId } = await makeMilestone(db);
    const createSellerReferral = vi.fn(async () => {
      const rows = await db
        .select()
        .from(schema.outbox)
        .where(eq(schema.outbox.kind, "create_seller_referral"));
      expect(rows).toHaveLength(1);
      return { actionUrl: "https://www.sandbox.paypal.com/consent" };
    });
    const input = {
      workspaceId,
      appUrl: "https://tranche.test",
      mechanism: "authorization" as const,
    };
    expect(await startSellerOnboarding(db, { createSellerReferral }, input)).toEqual(
      await startSellerOnboarding(db, { createSellerReferral }, input),
    );
    expect(createSellerReferral).toHaveBeenCalledOnce();
    expect((await db.select().from(schema.workspace))[0]?.paypalOnboarding).toBe("active");
  });

  it("does not replay ambiguous referral POST and recovers a verified known referral", async () => {
    const { workspaceId } = await makeMilestone(db);
    const paypal = fakePayPal({
      createSellerReferral: vi.fn(async (input: { beforeDispatch?: () => Promise<void> }) => {
        await input.beforeDispatch?.();
        throw new Error("lost referral");
      }),
    });
    const input = {
      workspaceId,
      appUrl: "https://tranche.test",
      mechanism: "authorization" as const,
    };
    await expect(startSellerOnboarding(db, paypal, input)).rejects.toThrow("pending_recovery");
    await due();
    await expect(startSellerOnboarding(db, paypal, input)).rejects.toThrow("pending_recovery");
    expect(paypal.createSellerReferral).toHaveBeenCalledOnce();
    const [intent] = await db.select().from(schema.outbox);
    if (!intent) throw new Error("missing_intent");
    paypal.transport = {
      request: vi.fn(async () => ({
        tracking_id: workspaceId,
        partner_config_override: { return_url: `${input.appUrl}/api/paypal/onboarding/return` },
        operations: [
          {
            api_integration_preference: {
              rest_api_integration: {
                third_party_details: { features: ["PAYMENT", "REFUND", "PARTNER_FEE", "VAULT"] },
              },
            },
          },
        ],
        links: [{ rel: "action_url", href: "https://www.sandbox.paypal.com/consent" }],
      })),
    } as unknown as typeof paypal.transport;
    await due();
    expect(await recoverCreation(testDeps(db, paypal), intent.id, "REFERRAL1")).toEqual({
      actionUrl: "https://www.sandbox.paypal.com/consent",
    });
    expect(paypal.createSellerReferral).toHaveBeenCalledOnce();
  });

  it("recovers a lost webhook registration by exact URL without deleting other hooks", async () => {
    let created = false;
    let events: unknown;
    const request = vi.fn(
      async (input: {
        method: string;
        path: string;
        body?: { event_types: unknown };
        requestId?: string;
        beforeDispatch?: () => Promise<void>;
      }) => {
        if (input.method === "GET")
          return {
            webhooks: created
              ? [
                  {
                    id: "HOOK1",
                    url: "https://tranche.test/api/webhooks/paypal",
                    event_types: events,
                  },
                ]
              : [],
          };
        expect(input.method).toBe("POST");
        expect(input.requestId).toBeTruthy();
        await input.beforeDispatch?.();
        created = true;
        events = input.body?.event_types;
        throw new Error("lost webhook response");
      },
    );
    const paypal = fakePayPal({ transport: { request } });
    await expect(
      registerPayPalWebhook(testDeps(db, paypal), "https://tranche.test"),
    ).rejects.toThrow("pending_recovery");
    await due();
    expect(await registerPayPalWebhook(testDeps(db, paypal), "https://tranche.test")).toEqual({
      id: "HOOK1",
    });
    expect(request.mock.calls.filter(([input]) => input.method === "POST")).toHaveLength(1);
    expect(request.mock.calls.some(([input]) => input.method === "DELETE")).toBe(false);
  });
});

import "server-only";
import type { HoldMechanism } from "@tranche/contracts";
import { PENDING_ORDER_TTL_HOURS, pendingOrderVerdict, platformFee } from "@tranche/core";
import { type Db, schema, type Tx } from "@tranche/db";
import { approveUrlOf, type PayPal, PayPalError } from "@tranche/paypal";
import { and, desc, eq } from "drizzle-orm";

export class FundingError extends Error {
  constructor(
    readonly status: 404 | 409,
    message: string,
  ) {
    super(message);
  }
}

const HOUR_MS = 60 * 60 * 1000;

async function orderStatus(paypal: Pick<PayPal, "getOrder">, orderId: string) {
  try {
    return await paypal.getOrder(orderId);
  } catch (err) {
    if (err instanceof PayPalError && err.status === 404) return null;
    throw err;
  }
}

// Same row as H3's CHECKOUT.ORDER.APPROVED handler, so the browser callback and the webhook collapse onto one.
export async function enqueuePlaceHold(db: Db | Tx, holdId: string): Promise<void> {
  await db
    .insert(schema.outbox)
    .values({ kind: "place_hold", request: { holdId }, requestId: `place:${holdId}` })
    .onConflictDoNothing({ target: schema.outbox.requestId });
}

export async function startFunding(
  db: Db,
  paypal: Pick<PayPal, "createFundingOrder" | "getOrder">,
  input: {
    dealId: string;
    milestoneId: string;
    mechanism: HoldMechanism;
    appUrl: string;
    portalToken: string;
  },
): Promise<{ orderId: string; approveUrl: string | null }> {
  // ponytail: holds the milestone row lock across PayPal calls (max 20s each); move order creation to the outbox if funding traffic grows
  const result = await db.transaction(async (tx) => {
    const [row] = await tx
      .select({ m: schema.milestone, d: schema.deal, w: schema.workspace, c: schema.client })
      .from(schema.milestone)
      .innerJoin(schema.deal, eq(schema.deal.id, schema.milestone.dealId))
      .innerJoin(schema.workspace, eq(schema.workspace.id, schema.deal.workspaceId))
      .innerJoin(schema.client, eq(schema.client.id, schema.deal.clientId))
      .where(
        and(eq(schema.milestone.id, input.milestoneId), eq(schema.milestone.dealId, input.dealId)),
      )
      .for("update", { of: schema.milestone });
    if (!row) throw new FundingError(404, "Milestone not found");
    if (row.m.state !== "funding")
      throw new FundingError(409, `Milestone is ${row.m.state}, not waiting for funding`);
    if (row.w.paypalOnboarding !== "active" || !row.w.paypalMerchantId)
      throw new FundingError(409, "The agency has not finished connecting PayPal");

    const holds = await tx
      .select()
      .from(schema.hold)
      .where(eq(schema.hold.milestoneId, row.m.id))
      .orderBy(desc(schema.hold.createdAt));
    if (holds.some((h) => h.status === "active"))
      throw new FundingError(409, "Milestone is already funded");
    const now = new Date();
    const pending = holds.find((h) => h.status === "pending");
    if (pending) {
      const order = await orderStatus(paypal, pending.paypalOrderId);
      switch (pendingOrderVerdict(order?.status ?? null, pending.expiresAt, now)) {
        case "reuse":
          return { orderId: pending.paypalOrderId, approveUrl: order && approveUrlOf(order) };
        case "confirming":
          await enqueuePlaceHold(tx, pending.id);
          return "confirming" as const;
        case "wait":
          return "confirming" as const;
        case "dead":
          await tx
            .update(schema.hold)
            .set({ status: "failed" })
            .where(eq(schema.hold.id, pending.id));
      }
    }

    const amount = { currency: row.d.currency, minor: row.m.priceMinor };
    const portal = `${input.appUrl}/portal/${input.portalToken}`;
    const order = await paypal.createFundingOrder({
      requestId: `fund-${row.m.id}-${holds.length}`,
      mechanism: input.mechanism,
      amount,
      platformFee: platformFee(amount),
      payeeMerchantId: row.w.paypalMerchantId,
      milestoneId: row.m.id,
      vaultId: row.c.paypalVaultId,
      returnUrl: `${portal}?funded=${row.m.id}`,
      cancelUrl: portal,
    });
    const [hold] = await tx
      .insert(schema.hold)
      .values({
        milestoneId: row.m.id,
        mechanism: input.mechanism,
        paypalOrderId: order.orderId,
        amountMinor: amount.minor,
        currency: amount.currency,
        status: "pending",
        expiresAt: new Date(now.getTime() + PENDING_ORDER_TTL_HOURS * HOUR_MS),
      })
      .returning({ id: schema.hold.id });
    if (hold && !order.approveUrl) await enqueuePlaceHold(tx, hold.id);
    return { orderId: order.orderId, approveUrl: order.approveUrl };
  });
  // Thrown after commit so the place_hold enqueue above is kept.
  if (result === "confirming") throw new FundingError(409, "Your payment is being confirmed");
  return result;
}

export async function confirmApproval(
  db: Db,
  paypal: Pick<PayPal, "getOrder">,
  input: { dealId: string; orderId: string },
): Promise<{ holdId: string }> {
  const [row] = await db
    .select({ hold: schema.hold })
    .from(schema.hold)
    .innerJoin(schema.milestone, eq(schema.milestone.id, schema.hold.milestoneId))
    .where(
      and(eq(schema.hold.paypalOrderId, input.orderId), eq(schema.milestone.dealId, input.dealId)),
    );
  if (!row) throw new FundingError(404, "Order not found");
  if (row.hold.status !== "pending") return { holdId: row.hold.id };
  // An early or forged callback must not enqueue: a failed place:<holdId> row would swallow the real webhook.
  const order = await orderStatus(paypal, input.orderId);
  if (!order) throw new FundingError(404, "Order not found");
  if (order.status !== "APPROVED")
    throw new FundingError(409, `PayPal order is ${order.status}, not approved`);
  await enqueuePlaceHold(db, row.hold.id);
  return { holdId: row.hold.id };
}

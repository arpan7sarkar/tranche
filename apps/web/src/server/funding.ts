import "server-only";
import type { HoldMechanism } from "@tranche/contracts";
import { type Db, schema, type Tx } from "@tranche/db";
import { approveUrlOf, type PayPal, platformFeeFor } from "@tranche/paypal";
import { and, desc, eq } from "drizzle-orm";

export class FundingError extends Error {
  constructor(
    readonly status: 404 | 409,
    message: string,
  ) {
    super(message);
  }
}

const PENDING_ORDER_TTL_MS = 3 * 60 * 60 * 1000;
const AWAITING_BUYER = new Set(["CREATED", "PAYER_ACTION_REQUIRED", "APPROVED"]);

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
  // ponytail: holds the milestone row lock across one PayPal call (max 20s); move order creation to the outbox if funding traffic grows
  return db.transaction(async (tx) => {
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
    const pending = holds.find((h) => h.status === "pending");
    if (pending) {
      const order = await paypal.getOrder(pending.paypalOrderId);
      if (AWAITING_BUYER.has(order.status))
        return { orderId: order.id, approveUrl: approveUrlOf(order) };
      await tx.update(schema.hold).set({ status: "failed" }).where(eq(schema.hold.id, pending.id));
    }

    const amount = { currency: row.d.currency, minor: row.m.priceMinor };
    const portal = `${input.appUrl}/portal/${input.portalToken}`;
    const order = await paypal.createFundingOrder({
      requestId: `fund-${row.m.id}-${holds.length}`,
      mechanism: input.mechanism,
      amount,
      platformFee: platformFeeFor(amount),
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
        expiresAt: new Date(Date.now() + PENDING_ORDER_TTL_MS),
      })
      .returning({ id: schema.hold.id });
    if (hold && !order.approveUrl) await enqueuePlaceHold(tx, hold.id);
    return { orderId: order.orderId, approveUrl: order.approveUrl };
  });
}

export async function confirmApproval(
  db: Db,
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
  if (row.hold.status === "pending") await enqueuePlaceHold(db, row.hold.id);
  return { holdId: row.hold.id };
}

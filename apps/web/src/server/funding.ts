import "server-only";
import { startDurableFunding } from "@tranche/agents-service/money";
import type { HoldMechanism } from "@tranche/contracts";
import { type Db, schema, type Tx } from "@tranche/db";
import { type PayPal, PayPalError } from "@tranche/paypal";
import { and, eq } from "drizzle-orm";
import { requireWebMoneyEnabled } from "./money-gate";

export class FundingError extends Error {
  constructor(
    readonly status: 404 | 409,
    message: string,
  ) {
    super(message);
  }
}

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
  requireWebMoneyEnabled();
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
  requireWebMoneyEnabled();
  const [m] = await db
    .select({ state: schema.milestone.state })
    .from(schema.milestone)
    .where(
      and(eq(schema.milestone.id, input.milestoneId), eq(schema.milestone.dealId, input.dealId)),
    );
  if (!m) throw new FundingError(404, "Milestone not found");
  if (m.state !== "funding") throw new FundingError(409, "Milestone is not waiting for funding");
  try {
    const result = await startDurableFunding(db, paypal, {
      milestoneId: input.milestoneId,
      dealId: input.dealId,
      states: ["funding"],
      mechanism: input.mechanism,
      requestId: `fund:${input.milestoneId}`,
      returnUrl: `${input.appUrl}/portal/return?milestoneId=${input.milestoneId}`,
      cancelUrl: input.appUrl,
      now: new Date(),
    });
    if (result.status === "created" || result.status === "reused")
      return { orderId: result.orderId, approveUrl: result.approveUrl };
    throw new FundingError(409, "Your payment is being confirmed");
  } catch (error) {
    if (error instanceof FundingError) throw error;
    throw new FundingError(409, "Funding is pending verification. Please try again shortly.");
  }
}

export async function confirmApproval(
  db: Db,
  paypal: Pick<PayPal, "getOrder">,
  input: { dealId: string; orderId: string },
): Promise<{ holdId: string }> {
  requireWebMoneyEnabled();
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

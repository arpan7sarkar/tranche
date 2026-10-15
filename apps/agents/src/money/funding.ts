import type { HoldMechanism } from "@tranche/contracts";
import { PENDING_ORDER_TTL_HOURS, platformFee } from "@tranche/core";
import { type Db, schema } from "@tranche/db";
import { desc, eq } from "drizzle-orm";
import type { PayPal } from "./deps";
import { PermanentError } from "./errors";
import { appendEvent } from "./events";
import { mustAdvance } from "./milestones";
import { enqueueOutbox } from "./outbox";

const HOUR_MS = 3_600_000;
const AWAITING_BUYER = new Set(["CREATED", "PAYER_ACTION_REQUIRED", "APPROVED"]);

export type FundingOutcome =
  | { status: "skipped" }
  | { status: "confirming"; holdId: string }
  | { status: "reused" | "created"; orderId: string; approveUrl: string | null };

function approveUrlOf(order: { links?: Array<{ href: string; rel: string }> }): string | null {
  return order.links?.find((l) => l.rel === "payer-action" || l.rel === "approve")?.href ?? null;
}

function isNotFound(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { status?: unknown }).status === 404;
}

// ponytail: holds the milestone row lock across the PayPal calls (bounded by the transport timeout); move order creation behind the outbox if funding traffic grows
export async function startFunding(
  db: Db,
  paypal: Pick<PayPal, "createFundingOrder" | "getOrder">,
  input: {
    milestoneId: string;
    states: Array<"agreed" | "funding">;
    mechanism: HoldMechanism;
    requestId: string;
    returnUrl: string;
    cancelUrl: string;
    now: Date;
  },
): Promise<FundingOutcome> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({
        milestone: schema.milestone,
        deal: schema.deal,
        client: schema.client,
        workspace: schema.workspace,
      })
      .from(schema.milestone)
      .innerJoin(schema.deal, eq(schema.milestone.dealId, schema.deal.id))
      .innerJoin(schema.client, eq(schema.deal.clientId, schema.client.id))
      .innerJoin(schema.workspace, eq(schema.deal.workspaceId, schema.workspace.id))
      .where(eq(schema.milestone.id, input.milestoneId))
      .for("update", { of: schema.milestone });
    if (!row) throw new PermanentError(`milestone ${input.milestoneId} not found`);
    const { milestone, deal } = row;
    const allowed: string[] = input.states;
    if (!allowed.includes(milestone.state)) return { status: "skipped" };
    const merchantId = row.workspace.paypalMerchantId;
    if (!merchantId) throw new PermanentError("the agency has not connected PayPal");

    const holds = await tx
      .select()
      .from(schema.hold)
      .where(eq(schema.hold.milestoneId, milestone.id))
      .orderBy(desc(schema.hold.createdAt));
    if (holds.some((h) => h.status === "active")) return { status: "skipped" };

    for (const pending of holds.filter((h) => h.status === "pending")) {
      if (pending.expiresAt <= input.now) {
        await tx
          .update(schema.hold)
          .set({ status: "failed" })
          .where(eq(schema.hold.id, pending.id));
        continue;
      }
      let order: Awaited<ReturnType<PayPal["getOrder"]>> | null = null;
      try {
        order = await paypal.getOrder(pending.paypalOrderId);
      } catch (err) {
        if (!isNotFound(err)) throw err;
      }
      if (order && AWAITING_BUYER.has(order.status)) {
        return { status: "reused", orderId: order.id, approveUrl: approveUrlOf(order) };
      }
      if (order?.status === "COMPLETED") {
        await enqueueOutbox(
          tx,
          { kind: "place_hold", request: { holdId: pending.id }, requestId: `place:${pending.id}` },
          input.now,
        );
        return { status: "confirming", holdId: pending.id };
      }
      if (order && order.status !== "VOIDED") {
        throw new Error(
          `order ${order.id} is ${order.status}, cannot decide whether to replace it`,
        );
      }
      await tx.update(schema.hold).set({ status: "failed" }).where(eq(schema.hold.id, pending.id));
    }

    const amount = { currency: deal.currency, minor: milestone.priceMinor };
    const order = await paypal.createFundingOrder({
      requestId: `${input.requestId}:${holds.length}`,
      mechanism: input.mechanism,
      amount,
      platformFee: platformFee(amount),
      payeeMerchantId: merchantId,
      milestoneId: milestone.id,
      vaultId: row.client.paypalVaultId,
      returnUrl: input.returnUrl,
      cancelUrl: input.cancelUrl,
    });
    const [hold] = await tx
      .insert(schema.hold)
      .values({
        milestoneId: milestone.id,
        mechanism: input.mechanism,
        paypalOrderId: order.orderId,
        amountMinor: amount.minor,
        currency: amount.currency,
        status: "pending",
        expiresAt: new Date(input.now.getTime() + PENDING_ORDER_TTL_HOURS * HOUR_MS),
      })
      .returning({ id: schema.hold.id });
    if (!hold) throw new Error("hold insert returned no row");

    const payload = { orderId: order.orderId, approveUrl: order.approveUrl };
    if (milestone.state === "agreed") {
      await mustAdvance(
        tx,
        milestone.id,
        { type: "funding_requested" },
        { now: input.now, payload },
      );
    } else if (order.approveUrl) {
      await appendEvent(tx, {
        type: "milestone.funding_requested",
        dealId: milestone.dealId,
        milestoneId: milestone.id,
        payload: { ...payload, title: milestone.title, state: milestone.state },
      });
    }
    if (order.approveUrl === null) {
      await enqueueOutbox(
        tx,
        { kind: "place_hold", request: { holdId: hold.id }, requestId: `place:${hold.id}` },
        input.now,
      );
    }
    return { status: "created", orderId: order.orderId, approveUrl: order.approveUrl };
  });
}

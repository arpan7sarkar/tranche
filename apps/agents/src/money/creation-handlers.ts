import {
  FundingOrderIntent,
  FundingOrderResponse,
  SellerReferralIntent,
  SellerReferralResponse,
  WebhookRegistrationIntent,
} from "@tranche/contracts";
import { PENDING_ORDER_TTL_HOURS } from "@tranche/core";
import { schema } from "@tranche/db";
import { and, eq, gt, ne, sql } from "drizzle-orm";
import type { Deps } from "./deps";
import { PermanentError } from "./errors";
import { appendEvent } from "./events";
import { mustAdvance } from "./milestones";
import { enqueueOutbox, type OutboxHandler, type OutboxRow } from "./outbox";

function dispatchPermit(deps: Deps, row: OutboxRow) {
  if (row.request._dispatched) throw new Error("creation_requires_resource_recovery");
  let sent = false;
  return async () => {
    if (sent) return;
    const kept = await deps.db
      .update(schema.outbox)
      .set({ request: { ...row.request, _dispatched: true } })
      .where(
        and(
          eq(schema.outbox.id, row.id),
          eq(schema.outbox.attempts, row.attempts),
          eq(schema.outbox.status, "sent"),
          gt(schema.outbox.nextAttemptAt, deps.now()),
          sql`${schema.outbox.request}->>'_dispatched' IS NULL`,
        ),
      )
      .returning({ id: schema.outbox.id });
    if (!kept.length) throw new Error("creation_dispatch_claim_lost");
    sent = true;
  };
}

export const createOrder: OutboxHandler = {
  async call(deps, row) {
    const beforeDispatch = dispatchPermit(deps, row);
    const request = FundingOrderIntent.parse(row.request);
    const [context] = await deps.db
      .select({ m: schema.milestone, d: schema.deal, w: schema.workspace })
      .from(schema.milestone)
      .innerJoin(schema.deal, eq(schema.deal.id, schema.milestone.dealId))
      .innerJoin(schema.workspace, eq(schema.workspace.id, schema.deal.workspaceId))
      .where(eq(schema.milestone.id, request.milestoneId));
    const states =
      row.kind === "create_replacement_order"
        ? ["held", "in_progress", "delivered", "verifying", "changes_requested", "release_pending"]
        : ["agreed", "funding"];
    if (
      !context ||
      !states.includes(context.m.state) ||
      context.w.paypalOnboarding !== "active" ||
      context.w.paypalMerchantId !== request.payeeMerchantId ||
      context.d.currency !== request.amount.currency ||
      context.m.priceMinor !== request.amount.minor
    )
      throw new PermanentError("funding_terms_changed");
    return deps.paypal.createFundingOrder({ ...request, requestId: row.requestId, beforeDispatch });
  },
  async settle(tx, deps, row, response) {
    const request = FundingOrderIntent.parse(row.request);
    const order = FundingOrderResponse.parse(response);
    const [milestone] = await tx
      .select()
      .from(schema.milestone)
      .where(eq(schema.milestone.id, request.milestoneId))
      .for("update");
    if (!milestone) throw new Error("funding_milestone_missing");
    const [existing] = await tx
      .select()
      .from(schema.hold)
      .where(eq(schema.hold.paypalOrderId, order.orderId));
    if (existing) {
      if (existing.milestoneId !== milestone.id) throw new Error("funding_order_identity_conflict");
      return;
    }
    const [hold] = await tx
      .insert(schema.hold)
      .values({
        milestoneId: milestone.id,
        mechanism: request.mechanism,
        paypalOrderId: order.orderId,
        amountMinor: request.amount.minor,
        currency: request.amount.currency,
        status: "pending",
        expiresAt: new Date(deps.now().getTime() + PENDING_ORDER_TTL_HOURS * 3_600_000),
      })
      .returning();
    if (!hold) throw new Error("hold_insert_failed");
    const payload = { orderId: order.orderId, approveUrl: order.approveUrl };
    if (milestone.state === "agreed") {
      await mustAdvance(
        tx,
        milestone.id,
        { type: "funding_requested" },
        { now: deps.now(), payload },
      );
    } else if (milestone.state === "funding" && order.approveUrl) {
      await appendEvent(tx, {
        type: "milestone.funding_requested",
        dealId: milestone.dealId,
        milestoneId: milestone.id,
        payload: { ...payload, title: milestone.title, state: milestone.state },
      });
    }
    // Late funds are cleaned up by activateHold once their provider identity is known.
    if (
      ["agreed", "funding"].includes(milestone.state) &&
      (order.approveUrl === null || ["APPROVED", "COMPLETED"].includes(order.status))
    ) {
      await enqueueOutbox(
        tx,
        { kind: "place_hold", request: { holdId: hold.id }, requestId: `place:${hold.id}` },
        deps.now(),
      );
    }
  },
};

export const createReplacementOrder: OutboxHandler = { call: createOrder.call, async settle() {} };

export const createSellerReferral: OutboxHandler = {
  async call(deps, row) {
    const beforeDispatch = dispatchPermit(deps, row);
    return deps.paypal.createSellerReferral({
      ...SellerReferralIntent.parse(row.request),
      requestId: row.requestId,
      beforeDispatch,
    });
  },
  async settle(tx, _deps, row, response) {
    SellerReferralResponse.parse(response);
    const request = SellerReferralIntent.parse(row.request);
    await tx
      .update(schema.workspace)
      .set({ paypalOnboarding: "pending" })
      .where(
        and(
          eq(schema.workspace.id, request.trackingId),
          ne(schema.workspace.paypalOnboarding, "active"),
        ),
      );
  },
};

export const registerWebhook: OutboxHandler = {
  async call(deps, row) {
    const request = WebhookRegistrationIntent.parse(row.request);
    const { webhooks } = await deps.paypal.transport.request<{
      webhooks: Array<{ id: string; url: string; event_types: Array<{ name: string }> }>;
    }>({ method: "GET", path: "/v1/notifications/webhooks" });
    const matches = webhooks.filter((hook) => hook.url === request.url);
    if (matches.length > 1) throw new Error("webhook_registration_ambiguous");
    const existing = matches[0];
    if (existing) {
      const names = new Set(existing.event_types.map((event) => event.name));
      if (!names.has("*") && !request.events.every((event) => names.has(event)))
        throw new Error("webhook_subscription_mismatch");
      return { id: existing.id };
    }
    const beforeDispatch = dispatchPermit(deps, row);
    const created = await deps.paypal.transport.request<{ id: string }>({
      method: "POST",
      path: "/v1/notifications/webhooks",
      beforeDispatch,
      requestId: row.requestId,
      body: { url: request.url, event_types: request.events.map((name) => ({ name })) },
    });
    if (!created.id) throw new Error("webhook_response_invalid");
    return { id: created.id };
  },
  async settle() {},
};

import { platformFee, renewalAction } from "@tranche/core";
import { schema } from "@tranche/db";
import { and, eq } from "drizzle-orm";
import { PermanentError } from "./errors";
import { appendEvent } from "./events";
import { activeHold, getHold } from "./holds";
import { type OutboxHandler, requestedMilestoneId } from "./outbox";
import { completeReplacement, enqueueVoid, gate } from "./replacement";
import { planRenewal, scheduleTimer } from "./timers";
import { fundingContext } from "./timers-fund";

const RETRY_IN_FLIGHT_MS = 3_600_000;

export const renewHandler: OutboxHandler = {
  async call(deps, row) {
    const milestoneId = requestedMilestoneId(row);
    const hold = await deps.db.transaction((tx) => activeHold(tx, milestoneId));
    if (!hold?.originalAuthorizedAt) return { skipped: true };
    const [replacement] = await deps.db
      .select({ id: schema.hold.id })
      .from(schema.hold)
      .where(and(eq(schema.hold.replacesHoldId, hold.id), eq(schema.hold.status, "pending")));
    if (replacement) return { skipped: true };
    const g = await gate(deps.db, milestoneId, hold.id, false);
    if (g.gate !== "ok") return { holdId: hold.id, blocked: g.gate };
    const action = renewalAction(
      hold.mechanism,
      hold.originalAuthorizedAt.toISOString(),
      deps.now().toISOString(),
      hold.lastReauthorizedAt?.toISOString(),
    );
    const amount = { currency: hold.currency, minor: hold.amountMinor };
    switch (action.kind) {
      case "none":
      case "alert":
        return { holdId: hold.id, action };
      case "reauthorize": {
        if (!hold.paypalAuthorizationId) {
          throw new PermanentError(`hold ${hold.id} has no authorization`);
        }
        const r = await deps.paypal.renewHold({
          requestId: row.requestId,
          authorizationId: hold.paypalAuthorizationId,
          amount,
        });
        return { holdId: hold.id, action, ...r };
      }
      case "new_authorization": {
        const ctx = await fundingContext(deps.db, milestoneId);
        if (!ctx.client.paypalVaultId) {
          throw new PermanentError("no vaulted payment method to renew the hold");
        }
        const order = await deps.paypal.createFundingOrder({
          requestId: `${row.requestId}:order`,
          mechanism: "authorization",
          amount,
          platformFee: platformFee(amount),
          payeeMerchantId: ctx.merchantId,
          milestoneId,
          vaultId: ctx.client.paypalVaultId,
          returnUrl: ctx.returnUrl,
          cancelUrl: ctx.cancelUrl,
        });
        const placed = await deps.paypal.placeHold({
          requestId: `${row.requestId}:hold`,
          orderId: order.orderId,
          mechanism: "authorization",
        });
        return { holdId: hold.id, action, orderId: order.orderId, ...placed };
      }
    }
  },

  async settle(tx, deps, _row, res) {
    if (res.skipped) return;
    const now = deps.now();
    const old = await getHold(tx, String(res.holdId));
    const g = await gate(tx, old.milestoneId, old.id, true);
    const live = old.status === "active";
    const action = res.action as { kind: string; daysLeft?: number } | undefined;

    if (g.gate === "cancelled" && live) await enqueueVoid(tx, old.id, now);

    if (action?.kind === "new_authorization") {
      const pending = res.status === "pending";
      const expiresAt = pending ? old.expiresAt : new Date(String(res.expiresAt));
      if (Number.isNaN(expiresAt.getTime())) {
        throw new Error(
          `PayPal returned no usable expiry for authorization ${res.authorizationId}`,
        );
      }
      // A pending authorization has no expiry yet; it borrows the old hold's deadline until the
      // PAYMENT.AUTHORIZATION.CREATED webhook activates it.
      const [fresh] = await tx
        .insert(schema.hold)
        .values({
          milestoneId: old.milestoneId,
          mechanism: "authorization",
          paypalOrderId: String(res.orderId),
          paypalAuthorizationId: String(res.authorizationId),
          originalAuthorizedAt: pending ? null : now,
          replacesHoldId: old.id,
          amountMinor: old.amountMinor,
          currency: old.currency,
          status: pending ? "pending" : "active",
          expiresAt,
        })
        .returning();
      if (!fresh) throw new Error("hold insert returned no row");
      if (!pending) await completeReplacement(tx, fresh, now);
      return;
    }

    if (action?.kind === "reauthorize" && live) {
      await tx
        .update(schema.hold)
        .set({
          paypalAuthorizationId: String(res.authorizationId),
          expiresAt: new Date(String(res.expiresAt)),
          lastReauthorizedAt: now,
        })
        .where(eq(schema.hold.id, old.id));
    }

    if (g.gate === "in_flight" && live) {
      await scheduleTimer(tx, {
        milestoneId: old.milestoneId,
        kind: "renew_hold",
        dueAt: new Date(now.getTime() + RETRY_IN_FLIGHT_MS),
      });
      return;
    }
    if (g.gate !== "ok" || !live) return;

    if (action?.kind === "alert") {
      const payload = { title: g.title, state: g.state, holdId: old.id, daysLeft: action.daysLeft };
      await appendEvent(tx, {
        type: "milestone.hold_expiring",
        dealId: g.dealId,
        milestoneId: old.milestoneId,
        payload,
      });
      await appendEvent(tx, {
        type: "alert.raised",
        dealId: g.dealId,
        milestoneId: old.milestoneId,
        payload: { kind: "delayed_disbursement_expiring", ...payload },
      });
      return;
    }
    await planRenewal(tx, old);
  },
};

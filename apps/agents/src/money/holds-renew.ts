import { platformFee, renewalAction } from "@tranche/core";
import { type Db, schema } from "@tranche/db";
import { eq } from "drizzle-orm";
import type { Tx } from "./db";
import { PermanentError } from "./errors";
import { appendEvent } from "./events";
import { activeHold, getHold } from "./holds";
import { enqueueOutbox } from "./outbox";
import { type OutboxHandler, requestedMilestoneId } from "./outbox-types";
import { planRenewal } from "./timers";
import { fundingContext } from "./timers-fund";

async function milestoneRef(exec: Db | Tx, milestoneId: string) {
  const [m] = await exec
    .select({
      dealId: schema.milestone.dealId,
      title: schema.milestone.title,
      state: schema.milestone.state,
    })
    .from(schema.milestone)
    .where(eq(schema.milestone.id, milestoneId));
  if (!m) throw new PermanentError(`milestone ${milestoneId} not found`);
  return m;
}

export const renewHandler: OutboxHandler = {
  async call(deps, row) {
    const milestoneId = requestedMilestoneId(row);
    const hold = await deps.db.transaction((tx) => activeHold(tx, milestoneId));
    if (!hold?.originalAuthorizedAt) return { skipped: true };
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
    const action = res.action as { kind: string; daysLeft?: number };
    const ref = await milestoneRef(tx, old.milestoneId);
    const emit = (
      type: "milestone.held" | "milestone.hold_expiring" | "alert.raised",
      payload: object,
    ) =>
      appendEvent(tx, {
        type,
        dealId: ref.dealId,
        milestoneId: old.milestoneId,
        payload: { title: ref.title, state: ref.state, ...payload },
      });

    if (action.kind === "new_authorization") {
      const [fresh] = await tx
        .insert(schema.hold)
        .values({
          milestoneId: old.milestoneId,
          mechanism: "authorization",
          paypalOrderId: String(res.orderId),
          paypalAuthorizationId: String(res.authorizationId),
          originalAuthorizedAt: now,
          amountMinor: old.amountMinor,
          currency: old.currency,
          status: "active",
          expiresAt: new Date(String(res.expiresAt)),
        })
        .returning();
      if (!fresh) throw new Error("hold insert returned no row");
      if (old.status !== "active") {
        await enqueueOutbox(
          tx,
          { kind: "void_hold", request: { holdId: fresh.id }, requestId: `void:${fresh.id}` },
          now,
        );
        return;
      }
      await enqueueOutbox(
        tx,
        { kind: "void_hold", request: { holdId: old.id }, requestId: `void:${old.id}` },
        now,
      );
      await planRenewal(tx, fresh);
      await emit("milestone.held", { renewed: true, holdId: fresh.id, replacedHoldId: old.id });
      return;
    }

    if (old.status !== "active") return;
    switch (action.kind) {
      case "none":
        await planRenewal(tx, old);
        return;
      case "alert":
        await emit("milestone.hold_expiring", { holdId: old.id, daysLeft: action.daysLeft });
        await emit("alert.raised", {
          kind: "delayed_disbursement_expiring",
          holdId: old.id,
          daysLeft: action.daysLeft,
        });
        return;
      case "reauthorize":
        await tx
          .update(schema.hold)
          .set({
            paypalAuthorizationId: String(res.authorizationId),
            expiresAt: new Date(String(res.expiresAt)),
            lastReauthorizedAt: now,
          })
          .where(eq(schema.hold.id, old.id));
        await planRenewal(tx, old);
        return;
    }
  },
};

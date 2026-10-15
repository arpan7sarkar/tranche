import type { MilestoneState } from "@tranche/contracts";
import { platformFee, renewalAction } from "@tranche/core";
import { type Db, schema } from "@tranche/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { Tx } from "./db";
import { PermanentError } from "./errors";
import { appendEvent } from "./events";
import { activeHold, getHold } from "./holds";
import { enqueueOutbox, type OutboxHandler, requestedMilestoneId } from "./outbox";
import { planRenewal, scheduleTimer } from "./timers";
import { fundingContext } from "./timers-fund";

const RENEWABLE: MilestoneState[] = [
  "held",
  "in_progress",
  "delivered",
  "verifying",
  "changes_requested",
  "release_pending",
];
const RETRY_IN_FLIGHT_MS = 3_600_000;

type Gate = "ok" | "cancelled" | "inactive" | "in_flight";

// A renewal must not outlive its milestone, nor race a release or void already on its way to PayPal.
async function gate(
  exec: Db | Tx,
  milestoneId: string,
  holdId: string,
  lock: boolean,
): Promise<{ gate: Gate; dealId: string; title: string; state: MilestoneState }> {
  const query = exec
    .select({
      state: schema.milestone.state,
      dealId: schema.milestone.dealId,
      title: schema.milestone.title,
    })
    .from(schema.milestone)
    .where(eq(schema.milestone.id, milestoneId));
  const [m] = await (lock ? query.for("update") : query);
  if (!m) throw new PermanentError(`milestone ${milestoneId} not found`);
  const ref = { dealId: m.dealId, title: m.title, state: m.state };
  if (m.state === "cancelled") return { gate: "cancelled", ...ref };
  if (!RENEWABLE.includes(m.state)) return { gate: "inactive", ...ref };
  const inFlight = await exec
    .select({ id: schema.outbox.id })
    .from(schema.outbox)
    .where(
      and(
        inArray(schema.outbox.kind, ["release", "void_hold"]),
        inArray(schema.outbox.status, ["pending", "sent"]),
        sql`${schema.outbox.request}->>'holdId' = ${holdId}`,
      ),
    )
    .limit(1);
  return { gate: inFlight.length > 0 ? "in_flight" : "ok", ...ref };
}

export const renewHandler: OutboxHandler = {
  async call(deps, row) {
    const milestoneId = requestedMilestoneId(row);
    const hold = await deps.db.transaction((tx) => activeHold(tx, milestoneId));
    if (!hold?.originalAuthorizedAt) return { skipped: true };
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
    const open = g.gate === "ok" && live;
    const action = res.action as { kind: string; daysLeft?: number } | undefined;
    const emit = (
      type: "milestone.held" | "milestone.hold_expiring" | "alert.raised",
      payload: object,
    ) =>
      appendEvent(tx, {
        type,
        dealId: g.dealId,
        milestoneId: old.milestoneId,
        payload: { title: g.title, state: g.state, ...payload },
      });
    const voidHold = (holdId: string) =>
      enqueueOutbox(
        tx,
        { kind: "void_hold", request: { holdId }, requestId: `void:${holdId}` },
        now,
      );

    if (g.gate === "cancelled" && live) await voidHold(old.id);

    if (action?.kind === "new_authorization") {
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
      if (!open) {
        await voidHold(fresh.id);
        return;
      }
      await voidHold(old.id);
      await planRenewal(tx, fresh);
      await emit("milestone.held", { renewed: true, holdId: fresh.id, replacedHoldId: old.id });
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
    if (!open) return;

    if (action?.kind === "alert") {
      await emit("milestone.hold_expiring", { holdId: old.id, daysLeft: action.daysLeft });
      await emit("alert.raised", {
        kind: "delayed_disbursement_expiring",
        holdId: old.id,
        daysLeft: action.daysLeft,
      });
      return;
    }
    await planRenewal(tx, old);
  },
};

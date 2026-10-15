import { type HoldMechanism, type HoldStatus, toPayPalValue } from "@tranche/contracts";
import { schema } from "@tranche/db";
import { holdFromOrder, type OrderRes, PayPalError, type PlaceHoldResult } from "@tranche/paypal";
import { and, eq, inArray, lt, or, sql } from "drizzle-orm";
import type { Tx } from "./db";
import type { Deps, PayPal } from "./deps";
import { errorMessage } from "./errors";
import { appendEvent } from "./events";
import { failPendingHold, type HoldRow } from "./holds";
import { handlePayPalEvent } from "./paypal-events";

const EXPECTED: Record<HoldMechanism, Partial<Record<HoldStatus, string[]>>> = {
  authorization: { active: ["CREATED", "PENDING"], released: ["COMPLETED", "PENDING"] },
  delayed_disbursement: { active: ["COMPLETED"], released: ["COMPLETED"] },
};
const REFUNDED = ["REFUNDED", "PARTIALLY_REFUNDED"];
// PayPal's buyer-protection window; after it a released capture no longer changes.
const SETTLED_AFTER_MS = 180 * 86_400_000;
// A pending hold this old has most likely lost its webhook, or PayPal sent it before we listened.
const PENDING_GRACE_MS = 15 * 60_000;

async function remoteStatus(paypal: PayPal, h: HoldRow): Promise<string | null> {
  if (h.mechanism === "authorization" && h.status === "active") {
    return h.paypalAuthorizationId
      ? (await paypal.getAuthorization(h.paypalAuthorizationId)).status
      : null;
  }
  return h.paypalCaptureId ? (await paypal.getCapture(h.paypalCaptureId)).status : null;
}

// PayPal being down or rejecting our credentials says nothing about any single hold.
const unreachable = (err: unknown) =>
  !(err instanceof PayPalError) || err.retryable || err.status === 401;

export async function reconcile(
  deps: Deps,
): Promise<{ checked: number; mismatches: number; recovered: number }> {
  const now = deps.now();
  const rows = await deps.db
    .select({
      hold: schema.hold,
      dealId: schema.milestone.dealId,
      state: schema.milestone.state,
      updatedAt: schema.milestone.updatedAt,
    })
    .from(schema.hold)
    .innerJoin(schema.milestone, eq(schema.hold.milestoneId, schema.milestone.id))
    .where(inArray(schema.hold.status, ["active", "released"]));
  // A hold with outbox work in flight (release, void, renewal, refunding) is mid-change on purpose.
  const inFlight = await deps.db
    .select({ request: schema.outbox.request })
    .from(schema.outbox)
    .where(inArray(schema.outbox.status, ["pending", "sent", "called"]));
  const busy = new Set(
    inFlight.flatMap((r) => [r.request.holdId, r.request.milestoneId]).filter(Boolean),
  );

  let checked = 0;
  let mismatches = 0;
  const unreachableHolds: string[] = [];
  let lastError = "";
  for (const { hold, dealId, state, updatedAt } of rows) {
    if (busy.has(hold.id) || busy.has(hold.milestoneId)) continue;
    const settled = now.getTime() - updatedAt.getTime() > SETTLED_AFTER_MS;
    if (hold.status === "released" && (state === "refunded" || settled)) continue;
    checked++;
    let theirs: string | null;
    try {
      theirs = await remoteStatus(deps.paypal, hold);
    } catch (err) {
      if (unreachable(err)) {
        unreachableHolds.push(hold.id);
        lastError = errorMessage(err);
        continue;
      }
      theirs = `ERROR: ${errorMessage(err)}`;
    }
    if (theirs === null || EXPECTED[hold.mechanism][hold.status]?.includes(theirs)) continue;
    mismatches++;
    if (await alreadyAlerted(deps, hold.id, theirs)) continue;
    await deps.db.transaction((tx) =>
      appendEvent(tx, {
        type: "alert.raised",
        dealId,
        milestoneId: hold.milestoneId,
        payload: { kind: "reconciliation", holdId: hold.id, ours: hold.status, theirs },
      }),
    );
  }
  const pending = await deps.db
    .select()
    .from(schema.hold)
    .where(
      and(
        eq(schema.hold.status, "pending"),
        lt(schema.hold.createdAt, new Date(now.getTime() - PENDING_GRACE_MS)),
      ),
    );
  let recovered = 0;
  for (const hold of pending) {
    if (busy.has(hold.id) || busy.has(hold.milestoneId)) continue;
    checked++;
    let order: OrderRes;
    try {
      order = await deps.paypal.getOrder(hold.paypalOrderId);
    } catch (err) {
      if (unreachable(err)) {
        unreachableHolds.push(hold.id);
        lastError = errorMessage(err);
        continue;
      }
      const theirs = `ERROR: ${errorMessage(err)}`;
      mismatches++;
      if (await alreadyAlerted(deps, hold.id, theirs)) continue;
      await deps.db.transaction((tx) =>
        appendEvent(tx, {
          type: "alert.raised",
          dealId: null,
          milestoneId: hold.milestoneId,
          payload: { kind: "reconciliation", holdId: hold.id, ours: hold.status, theirs },
        }),
      );
      continue;
    }
    if (await deps.db.transaction((tx) => replayPending(tx, deps, hold, order))) recovered++;
  }
  if (unreachableHolds.length > 0) {
    await deps.db.transaction((tx) =>
      appendEvent(tx, {
        type: "alert.raised",
        dealId: null,
        milestoneId: null,
        payload: {
          kind: "reconciliation_unavailable",
          holds: unreachableHolds.length,
          error: lastError,
        },
      }),
    );
  }
  return { checked, mismatches, recovered };
}

// Replays what PayPal reports for a pending hold through the webhook path, so a lost
// authorization or capture event, a renewal replacement included, still activates or fails it.
async function replayPending(tx: Tx, deps: Deps, hold: HoldRow, order: OrderRes): Promise<boolean> {
  let placed: PlaceHoldResult | null;
  try {
    placed = holdFromOrder(order, hold.mechanism);
  } catch (err) {
    await failPendingHold(tx, hold, errorMessage(err), deps.now());
    return true;
  }
  if (!placed) {
    if (order.status !== "APPROVED") return false;
    await handlePayPalEvent(tx, deps, "CHECKOUT.ORDER.APPROVED", { id: order.id });
    return true;
  }
  if (placed.status === "pending") {
    await tx
      .update(schema.hold)
      .set({
        paypalCaptureId: placed.captureId ?? hold.paypalCaptureId,
        paypalAuthorizationId: placed.authorizationId ?? hold.paypalAuthorizationId,
      })
      .where(eq(schema.hold.id, hold.id));
    return false;
  }
  const payments = order.purchase_units?.[0]?.payments;
  const payment =
    hold.mechanism === "authorization" ? payments?.authorizations?.[0] : payments?.captures?.[0];
  if (!payment) return false;
  const amount = payment.amount ?? {
    currency_code: hold.currency,
    value: toPayPalValue({ currency: hold.currency, minor: hold.amountMinor }),
  };
  await handlePayPalEvent(
    tx,
    deps,
    hold.mechanism === "authorization"
      ? "PAYMENT.AUTHORIZATION.CREATED"
      : "PAYMENT.CAPTURE.COMPLETED",
    { ...payment, amount, supplementary_data: { related_ids: { order_id: order.id } } },
  );
  return true;
}

// One alert per hold and PayPal status; a refund the webhook already reported counts too.
async function alreadyAlerted(deps: Deps, holdId: string, theirs: string): Promise<boolean> {
  const p = schema.event.payload;
  const [e] = await deps.db
    .select({ id: schema.event.id })
    .from(schema.event)
    .where(
      and(
        eq(schema.event.type, "alert.raised"),
        sql`${p}->>'holdId' = ${holdId}`,
        or(
          sql`${p}->>'theirs' = ${theirs}`,
          REFUNDED.includes(theirs) ? sql`${p}->>'kind' = 'refund_received'` : undefined,
        ),
      ),
    )
    .limit(1);
  return Boolean(e);
}

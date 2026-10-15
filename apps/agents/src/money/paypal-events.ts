import { fromPayPalValue, type HoldMechanism } from "@tranche/contracts";
import { schema } from "@tranche/db";
import { holdFromOrder } from "@tranche/paypal";
import { and, eq, ne } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "./db";
import type { Deps } from "./deps";
import { must } from "./errors";
import { appendEvent } from "./events";
import { activateHold, confirmRelease, holdWhere } from "./holds";
import { advanceMilestone } from "./milestones";
import { enqueueOutbox } from "./outbox";

// One expiry rule for both paths: the webhook resource goes through the same holdFromOrder that
// the synchronous placeHold uses. Null means PayPal has not guaranteed the funds yet.
function heldUntil(
  mechanism: HoldMechanism,
  payment: { id: string; status: string; create_time: string; expiration_time?: string },
): Date | null {
  const payments =
    mechanism === "authorization"
      ? { authorizations: [{ ...payment, expiration_time: payment.expiration_time ?? "" }] }
      : { captures: [payment] };
  const h = holdFromOrder({ id: "", status: "", purchase_units: [{ payments }] }, mechanism);
  return h?.status === "active" ? new Date(h.expiresAt) : null;
}

const BUYER_WINS = new Set(["RESOLVED_BUYER_FAVOUR", "ACCEPTED"]);
const SELLER_WINS = new Set(["RESOLVED_SELLER_FAVOUR", "CANCELED_BY_BUYER", "DENIED"]);

const Amount = z.object({ currency_code: z.string(), value: z.string() });
const OrderRef = z.object({
  supplementary_data: z.object({ related_ids: z.object({ order_id: z.string() }) }),
});
const Payment = z
  .object({
    id: z.string(),
    status: z.string().optional(),
    amount: Amount,
    create_time: z.string().optional(),
  })
  .and(OrderRef);
const Authorization = Payment.and(z.object({ expiration_time: z.string() }));
const Refund = z.object({
  id: z.string(),
  amount: Amount,
  links: z.array(z.object({ rel: z.string(), href: z.string() })),
});
const Dispute = z.object({
  dispute_id: z.string(),
  disputed_transactions: z.array(z.object({ seller_transaction_id: z.string() })).min(1),
  dispute_outcome: z.object({ outcome_code: z.string() }).optional(),
});

const minor = (a: z.infer<typeof Amount>) => fromPayPalValue(a.currency_code, a.value).minor;

// Refused transitions are ignored on purpose: PayPal redelivers events, and a refusal
// means the fact is already applied.
export async function handlePayPalEvent(
  tx: Tx,
  deps: Deps,
  eventType: string,
  resource: Record<string, unknown>,
): Promise<void> {
  const now = deps.now();
  switch (eventType) {
    case "CHECKOUT.ORDER.APPROVED": {
      const { id } = z.object({ id: z.string() }).parse(resource);
      const hold = await holdWhere(tx, "paypalOrderId", id);
      if (hold?.status === "pending") {
        await enqueueOutbox(
          tx,
          { kind: "place_hold", request: { holdId: hold.id }, requestId: `place:${hold.id}` },
          now,
        );
      }
      return;
    }
    case "PAYMENT.AUTHORIZATION.CREATED": {
      const r = Authorization.parse(resource);
      // A PENDING authorization guarantees nothing yet; the milestone stays in funding.
      const hold = await holdWhere(tx, "paypalOrderId", r.supplementary_data.related_ids.order_id);
      if (!hold) return;
      const createdAt = r.create_time ?? now.toISOString();
      const expiresAt = heldUntil("authorization", {
        ...r,
        status: r.status ?? "CREATED",
        create_time: createdAt,
      });
      // A PENDING authorization guarantees nothing yet; the milestone stays in funding.
      if (!expiresAt) return;
      await activateHold(
        tx,
        hold,
        {
          authorizationId: r.id,
          anchorAt: new Date(createdAt),
          expiresAt,
          amountMinor: minor(r.amount),
        },
        now,
      );
      return;
    }
    case "PAYMENT.CAPTURE.COMPLETED": {
      const r = Payment.parse(resource);
      if (r.status !== undefined && r.status !== "COMPLETED") return;
      const hold = await holdWhere(tx, "paypalOrderId", r.supplementary_data.related_ids.order_id);
      if (!hold) return;
      if (hold.mechanism === "delayed_disbursement" && hold.status === "pending") {
        const capturedAt = r.create_time ?? now.toISOString();
        const expiresAt = heldUntil("delayed_disbursement", {
          ...r,
          status: r.status ?? "COMPLETED",
          create_time: capturedAt,
        });
        if (!expiresAt) return;
        await activateHold(
          tx,
          hold,
          {
            captureId: r.id,
            anchorAt: new Date(capturedAt),
            expiresAt,
            amountMinor: minor(r.amount),
          },
          now,
        );
      } else if (hold.mechanism === "authorization") {
        await confirmRelease(tx, hold, { captureId: r.id, amountMinor: minor(r.amount) }, now);
      }
      return;
    }
    case "PAYMENT.CAPTURE.REFUNDED": {
      const r = Refund.parse(resource);
      const captureId = r.links.find((l) => l.rel === "up")?.href.match(/captures\/([^/?]+)/)?.[1];
      const hold = captureId ? await holdWhere(tx, "paypalCaptureId", captureId) : undefined;
      if (!hold) return;
      const [m] = await tx
        .select()
        .from(schema.milestone)
        .where(eq(schema.milestone.id, hold.milestoneId));
      // Our own cancellation refunds a delayed hold; that refund needs no further handling.
      if (!m || m.state === "cancelled" || m.state === "refunded") return;
      const refundedMinor = minor(r.amount);
      const full = refundedMinor === hold.amountMinor;
      const applied =
        full &&
        (
          await advanceMilestone(
            tx,
            m.id,
            { type: "refund_confirmed" },
            { now, payload: { refundId: r.id } },
          )
        ).applied;
      if (applied) {
        await tx.update(schema.hold).set({ status: "voided" }).where(eq(schema.hold.id, hold.id));
        return;
      }
      await appendEvent(tx, {
        type: "alert.raised",
        dealId: m.dealId,
        milestoneId: m.id,
        payload: {
          kind: "refund_received",
          refundId: r.id,
          holdId: hold.id,
          refundedMinor,
          state: m.state,
          title: m.title,
        },
      });
      return;
    }
    case "PAYMENT.REFERENCED-PAYOUT-ITEM.COMPLETED": {
      const { reference_id } = z.object({ reference_id: z.string() }).parse(resource);
      const hold = await holdWhere(tx, "paypalCaptureId", reference_id);
      if (hold) {
        await confirmRelease(tx, hold, { captureId: null, amountMinor: hold.amountMinor }, now);
      }
      return;
    }
    case "PAYMENT.AUTHORIZATION.VOIDED": {
      const { id } = z.object({ id: z.string() }).parse(resource);
      const hold = await holdWhere(tx, "paypalAuthorizationId", id);
      if (!hold || hold.status === "voided") return;
      await tx.update(schema.hold).set({ status: "voided" }).where(eq(schema.hold.id, hold.id));
      const [replacement] = await tx
        .select({ id: schema.hold.id })
        .from(schema.hold)
        .where(
          and(
            eq(schema.hold.milestoneId, hold.milestoneId),
            eq(schema.hold.status, "active"),
            ne(schema.hold.id, hold.id),
          ),
        )
        .limit(1);
      if (replacement) return;
      const [m] = await tx
        .select()
        .from(schema.milestone)
        .where(eq(schema.milestone.id, hold.milestoneId));
      if (m && m.state !== "cancelled") {
        await appendEvent(tx, {
          type: "alert.raised",
          dealId: m.dealId,
          milestoneId: m.id,
          payload: { kind: "hold_voided", holdId: hold.id, state: m.state, title: m.title },
        });
      }
      return;
    }
    case "CUSTOMER.DISPUTE.CREATED":
    case "CUSTOMER.DISPUTE.RESOLVED": {
      const r = Dispute.parse(resource);
      const hold = await holdWhere(
        tx,
        "paypalCaptureId",
        must(r.disputed_transactions[0]).seller_transaction_id,
      );
      if (!hold) return;
      const payload = { disputeId: r.dispute_id };
      if (eventType === "CUSTOMER.DISPUTE.CREATED") {
        await advanceMilestone(tx, hold.milestoneId, { type: "dispute_opened" }, { now, payload });
      } else {
        const code = r.dispute_outcome?.outcome_code ?? "";
        const outcome = BUYER_WINS.has(code) ? "buyer" : SELLER_WINS.has(code) ? "merchant" : null;
        if (outcome) {
          await advanceMilestone(
            tx,
            hold.milestoneId,
            { type: "dispute_resolved", outcome },
            { now, payload },
          );
          return;
        }
        // An outcome we cannot map (RESOLVED_WITH_PAYOUT, anything new) changes no money state.
        const [m] = await tx
          .select({ dealId: schema.milestone.dealId })
          .from(schema.milestone)
          .where(eq(schema.milestone.id, hold.milestoneId));
        await appendEvent(tx, {
          type: "alert.raised",
          dealId: m?.dealId ?? null,
          milestoneId: hold.milestoneId,
          payload: { kind: "dispute_outcome_unknown", disputeId: r.dispute_id, outcome: code },
        });
      }
      return;
    }
    case "PAYMENT.PAYOUTSBATCH.SUCCESS": {
      const batchId = z
        .object({ batch_header: z.object({ payout_batch_id: z.string() }) })
        .parse(resource).batch_header.payout_batch_id;
      const done = await tx
        .update(schema.payout)
        .set({ status: "completed" })
        .where(eq(schema.payout.paypalRef, batchId))
        .returning({ milestoneId: schema.payout.milestoneId });
      for (const milestoneId of new Set(done.map((d) => d.milestoneId))) {
        const open = await tx
          .select({ id: schema.payout.id })
          .from(schema.payout)
          .where(
            and(eq(schema.payout.milestoneId, milestoneId), ne(schema.payout.status, "completed")),
          );
        if (open.length === 0) {
          await advanceMilestone(tx, milestoneId, { type: "payout_confirmed" }, { now });
        }
      }
      return;
    }
    default:
      return;
  }
}

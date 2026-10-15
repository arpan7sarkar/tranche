import { fromPayPalValue } from "@tranche/contracts";
import { schema } from "@tranche/db";
import { and, eq, ne } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "./db";
import type { Deps } from "./deps";
import { must } from "./errors";
import { appendEvent } from "./events";
import { activateHold, confirmRelease, holdWhere } from "./holds";
import { advanceMilestone } from "./milestones";
import { enqueueOutbox } from "./outbox";

// The same deadlines @tranche/paypal's holdFromOrder computes, so the webhook path and the
// synchronous placeHold path always store one expiry for the same hold.
const DAY_MS = 86_400_000;
const DELAYED_SAFE_DAYS = 27;
const authorizationExpiresAt = (expirationTime: string) =>
  new Date(Date.parse(expirationTime) - DAY_MS);
const delayedExpiresAt = (capturedAt: Date) =>
  new Date(capturedAt.getTime() + DELAYED_SAFE_DAYS * DAY_MS);

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
      if (r.status !== undefined && r.status !== "CREATED") return;
      const hold = await holdWhere(tx, "paypalOrderId", r.supplementary_data.related_ids.order_id);
      if (!hold) return;
      await activateHold(
        tx,
        hold,
        {
          authorizationId: r.id,
          anchorAt: new Date(r.create_time ?? now.toISOString()),
          expiresAt: authorizationExpiresAt(r.expiration_time),
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
        const anchorAt = new Date(r.create_time ?? now.toISOString());
        await activateHold(
          tx,
          hold,
          {
            captureId: r.id,
            anchorAt,
            expiresAt: delayedExpiresAt(anchorAt),
            amountMinor: minor(r.amount),
          },
          now,
        );
      } else if (hold.mechanism === "authorization") {
        await confirmRelease(tx, hold, { captureId: r.id, amountMinor: minor(r.amount) }, now);
      }
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

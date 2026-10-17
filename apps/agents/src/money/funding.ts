import type { HoldMechanism } from "@tranche/contracts";
import { FundingOrderResponse } from "@tranche/contracts";
import { pendingOrderVerdict, platformFee } from "@tranche/core";
import { type Db, schema } from "@tranche/db";
import { desc, eq } from "drizzle-orm";
import type { PayPal } from "./deps";
import { PermanentError } from "./errors";
import { enqueueOutbox } from "./outbox";
import { executeOutbox } from "./outbox-executor";

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

export async function startFunding(
  db: Db,
  paypal: Pick<PayPal, "createFundingOrder" | "getOrder">,
  input: {
    milestoneId: string;
    dealId?: string;
    states: Array<"agreed" | "funding">;
    mechanism: HoldMechanism;
    requestId: string;
    returnUrl: string;
    cancelUrl: string;
    now: Date;
  },
): Promise<FundingOutcome> {
  const outcome = await db.transaction<FundingOutcome | { status: "queued"; id: string }>(
    async (tx) => {
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
      if (!row || (input.dealId && row.deal.id !== input.dealId))
        throw new PermanentError(`milestone ${input.milestoneId} not found`);
      const { milestone, deal } = row;
      const allowed: string[] = input.states;
      if (!allowed.includes(milestone.state)) return { status: "skipped" };
      const merchantId = row.workspace.paypalMerchantId;
      if (!merchantId || row.workspace.paypalOnboarding !== "active")
        throw new PermanentError("the agency has not connected PayPal");

      const holds = await tx
        .select()
        .from(schema.hold)
        .where(eq(schema.hold.milestoneId, milestone.id))
        .orderBy(desc(schema.hold.createdAt));
      if (holds.some((h) => h.status === "active")) return { status: "skipped" };

      for (const pending of holds.filter((h) => h.status === "pending")) {
        let order: Awaited<ReturnType<PayPal["getOrder"]>> | null = null;
        try {
          order = await paypal.getOrder(pending.paypalOrderId);
        } catch (err) {
          if (!isNotFound(err)) throw err;
        }
        const verdict = pendingOrderVerdict(order?.status ?? null, pending.expiresAt, input.now);
        if (verdict === "reuse" && order) {
          return { status: "reused", orderId: order.id, approveUrl: approveUrlOf(order) };
        }
        if (verdict === "confirming") {
          await enqueueOutbox(
            tx,
            {
              kind: "place_hold",
              request: { holdId: pending.id },
              requestId: `place:${pending.id}`,
            },
            input.now,
          );
          return { status: "confirming", holdId: pending.id };
        }
        if (verdict === "wait") {
          throw new Error(
            `order ${pending.paypalOrderId} is ${order?.status}, not replacing it yet`,
          );
        }
        await tx
          .update(schema.hold)
          .set({ status: "failed" })
          .where(eq(schema.hold.id, pending.id));
      }

      const amount = { currency: deal.currency, minor: milestone.priceMinor };
      const request = {
        mechanism: input.mechanism,
        amount,
        platformFee: platformFee(amount),
        payeeMerchantId: merchantId,
        milestoneId: milestone.id,
        vaultId: row.client.paypalVaultId,
        returnUrl: input.returnUrl,
        cancelUrl: input.cancelUrl,
      };
      const requestId = `create-funding:${milestone.id}:${holds.length}`;
      await enqueueOutbox(tx, { kind: "create_funding_order", request, requestId }, input.now);
      const [intent] = await tx
        .select()
        .from(schema.outbox)
        .where(eq(schema.outbox.requestId, requestId));
      if (!intent) throw new Error("funding_intent_missing");
      return { status: "queued" as const, id: intent.id };
    },
  );
  if (outcome.status !== "queued") return outcome as FundingOutcome;
  await executeOutbox({ db, paypal: paypal as PayPal, now: () => input.now }, 1, outcome.id);
  const [intent] = await db.select().from(schema.outbox).where(eq(schema.outbox.id, outcome.id));
  if (intent?.status !== "succeeded") throw new Error("funding_creation_pending_recovery");
  const order = FundingOrderResponse.parse(intent.response);
  return { status: "created", orderId: order.orderId, approveUrl: order.approveUrl };
}

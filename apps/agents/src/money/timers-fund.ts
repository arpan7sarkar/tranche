import { HoldMechanism } from "@tranche/contracts";
import { platformFee } from "@tranche/core";
import { type Db, schema } from "@tranche/db";
import { and, eq, inArray } from "drizzle-orm";
import type { Tx } from "./db";
import { PermanentError } from "./errors";
import { mustAdvance } from "./milestones";
import { enqueueOutbox } from "./outbox";
import { type OutboxHandler, requestedMilestoneId } from "./outbox-types";

const DAY_MS = 86_400_000;
const ORDER_TTL_DAYS = 3;
const OPEN_HOLD: Array<"pending" | "active"> = ["pending", "active"];

export function holdMechanism(): HoldMechanism {
  return HoldMechanism.parse(process.env.HOLD_MECHANISM ?? "authorization");
}

function appUrl(): string {
  return (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

export async function fundingContext(exec: Db | Tx, milestoneId: string) {
  const [row] = await exec
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
    .where(eq(schema.milestone.id, milestoneId));
  if (!row) throw new PermanentError(`milestone ${milestoneId} not found`);
  if (!row.workspace.paypalMerchantId) {
    throw new PermanentError("the agency has not connected PayPal");
  }
  return {
    ...row,
    merchantId: row.workspace.paypalMerchantId,
    returnUrl: `${appUrl()}/portal/return?milestoneId=${milestoneId}`,
    cancelUrl: appUrl(),
  };
}

async function openHolds(exec: Db | Tx, milestoneId: string) {
  return exec
    .select({ id: schema.hold.id })
    .from(schema.hold)
    .where(and(eq(schema.hold.milestoneId, milestoneId), inArray(schema.hold.status, OPEN_HOLD)));
}

export const fundHandler: OutboxHandler = {
  async call(deps, row) {
    const ctx = await fundingContext(deps.db, requestedMilestoneId(row));
    if (ctx.milestone.state !== "agreed" && ctx.milestone.state !== "funding") {
      return { skipped: true };
    }
    if ((await openHolds(deps.db, ctx.milestone.id)).length > 0) return { skipped: true };
    const mechanism = holdMechanism();
    const amount = { currency: ctx.deal.currency, minor: ctx.milestone.priceMinor };
    const order = await deps.paypal.createFundingOrder({
      requestId: row.requestId,
      mechanism,
      amount,
      platformFee: platformFee(amount),
      payeeMerchantId: ctx.merchantId,
      milestoneId: ctx.milestone.id,
      vaultId: ctx.client.paypalVaultId,
      returnUrl: ctx.returnUrl,
      cancelUrl: ctx.cancelUrl,
    });
    return { orderId: order.orderId, approveUrl: order.approveUrl, mechanism };
  },

  async settle(tx, deps, row, res) {
    if (res.skipped) return;
    const now = deps.now();
    const milestoneId = requestedMilestoneId(row);
    const ctx = await fundingContext(tx, milestoneId);
    const [fresh] = await tx
      .select({ state: schema.milestone.state })
      .from(schema.milestone)
      .where(eq(schema.milestone.id, milestoneId))
      .for("update");
    if (fresh?.state !== "agreed" && fresh?.state !== "funding") return;
    if ((await openHolds(tx, milestoneId)).length > 0) return;

    const orderId = String(res.orderId);
    const approveUrl = typeof res.approveUrl === "string" ? res.approveUrl : null;
    const [hold] = await tx
      .insert(schema.hold)
      .values({
        milestoneId,
        mechanism: HoldMechanism.parse(res.mechanism),
        paypalOrderId: orderId,
        amountMinor: ctx.milestone.priceMinor,
        currency: ctx.deal.currency,
        status: "pending",
        expiresAt: new Date(now.getTime() + ORDER_TTL_DAYS * DAY_MS),
      })
      .returning({ id: schema.hold.id });
    if (!hold) throw new Error("hold insert returned no row");
    if (fresh.state === "agreed") {
      await mustAdvance(
        tx,
        milestoneId,
        { type: "funding_requested" },
        { now, payload: { orderId, approveUrl } },
      );
    }
    if (approveUrl === null) {
      await enqueueOutbox(
        tx,
        { kind: "place_hold", request: { holdId: hold.id }, requestId: `place:${hold.id}` },
        now,
      );
    }
  },
};

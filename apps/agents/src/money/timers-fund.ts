import { HoldMechanism } from "@tranche/contracts";
import { type Db, schema } from "@tranche/db";
import { eq } from "drizzle-orm";
import type { Tx } from "./db";
import { PermanentError } from "./errors";
import { startFunding } from "./funding";
import { type OutboxHandler, requestedMilestoneId } from "./outbox-types";

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

export const fundHandler: OutboxHandler = {
  async call(deps, row) {
    const milestoneId = requestedMilestoneId(row);
    const outcome = await startFunding(deps.db, deps.paypal, {
      milestoneId,
      states: ["agreed", "funding"],
      mechanism: holdMechanism(),
      requestId: row.requestId,
      returnUrl: `${appUrl()}/portal/return?milestoneId=${milestoneId}`,
      cancelUrl: appUrl(),
      now: deps.now(),
    });
    return { ...outcome };
  },

  // The order and its hold are recorded atomically under the milestone lock in `call`.
  async settle() {},
};

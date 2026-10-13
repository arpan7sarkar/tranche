import { createMagicLink, schema } from "@tranche/db";
import { and, eq, exists, sql } from "drizzle-orm";
import { getDb } from "@/server/db";
import { requireDealAccess } from "@/server/session";

export async function POST(_request: Request, ctx: RouteContext<"/api/deals/[dealId]/send">) {
  const { dealId } = await ctx.params;
  const access = await requireDealAccess(dealId);
  if (!access.ok) return access.response;

  const db = getDb();
  const hasMilestones = exists(
    db
      .select({ one: sql`1` })
      .from(schema.milestone)
      .where(eq(schema.milestone.dealId, schema.deal.id)),
  );
  const portalUrl = await db.transaction(async (tx) => {
    const [sent] = await tx
      .update(schema.deal)
      .set({ status: "sent", updatedAt: new Date() })
      .where(and(eq(schema.deal.id, dealId), eq(schema.deal.status, "draft"), hasMilestones))
      .returning({ clientId: schema.deal.clientId });
    if (!sent) return null;
    const { url } = await createMagicLink(tx, { clientId: sent.clientId, dealId });
    await tx.insert(schema.event).values({
      dealId,
      type: "deal.plan_sent",
      payload: { clientId: sent.clientId },
    });
    return url;
  });
  if (portalUrl) return Response.json({ portalUrl });

  const [deal] = await db
    .select({ status: schema.deal.status, hasMilestones })
    .from(schema.deal)
    .where(eq(schema.deal.id, dealId));
  const error =
    deal?.status === "draft" && !deal.hasMilestones
      ? "plan_has_no_milestones"
      : "Only a draft plan can be sent";
  return Response.json({ error }, { status: 409 });
}

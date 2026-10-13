import { createMagicLink, schema } from "@tranche/db";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/server/db";
import { requireDealAccess } from "@/server/session";

export async function POST(_request: Request, ctx: RouteContext<"/api/deals/[dealId]/send">) {
  const { dealId } = await ctx.params;
  const access = await requireDealAccess(dealId);
  if (!access.ok) return access.response;

  const portalUrl = await getDb().transaction(async (tx) => {
    const [sent] = await tx
      .update(schema.deal)
      .set({ status: "sent", updatedAt: new Date() })
      .where(and(eq(schema.deal.id, dealId), eq(schema.deal.status, "draft")))
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
  if (!portalUrl) {
    return Response.json({ error: "Only a draft plan can be sent" }, { status: 409 });
  }
  return Response.json({ portalUrl });
}

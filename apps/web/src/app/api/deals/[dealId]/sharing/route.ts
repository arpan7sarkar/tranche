import { getDb } from "@/server/db";
import { createPlanShareLink, getPlanSharing } from "@/server/plan-sharing";
import { requireDealAccess } from "@/server/session";

export async function GET(_request: Request, ctx: RouteContext<"/api/deals/[dealId]/sharing">) {
  const { dealId } = await ctx.params;
  const access = await requireDealAccess(dealId);
  if (!access.ok) return access.response;
  return Response.json(await getPlanSharing(getDb(), dealId), {
    headers: { "Cache-Control": "private, no-store" },
  });
}

export async function POST(_request: Request, ctx: RouteContext<"/api/deals/[dealId]/sharing">) {
  const { dealId } = await ctx.params;
  const access = await requireDealAccess(dealId);
  if (!access.ok) return access.response;
  const portalUrl = await createPlanShareLink(getDb(), dealId);
  if (!portalUrl)
    return Response.json(
      { error: "Send the plan before creating a client link." },
      { status: 409 },
    );
  return Response.json({ portalUrl }, { headers: { "Cache-Control": "private, no-store" } });
}

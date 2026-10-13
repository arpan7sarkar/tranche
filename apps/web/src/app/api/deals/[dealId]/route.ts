import { getDb } from "@/server/db";
import { getDealView } from "@/server/deals";
import { memberOrNull } from "@/server/session";

export async function GET(request: Request, ctx: RouteContext<"/api/deals/[dealId]">) {
  const member = await memberOrNull(request);
  if (!member) return Response.json({ error: "unauthorized" }, { status: 401 });
  const { dealId } = await ctx.params;
  const view = await getDealView(getDb(), dealId, { workspaceId: member.workspaceId });
  if (!view) return Response.json({ error: "not_found" }, { status: 404 });
  return Response.json(view);
}

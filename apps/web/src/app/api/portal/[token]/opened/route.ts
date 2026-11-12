import { getDb } from "@/server/db";
import { recordPortalOpened } from "@/server/plan-sharing";
import { resolvePortalToken } from "@/server/portal";

export async function POST(_request: Request, ctx: RouteContext<"/api/portal/[token]/opened">) {
  const { token } = await ctx.params;
  const link = await resolvePortalToken(token);
  if (!link) return Response.json({ error: "invalid_link" }, { status: 404 });
  await recordPortalOpened(getDb(), link.dealId);
  return new Response(null, { status: 204 });
}

import { getDb } from "@/server/db";
import { resolvePortalToken, submitClientRelease } from "@/server/portal";

export async function POST(
  _request: Request,
  ctx: RouteContext<"/api/portal/[token]/milestones/[milestoneId]/release">,
) {
  const { token, milestoneId } = await ctx.params;
  const link = await resolvePortalToken(token);
  if (!link) return Response.json({ error: "invalid_link" }, { status: 404 });
  const result = await submitClientRelease(getDb(), { dealId: link.dealId, milestoneId });
  return Response.json({ result }, { status: result === "not_releasable" ? 409 : 200 });
}

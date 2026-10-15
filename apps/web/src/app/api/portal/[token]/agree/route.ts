import { getDb } from "@/server/db";
import { agreeFromPortal, resolvePortalToken } from "@/server/portal";

export async function POST(_request: Request, ctx: RouteContext<"/api/portal/[token]/agree">) {
  const { token } = await ctx.params;
  const link = await resolvePortalToken(token);
  if (!link) return Response.json({ error: "invalid_link" }, { status: 404 });
  const result = await agreeFromPortal(getDb(), link.dealId);
  return Response.json({ result }, { status: result === "not_agreeable" ? 409 : 200 });
}

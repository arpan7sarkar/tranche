import { evidenceImageResponse } from "@/server/evidence-images";
import { resolvePortalToken } from "@/server/portal";
export async function GET(
  _request: Request,
  ctx: { params: Promise<{ token: string; id: string }> },
) {
  const { token, id } = await ctx.params;
  const link = await resolvePortalToken(token);
  if (!link) return new Response(null, { status: 404 });
  return evidenceImageResponse(id, { clientId: link.clientId }, link.dealId);
}

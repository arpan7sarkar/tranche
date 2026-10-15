import { z } from "zod";
import { getDb } from "@/server/db";
import { resolvePortalToken, setAutoRelease } from "@/server/portal";

const Body = z.object({
  autoReleaseAfterHours: z.union([z.literal(24), z.literal(72), z.literal(168), z.null()]),
});

export async function PATCH(request: Request, ctx: RouteContext<"/api/portal/[token]/policy">) {
  const { token } = await ctx.params;
  const link = await resolvePortalToken(token);
  if (!link) return Response.json({ error: "invalid_link" }, { status: 404 });
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid_body" }, { status: 400 });
  const policy = await setAutoRelease(getDb(), {
    dealId: link.dealId,
    hours: parsed.data.autoReleaseAfterHours,
  });
  return Response.json({ policy });
}

import { z } from "zod";
import { getDb } from "@/server/db";
import { withWebMoneyGate } from "@/server/money-gate";
import { agreeFromPortal, resolvePortalToken } from "@/server/portal";

const Body = z.object({ planVersion: z.string().min(1).max(64) });

export const POST = withWebMoneyGate(async function POST(
  request: Request,
  ctx: RouteContext<"/api/portal/[token]/agree">,
) {
  const { token } = await ctx.params;
  const link = await resolvePortalToken(token);
  if (!link) return Response.json({ error: "invalid_link" }, { status: 404 });
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid_body" }, { status: 400 });
  const result = await agreeFromPortal(getDb(), {
    dealId: link.dealId,
    planVersion: parsed.data.planVersion,
  });
  if (result === "plan_changed") {
    return Response.json(
      { result, error: "The plan changed since you opened it. Reload to review it." },
      { status: 409 },
    );
  }
  return Response.json({ result }, { status: result === "not_agreeable" ? 409 : 200 });
});

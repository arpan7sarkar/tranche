import { z } from "zod";
import { decideApproval } from "@/server/approvals";
import { getDb } from "@/server/db";
import { withWebMoneyGate } from "@/server/money-gate";
import { resolvePortalToken } from "@/server/portal";

const Body = z.object({ decision: z.enum(["approved", "rejected"]) });

export const POST = withWebMoneyGate(async function POST(
  request: Request,
  ctx: RouteContext<"/api/portal/[token]/approvals/[id]/decide">,
) {
  const { token, id } = await ctx.params;
  const link = await resolvePortalToken(token);
  if (!link) return Response.json({ error: "invalid_link" }, { status: 404 });
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid_body" }, { status: 400 });
  const result = await decideApproval(getDb(), {
    approvalId: id,
    decision: parsed.data.decision,
    decider: { side: "client", dealId: link.dealId, clientId: link.clientId },
  });
  const status = result === "decided" ? 200 : result === "already_decided" ? 409 : 404;
  return Response.json({ result }, { status });
});

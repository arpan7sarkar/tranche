import { z } from "zod";
import { decideApproval } from "@/server/approvals";
import { getDb } from "@/server/db";
import { memberOrNull } from "@/server/session";

const Body = z.object({ decision: z.enum(["approved", "rejected"]) });

export async function POST(request: Request, ctx: RouteContext<"/api/approvals/[id]/decide">) {
  const member = await memberOrNull(request);
  if (!member) return Response.json({ error: "unauthorized" }, { status: 401 });
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid_body" }, { status: 400 });
  const { id } = await ctx.params;
  const result = await decideApproval(getDb(), {
    approvalId: id,
    decision: parsed.data.decision,
    decider: { side: "agency", workspaceId: member.workspaceId, userId: member.userId },
  });
  const status = result === "decided" ? 200 : result === "already_decided" ? 409 : 404;
  return Response.json({ result }, { status });
}

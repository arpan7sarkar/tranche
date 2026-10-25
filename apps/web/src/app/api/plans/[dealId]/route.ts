import { Id, PlanDraft } from "@tranche/contracts";
import { z } from "zod";
import { getDb } from "@/server/db";
import { draftStatus, saveDraft } from "@/server/plans";
import { memberOrNull } from "@/server/session";

type Context = { params: Promise<{ dealId: string }> };
export async function GET(request: Request, ctx: Context) {
  const member = await memberOrNull(request);
  if (!member) return Response.json({ error: "Sign in first" }, { status: 401 });
  const { dealId } = await ctx.params;
  if (!Id.safeParse(dealId).success) return Response.json({ error: "Not found" }, { status: 404 });
  const status = await draftStatus(getDb(), member.workspaceId, dealId);
  return status ? Response.json(status) : Response.json({ error: "Not found" }, { status: 404 });
}
export async function PUT(request: Request, ctx: Context) {
  const member = await memberOrNull(request);
  if (!member) return Response.json({ error: "Sign in first" }, { status: 401 });
  const { dealId } = await ctx.params;
  if (!Id.safeParse(dealId).success) return Response.json({ error: "Not found" }, { status: 404 });
  const parsed = z
    .object({ proposalId: Id, plan: PlanDraft })
    .safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return Response.json({ error: "Invalid plan", issues: parsed.error.issues }, { status: 422 });
  try {
    await saveDraft(getDb(), member.workspaceId, dealId, parsed.data.proposalId, parsed.data.plan);
    return Response.json({ saved: true });
  } catch (error) {
    if (error instanceof Error && /^(draft_|invalid_plan)/.test(error.message))
      return Response.json({ error: error.message }, { status: 409 });
    throw error;
  }
}

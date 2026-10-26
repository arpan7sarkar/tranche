import { Id } from "@tranche/contracts";
import { getDb } from "@/server/db";
import { loadNegotiationView } from "@/server/negotiations";
import { memberOrNull } from "@/server/session";

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const member = await memberOrNull(request);
  if (!member) return Response.json({ error: "Sign in first" }, { status: 401 });
  const id = Id.safeParse((await ctx.params).id);
  if (!id.success) return Response.json({ error: "Invalid negotiation" }, { status: 422 });
  const view = await loadNegotiationView(getDb(), member.workspaceId, id.data);
  return view
    ? Response.json(view, { headers: { "Cache-Control": "private, no-store" } })
    : Response.json({ error: "Not found" }, { status: 404 });
}

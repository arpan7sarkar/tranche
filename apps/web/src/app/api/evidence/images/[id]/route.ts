import { evidenceImageResponse } from "@/server/evidence-images";
import { memberOrNull } from "@/server/session";
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const member = await memberOrNull(request);
  if (!member) return new Response(null, { status: 401 });
  return evidenceImageResponse((await ctx.params).id, { workspaceId: member.workspaceId });
}

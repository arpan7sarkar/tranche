import { DraftRequest } from "@tranche/contracts";
import { getDb } from "@/server/db";
import { createDraftDeal } from "@/server/plans";
import { memberOrNull } from "@/server/session";

export async function POST(request: Request) {
  const member = await memberOrNull(request);
  if (!member) return Response.json({ error: "Sign in first" }, { status: 401 });
  const parsed = DraftRequest.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return Response.json(
      { error: "Check the brief, dates, email and staging URL", issues: parsed.error.issues },
      { status: 422 },
    );
  try {
    return Response.json(await createDraftDeal(getDb(), member.workspaceId, parsed.data), {
      status: 202,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "repository_not_connected")
      return Response.json(
        { error: "Connect this repository to your workspace before using it in a plan." },
        { status: 422 },
      );
    if (error instanceof Error && error.message === "draft_request_conflict")
      return Response.json({ error: error.message }, { status: 409 });
    throw error;
  }
}

import { Id, StartNegotiationInput } from "@tranche/contracts";
import { after } from "next/server";
import { getDb } from "@/server/db";
import { kickNegotiation, latestNegotiation, startNegotiation } from "@/server/negotiations";
import { memberOrNull } from "@/server/session";

export async function POST(request: Request) {
  const member = await memberOrNull(request);
  if (!member) return Response.json({ error: "Sign in first" }, { status: 401 });
  const input = StartNegotiationInput.safeParse(await request.json().catch(() => null));
  if (!input.success)
    return Response.json({ error: "Check the budget, deadline and round limit." }, { status: 422 });
  const result = await startNegotiation(getDb(), member.workspaceId, input.data);
  if (!result.ok)
    return Response.json(
      { error: result.error },
      { status: result.error === "not_found" ? 404 : 409 },
    );
  after(() => kickNegotiation(result.negotiationId));
  return Response.json(result, { status: 202 });
}
export async function GET(request: Request) {
  const member = await memberOrNull(request);
  if (!member) return Response.json({ error: "Sign in first" }, { status: 401 });
  const id = Id.safeParse(new URL(request.url).searchParams.get("dealId"));
  if (!id.success) return Response.json({ error: "Invalid deal" }, { status: 422 });
  return Response.json(
    { negotiationId: await latestNegotiation(getDb(), member.workspaceId, id.data) },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

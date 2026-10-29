import { loadDashboardData } from "@tranche/agents";
import { getDb } from "@/server/db";
import { memberOrNull } from "@/server/session";

export async function GET(request: Request) {
  const member = await memberOrNull(request);
  if (!member) return Response.json({ error: "unauthorized" }, { status: 401 });
  try {
    const data = await loadDashboardData(
      getDb(),
      member.workspaceId,
      new URL(request.url).searchParams.get("currency") ?? undefined,
    );
    return Response.json(data, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const invalid = error instanceof Error && error.message === "invalid_dashboard_currency";
    return Response.json(
      { error: invalid ? "invalid_currency" : "dashboard_unavailable" },
      { status: invalid ? 400 : 503 },
    );
  }
}

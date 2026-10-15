import { applyReschedule, RescheduleError } from "@tranche/agents-service/money";
import { z } from "zod";
import { getDb } from "@/server/db";
import { requireDealAccess } from "@/server/session";

const Body = z.object({ taskId: z.uuid(), start: z.iso.date() });

export async function POST(
  request: Request,
  ctx: RouteContext<"/api/deals/[dealId]/tasks/reschedule">,
) {
  const { dealId } = await ctx.params;
  const access = await requireDealAccess(dealId);
  if (!access.ok) return access.response;

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid body" }, { status: 400 });

  try {
    const result = await getDb().transaction((tx) =>
      applyReschedule(tx, dealId, [parsed.data], "Moved on the Gantt", new Date()),
    );
    return Response.json(result);
  } catch (err) {
    if (err instanceof RescheduleError)
      return Response.json({ error: err.message }, { status: 422 });
    throw err;
  }
}

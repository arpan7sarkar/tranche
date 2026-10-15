import type { InboxMessage, MilestoneState } from "@tranche/contracts";
import { schema } from "@tranche/db";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { isUuid } from "@/lib/uuid";
import { getDb } from "@/server/db";
import { kickMoneyTick } from "@/server/kick";
import { requireDealAccess } from "@/server/session";

const DELIVERABLE: ReadonlySet<MilestoneState> = new Set([
  "held",
  "in_progress",
  "changes_requested",
]);

const Body = z.object({
  url: z.url({ protocol: /^https?$/ }),
  notes: z
    .string()
    .trim()
    .max(2000)
    .optional()
    .transform((v) => v || undefined),
});

export async function POST(
  request: Request,
  ctx: RouteContext<"/api/deals/[dealId]/milestones/[milestoneId]/deliveries">,
) {
  const { dealId, milestoneId } = await ctx.params;
  const access = await requireDealAccess(dealId);
  if (!access.ok) return access.response;
  if (!isUuid(milestoneId)) return Response.json({ error: "not_found" }, { status: 404 });

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Enter a full http or https URL." }, { status: 400 });
  }

  const db = getDb();
  const [milestone] = await db
    .select({ state: schema.milestone.state, version: schema.milestone.version })
    .from(schema.milestone)
    .where(and(eq(schema.milestone.id, milestoneId), eq(schema.milestone.dealId, dealId)));
  if (!milestone) return Response.json({ error: "not_found" }, { status: 404 });
  if (!DELIVERABLE.has(milestone.state)) {
    return Response.json(
      {
        error: `This milestone is ${milestone.state.replaceAll("_", " ")} and cannot take a delivery.`,
      },
      { status: 409 },
    );
  }

  const message: InboxMessage = {
    type: "delivery.detected",
    milestoneId,
    source: "manual",
    repo: null,
    sha: null,
    prNumber: null,
    urls: [parsed.data.url],
    notes: parsed.data.notes,
  };
  // Every state change bumps the version, so a double submit collapses into one row while a
  // resubmission after changes_requested gets its own.
  const inserted = await db
    .insert(schema.inbox)
    .values({
      source: "user",
      sourceEventId: `manual:${milestoneId}:${milestone.version}`,
      message,
    })
    .onConflictDoNothing()
    .returning({ id: schema.inbox.id });
  kickMoneyTick();
  return Response.json(
    { status: inserted.length > 0 ? "submitted" : "already_submitted" },
    { status: 202 },
  );
}

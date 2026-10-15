import { isDeepStrictEqual } from "node:util";
import type { InboxMessage, MilestoneState } from "@tranche/contracts";
import { schema } from "@tranche/db";
import { and, eq, gt, isNull } from "drizzle-orm";
import { z } from "zod";
import { needsPullRequest } from "@/lib/criteria";
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

const accepted = (status: "submitted" | "resubmitted" | "already_submitted") => {
  kickMoneyTick();
  return Response.json({ status }, { status: 202 });
};

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
    .select({
      state: schema.milestone.state,
      version: schema.milestone.version,
      criteria: schema.milestone.criteria,
    })
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
  if (needsPullRequest(milestone.criteria)) {
    return Response.json({ error: "This milestone needs a merged pull request" }, { status: 409 });
  }

  const { url, notes } = parsed.data;
  const message: InboxMessage = {
    type: "delivery.detected",
    milestoneId,
    source: "manual",
    repo: null,
    sha: null,
    prNumber: null,
    urls: [url],
    ...(notes ? { notes } : {}),
  };
  // Every state change bumps the version, so a double submit collapses into one row while a
  // resubmission after changes_requested gets its own.
  const key = and(
    eq(schema.inbox.source, "user"),
    eq(schema.inbox.sourceEventId, `manual:${milestoneId}:${milestone.version}`),
  );
  const inserted = await db
    .insert(schema.inbox)
    .values({
      source: "user",
      sourceEventId: `manual:${milestoneId}:${milestone.version}`,
      message,
    })
    .onConflictDoNothing()
    .returning({ id: schema.inbox.id });
  if (inserted.length > 0) return accepted("submitted");

  // A row that already failed is re-armed with the new submission instead of blocking it.
  const rearmed = await db
    .update(schema.inbox)
    .set({ message, attempts: 0, lastError: null, nextAttemptAt: new Date() })
    .where(and(key, isNull(schema.inbox.processedAt), gt(schema.inbox.attempts, 0)))
    .returning({ id: schema.inbox.id });
  if (rearmed.length > 0) return accepted("resubmitted");

  const [existing] = await db
    .select({ message: schema.inbox.message })
    .from(schema.inbox)
    .where(key);
  if (existing && isDeepStrictEqual(existing.message, message)) {
    return accepted("already_submitted");
  }
  return Response.json(
    { error: "A different delivery is already being verified" },
    { status: 409 },
  );
}

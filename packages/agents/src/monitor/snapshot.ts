import { type Db, schema } from "@tranche/db";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { MonitorSnapshot } from "./detectors";

const WATCHED = ["held", "in_progress", "changes_requested", "release_pending"] as const;

export async function loadSnapshot(
  db: Db,
  opts: { dealId?: string } = {},
): Promise<MonitorSnapshot> {
  const scope = and(
    inArray(schema.deal.status, ["sent", "negotiating", "agreed", "active"]),
    opts.dealId ? eq(schema.deal.id, opts.dealId) : undefined,
  );

  const milestones = await db
    .select({
      id: schema.milestone.id,
      dealId: schema.milestone.dealId,
      dealTitle: schema.deal.title,
      title: schema.milestone.title,
      state: schema.milestone.state,
      priceMinor: schema.milestone.priceMinor,
      currency: schema.deal.currency,
      pendingSince: sql<Date | null>`(
        select max(e.created_at) from ${schema.event} e
        where e.milestone_id = ${schema.milestone.id} and e.type = 'milestone.release_pending'
      )`.mapWith((v: string | null) => (v ? new Date(v) : null)),
    })
    .from(schema.milestone)
    .innerJoin(schema.deal, eq(schema.deal.id, schema.milestone.dealId))
    .where(and(inArray(schema.milestone.state, [...WATCHED]), scope));

  const milestoneIds = milestones.map((m) => m.id);
  const tasks =
    milestoneIds.length === 0
      ? []
      : await db
          .select({
            id: schema.task.id,
            dealId: schema.task.dealId,
            milestoneId: schema.task.milestoneId,
            title: schema.task.title,
            startDate: schema.task.startDate,
            durationDays: schema.task.durationDays,
          })
          .from(schema.task)
          .where(inArray(schema.task.milestoneId, milestoneIds));

  const holds = await db
    .select({
      milestoneId: schema.hold.milestoneId,
      dealId: schema.milestone.dealId,
      status: schema.hold.status,
      expiresAt: schema.hold.expiresAt,
    })
    .from(schema.hold)
    .innerJoin(schema.milestone, eq(schema.milestone.id, schema.hold.milestoneId))
    .innerJoin(schema.deal, eq(schema.deal.id, schema.milestone.dealId))
    .where(
      and(
        eq(schema.hold.status, "active"),
        inArray(schema.milestone.state, [...WATCHED, "delivered", "verifying"]),
        scope,
      ),
    );

  const clientApprovals = await db
    .select({
      approvalId: schema.approval.id,
      dealId: schema.proposedAction.dealId,
      createdAt: schema.approval.createdAt,
    })
    .from(schema.approval)
    .innerJoin(
      schema.proposedAction,
      eq(schema.proposedAction.id, schema.approval.proposedActionId),
    )
    .innerJoin(schema.deal, eq(schema.deal.id, schema.proposedAction.dealId))
    .where(
      and(
        eq(schema.approval.side, "client"),
        eq(schema.proposedAction.status, "needs_approval"),
        isNull(schema.approval.decision),
        scope,
      ),
    );

  return { milestones, tasks, holds, clientApprovals };
}

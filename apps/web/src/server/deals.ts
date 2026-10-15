import "server-only";
import type {
  AcceptanceCriteria,
  ActionPayload,
  ActionType,
  DealStatus,
  DomainEventType,
  EvidenceKind,
  HoldStatus,
  MilestoneState,
  Money,
  Policy,
} from "@tranche/contracts";
import { type Db, schema } from "@tranche/db";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { isUuid } from "@/lib/uuid";

export type DealScope = { workspaceId: string } | { clientId: string };

export type DealView = {
  deal: {
    id: string;
    title: string;
    status: DealStatus;
    currency: string;
    agencyName: string;
    clientName: string;
    clientEmail: string;
    clientPolicy: Policy | null;
  };
  milestones: Array<{
    id: string;
    key: string;
    title: string;
    position: number;
    priceMinor: number;
    state: MilestoneState;
    startDate: string | null;
    endDate: string | null;
    criteria: AcceptanceCriteria;
    hold: { status: HoldStatus; expiresAt: string; pendingReview: boolean } | null;
    fundDueAt?: string | null;
    evidence: Array<{
      id: string;
      kind: EvidenceKind;
      checkIndex: number | null;
      passed: boolean | null;
      summary: string;
      data: Record<string, unknown>;
      createdAt: string;
    }>;
  }>;
  tasks: Array<{
    id: string;
    milestoneId: string;
    key: string;
    title: string;
    durationDays: number;
    startDate: string;
  }>;
  dependencies: Array<{ fromTaskId: string; toTaskId: string }>;
  activity: Array<{
    id: number;
    type: DomainEventType;
    payload: Record<string, unknown>;
    createdAt: string;
  }>;
  approvals: Array<{
    id: string;
    side: "agency" | "client";
    actionType: ActionType;
    agent: string;
    reasoning: string;
    payload: ActionPayload;
    createdAt: string;
  }>;
};

export async function getDealView(
  db: Db,
  dealId: string,
  scope: DealScope,
): Promise<DealView | null> {
  const scopeId = "workspaceId" in scope ? scope.workspaceId : scope.clientId;
  if (!isUuid(dealId) || !isUuid(scopeId)) return null;
  const scopeFilter =
    "workspaceId" in scope
      ? eq(schema.deal.workspaceId, scope.workspaceId)
      : eq(schema.deal.clientId, scope.clientId);
  const [row] = await db
    .select({
      deal: schema.deal,
      agencyName: schema.workspace.name,
      clientName: schema.client.name,
      clientEmail: schema.client.email,
    })
    .from(schema.deal)
    .innerJoin(schema.client, eq(schema.client.id, schema.deal.clientId))
    .innerJoin(schema.workspace, eq(schema.workspace.id, schema.deal.workspaceId))
    .where(and(eq(schema.deal.id, dealId), scopeFilter));
  if (!row) return null;

  const milestones = await db
    .select()
    .from(schema.milestone)
    .where(eq(schema.milestone.dealId, dealId))
    .orderBy(asc(schema.milestone.position));
  const milestoneIds = milestones.map((m) => m.id);
  const [tasks, holds, evidence, activity, approvals, funding] = await Promise.all([
    db
      .select()
      .from(schema.task)
      .where(eq(schema.task.dealId, dealId))
      .orderBy(asc(schema.task.position)),
    milestoneIds.length
      ? db
          .select()
          .from(schema.hold)
          .where(inArray(schema.hold.milestoneId, milestoneIds))
          .orderBy(desc(schema.hold.createdAt))
      : [],
    milestoneIds.length
      ? db
          .select()
          .from(schema.evidence)
          .where(inArray(schema.evidence.milestoneId, milestoneIds))
          .orderBy(desc(schema.evidence.createdAt))
      : [],
    db
      .select()
      .from(schema.event)
      .where(eq(schema.event.dealId, dealId))
      .orderBy(desc(schema.event.id))
      .limit(50),
    db
      .select({ approval: schema.approval, action: schema.proposedAction })
      .from(schema.approval)
      .innerJoin(
        schema.proposedAction,
        eq(schema.proposedAction.id, schema.approval.proposedActionId),
      )
      .where(
        and(
          eq(schema.proposedAction.dealId, dealId),
          isNull(schema.approval.decision),
          "clientId" in scope ? eq(schema.approval.side, "client") : undefined,
        ),
      )
      .orderBy(asc(schema.approval.createdAt)),
    milestoneIds.length
      ? db
          .select({
            milestoneId: schema.scheduledAction.milestoneId,
            dueAt: schema.scheduledAction.dueAt,
          })
          .from(schema.scheduledAction)
          .where(
            and(
              inArray(schema.scheduledAction.milestoneId, milestoneIds),
              eq(schema.scheduledAction.kind, "fund"),
              eq(schema.scheduledAction.status, "pending"),
            ),
          )
          .orderBy(asc(schema.scheduledAction.dueAt))
      : [],
  ]);
  const taskIds = tasks.map((t) => t.id);
  const dependencies = taskIds.length
    ? await db
        .select()
        .from(schema.taskDependency)
        .where(inArray(schema.taskDependency.toTaskId, taskIds))
    : [];

  return {
    deal: {
      id: row.deal.id,
      title: row.deal.title,
      status: row.deal.status,
      currency: row.deal.currency,
      agencyName: row.agencyName,
      clientName: row.clientName,
      clientEmail: row.clientEmail,
      clientPolicy: row.deal.clientPolicy,
    },
    milestones: milestones.map((m) => {
      const hold = holds.find((h) => h.milestoneId === m.id);
      return {
        id: m.id,
        key: m.key,
        title: m.title,
        position: m.position,
        priceMinor: m.priceMinor,
        state: m.state,
        startDate: m.startDate,
        endDate: m.endDate,
        criteria: m.criteria,
        hold: hold
          ? {
              status: hold.status,
              expiresAt: hold.expiresAt.toISOString(),
              pendingReview:
                hold.status === "pending" &&
                Boolean(hold.paypalCaptureId ?? hold.paypalAuthorizationId),
            }
          : null,
        fundDueAt: funding.find((f) => f.milestoneId === m.id)?.dueAt.toISOString() ?? null,
        evidence: evidence
          .filter((e) => e.milestoneId === m.id)
          .map((e) => ({
            id: e.id,
            kind: e.kind,
            checkIndex: e.checkIndex,
            passed: e.passed,
            summary: e.summary,
            data: e.data,
            createdAt: e.createdAt.toISOString(),
          })),
      };
    }),
    tasks: tasks.map((t) => ({
      id: t.id,
      milestoneId: t.milestoneId,
      key: t.key,
      title: t.title,
      durationDays: t.durationDays,
      startDate: t.startDate,
    })),
    dependencies: dependencies.map((d) => ({ fromTaskId: d.fromTaskId, toTaskId: d.toTaskId })),
    activity: activity.map((e) => ({
      id: e.id,
      type: e.type,
      payload: e.payload,
      createdAt: e.createdAt.toISOString(),
    })),
    approvals: approvals.map(({ approval, action }) => ({
      id: approval.id,
      side: approval.side,
      actionType: action.type,
      agent: action.agent,
      reasoning: action.reasoning,
      payload: action.payload,
      createdAt: approval.createdAt.toISOString(),
    })),
  };
}

export async function listDeals(db: Db, workspaceId: string) {
  const rows = await db
    .select({
      id: schema.deal.id,
      title: schema.deal.title,
      status: schema.deal.status,
      currency: schema.deal.currency,
      clientName: schema.client.name,
      totalMinor: sql<number>`coalesce(sum(${schema.milestone.priceMinor}), 0)::bigint`.mapWith(
        Number,
      ),
    })
    .from(schema.deal)
    .innerJoin(schema.client, eq(schema.client.id, schema.deal.clientId))
    .leftJoin(schema.milestone, eq(schema.milestone.dealId, schema.deal.id))
    .where(eq(schema.deal.workspaceId, workspaceId))
    .groupBy(schema.deal.id, schema.client.name)
    .orderBy(desc(schema.deal.updatedAt));
  return rows.map(({ totalMinor, currency, ...r }) => ({
    ...r,
    total: { currency, minor: totalMinor } satisfies Money,
  }));
}

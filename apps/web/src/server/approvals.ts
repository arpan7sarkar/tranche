import "server-only";
import { decideApproval as decideUnscoped } from "@tranche/agents-service/money";
import { type Db, schema } from "@tranche/db";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { isUuid } from "@/lib/uuid";
import type { DealView } from "./deals";

export type DecideResult = "decided" | "already_decided" | "not_found";

export type PendingApproval = DealView["approvals"][number] & {
  dealId: string;
  dealTitle: string;
  milestoneTitle: string | null;
};

export async function decideApproval(
  db: Db,
  input: {
    approvalId: string;
    side: "agency" | "client";
    scope: { workspaceId: string } | { dealId: string };
    decidedBy: string;
    decision: "approved" | "rejected";
  },
): Promise<DecideResult> {
  if (!isUuid(input.approvalId)) return "not_found";
  const inScope =
    "workspaceId" in input.scope
      ? eq(schema.deal.workspaceId, input.scope.workspaceId)
      : eq(schema.deal.id, input.scope.dealId);
  const [row] = await db
    .select({ decision: schema.approval.decision })
    .from(schema.approval)
    .innerJoin(
      schema.proposedAction,
      eq(schema.proposedAction.id, schema.approval.proposedActionId),
    )
    .innerJoin(schema.deal, eq(schema.deal.id, schema.proposedAction.dealId))
    .where(
      and(eq(schema.approval.id, input.approvalId), eq(schema.approval.side, input.side), inScope),
    );
  if (!row) return "not_found";
  if (row.decision) return "already_decided";

  await decideUnscoped(db, {
    approvalId: input.approvalId,
    decision: input.decision,
    decidedBy: input.decidedBy,
  });
  // A concurrent decision can win between the check above and the locked write in H3.
  const [after] = await db
    .select({ decision: schema.approval.decision, decidedBy: schema.approval.decidedBy })
    .from(schema.approval)
    .where(eq(schema.approval.id, input.approvalId));
  return after?.decision === input.decision && after.decidedBy === input.decidedBy
    ? "decided"
    : "already_decided";
}

export async function listPendingApprovals(
  db: Db,
  workspaceId: string,
): Promise<PendingApproval[]> {
  const rows = await db
    .select({
      approval: schema.approval,
      action: schema.proposedAction,
      dealTitle: schema.deal.title,
      milestoneTitle: schema.milestone.title,
    })
    .from(schema.approval)
    .innerJoin(
      schema.proposedAction,
      eq(schema.proposedAction.id, schema.approval.proposedActionId),
    )
    .innerJoin(schema.deal, eq(schema.deal.id, schema.proposedAction.dealId))
    .leftJoin(
      schema.milestone,
      sql`${schema.milestone.id}::text = ${schema.proposedAction.payload}->>'milestoneId'`,
    )
    .where(
      and(
        eq(schema.deal.workspaceId, workspaceId),
        eq(schema.approval.side, "agency"),
        isNull(schema.approval.decision),
      ),
    )
    .orderBy(asc(schema.approval.createdAt));
  return rows.map(({ approval, action, dealTitle, milestoneTitle }) => ({
    id: approval.id,
    side: approval.side,
    actionType: action.type,
    agent: action.agent,
    reasoning: action.reasoning,
    payload: action.payload,
    createdAt: approval.createdAt.toISOString(),
    dealId: action.dealId,
    dealTitle,
    milestoneTitle,
  }));
}

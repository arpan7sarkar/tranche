import "server-only";
import { decideApproval as recordDecision } from "@tranche/agents-service/money";
import { type Db, schema } from "@tranche/db";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { isUuid } from "@/lib/uuid";
import type { DealView } from "./deals";
import { requireWebMoneyEnabled } from "./money-gate";

export type DecideResult = "decided" | "already_decided" | "not_found";

export type PendingApproval = DealView["approvals"][number] & {
  dealId: string;
  dealTitle: string;
  milestoneTitle: string | null;
};

export type Decider = Parameters<typeof recordDecision>[1]["decider"];

export async function decideApproval(
  db: Db,
  input: { approvalId: string; decision: "approved" | "rejected"; decider: Decider },
): Promise<DecideResult> {
  const { decider } = input;
  if (!isUuid(input.approvalId)) return "not_found";
  // H3 enforces the same side and scope; checking first lets us answer 404 and 409 precisely.
  const inScope =
    decider.side === "agency"
      ? eq(schema.deal.workspaceId, decider.workspaceId)
      : eq(schema.deal.id, decider.dealId);
  const [row] = await db
    .select({ decision: schema.approval.decision })
    .from(schema.approval)
    .innerJoin(
      schema.proposedAction,
      eq(schema.proposedAction.id, schema.approval.proposedActionId),
    )
    .innerJoin(schema.deal, eq(schema.deal.id, schema.proposedAction.dealId))
    .where(
      and(
        eq(schema.approval.id, input.approvalId),
        eq(schema.approval.side, decider.side),
        inScope,
      ),
    );
  if (!row) return "not_found";
  if (row.decision) return "already_decided";
  if (input.decision === "approved") requireWebMoneyEnabled();

  await recordDecision(db, input);
  // A concurrent decision can win between the check above and H3's locked write.
  const [after] = await db
    .select({ decision: schema.approval.decision })
    .from(schema.approval)
    .where(eq(schema.approval.id, input.approvalId));
  return after?.decision === input.decision ? "decided" : "already_decided";
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
      and(
        eq(schema.milestone.dealId, schema.deal.id),
        sql`${schema.milestone.id}::text = ${schema.proposedAction.payload}->>'milestoneId'`,
      ),
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

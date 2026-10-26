import "server-only";
import { createHash } from "node:crypto";
import { writePlan } from "@tranche/agents-service/money";
import { DraftRequest, PlanDraft, PlanningOptions } from "@tranche/contracts";
import { plannerIssues } from "@tranche/core";
import { type Db, schema } from "@tranche/db";
import { repositoryAllowed } from "@tranche/verifiers";
import { and, desc, eq, inArray, sql } from "drizzle-orm";

export async function createDraftDeal(db: Db, workspaceId: string, raw: DraftRequest) {
  const input = DraftRequest.parse(raw);
  if (input.repo && !repositoryAllowed(workspaceId, input.repo))
    throw new Error("repository_not_connected");
  const fingerprint = createHash("sha256").update(JSON.stringify(input)).digest("hex");
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`draft:${workspaceId}:${input.requestId}`}, 0))`,
    );
    const [prior] = await tx
      .select()
      .from(schema.event)
      .where(
        and(
          eq(schema.event.type, "deal.created"),
          sql`${schema.event.payload}->>'requestId' = ${input.requestId}`,
          sql`${schema.event.payload}->>'workspaceId' = ${workspaceId}`,
        ),
      )
      .limit(1);
    if (prior) {
      if (prior.payload.fingerprint !== fingerprint) throw new Error("draft_request_conflict");
      if (!prior.dealId) throw new Error("draft_event_missing_deal");
      return { dealId: prior.dealId };
    }
    const [ws] = await tx
      .select()
      .from(schema.workspace)
      .where(eq(schema.workspace.id, workspaceId));
    if (!ws) throw new Error("workspace_not_found");
    const [client] = await tx
      .insert(schema.client)
      .values({ workspaceId, name: input.clientName, email: input.clientEmail })
      .returning();
    if (!client) throw new Error("client_insert_failed");
    const [deal] = await tx
      .insert(schema.deal)
      .values({
        workspaceId,
        clientId: client.id,
        title: input.title,
        brief: input.brief,
        currency: ws.rateCard.currency,
      })
      .returning();
    if (!deal) throw new Error("deal_insert_failed");
    await tx.insert(schema.event).values({
      type: "deal.created",
      dealId: deal.id,
      payload: {
        requestId: input.requestId,
        workspaceId,
        fingerprint,
        planning: { dealId: deal.id, ...PlanningOptions.parse(input) },
      },
    });
    return { dealId: deal.id };
  });
}

export async function draftStatus(db: Db, workspaceId: string, dealId: string) {
  const [deal] = await db
    .select()
    .from(schema.deal)
    .where(and(eq(schema.deal.id, dealId), eq(schema.deal.workspaceId, workspaceId)));
  if (!deal) return null;
  const [proposal] = await db
    .select()
    .from(schema.proposedAction)
    .where(
      and(eq(schema.proposedAction.dealId, dealId), eq(schema.proposedAction.agent, "planner")),
    )
    .orderBy(desc(schema.proposedAction.createdAt))
    .limit(1);
  if (!proposal) return { status: "planning" as const };
  if (
    deal.status !== "draft" ||
    proposal.decisionReason === "Agency saved a reviewed draft; sending is a separate action."
  )
    return { status: "saved" as const };
  if (proposal.payload.type === "create_plan")
    return { status: "ready" as const, proposalId: proposal.id, plan: proposal.payload.plan };
  return {
    status: "failed" as const,
    message: "The planner could not produce a valid draft. Review your brief and rate card.",
  };
}

export async function saveDraft(
  db: Db,
  workspaceId: string,
  dealId: string,
  proposalId: string,
  raw: PlanDraft,
) {
  const plan = PlanDraft.parse(raw);
  return db.transaction(async (tx) => {
    const [deal] = await tx
      .select()
      .from(schema.deal)
      .where(and(eq(schema.deal.id, dealId), eq(schema.deal.workspaceId, workspaceId)))
      .for("update");
    if (deal?.status !== "draft") throw new Error("draft_not_editable");
    const [proposal] = await tx
      .select()
      .from(schema.proposedAction)
      .where(
        and(
          eq(schema.proposedAction.id, proposalId),
          eq(schema.proposedAction.dealId, dealId),
          eq(schema.proposedAction.agent, "planner"),
        ),
      )
      .for("update");
    if (
      proposal?.payload.type !== "create_plan" ||
      !["pending", "needs_approval"].includes(proposal.status)
    )
      throw new Error("draft_proposal_changed");
    const [event] = await tx
      .select()
      .from(schema.event)
      .where(and(eq(schema.event.dealId, dealId), eq(schema.event.type, "deal.created")))
      .orderBy(desc(schema.event.id))
      .limit(1);
    const options = PlanningOptions.parse(event?.payload.planning);
    const [ws] = await tx
      .select()
      .from(schema.workspace)
      .where(eq(schema.workspace.id, workspaceId));
    if (!ws) throw new Error("workspace_not_found");
    const issues = plannerIssues(plan, ws.rateCard, options);
    if (issues.length) throw new Error(`invalid_plan: ${issues.join("; ")}`);
    await writePlan(tx, dealId, plan, new Date(), options.startDate);
    await tx
      .update(schema.proposedAction)
      .set({
        status: "rejected",
        decisionReason: "Agency saved a reviewed draft; sending is a separate action.",
        decidedAt: new Date(),
      })
      .where(
        and(
          eq(schema.proposedAction.dealId, dealId),
          eq(schema.proposedAction.type, "create_plan"),
          inArray(schema.proposedAction.status, ["pending", "needs_approval"]),
        ),
      );
    await tx
      .update(schema.approval)
      .set({ decision: "rejected", decidedAt: new Date() })
      .where(eq(schema.approval.proposedActionId, proposal.id));
    await tx.update(schema.deal).set({ updatedAt: new Date() }).where(eq(schema.deal.id, dealId));
  });
}

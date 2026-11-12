import { createHash } from "node:crypto";
import { PlanDealInput } from "@tranche/contracts";
import { type Db, schema } from "@tranche/db";
import type { LanguageModel } from "ai";
import { eq, sql } from "drizzle-orm";
import type { z } from "zod";
import { selectModels } from "../runtime/models";
import { canonical, proposeAction } from "../runtime/persistence";
import { draftPlan, InvalidPlanError } from "./draft-plan";

export async function planDeal(db: Db, raw: z.input<typeof PlanDealInput>, model?: LanguageModel) {
  const input = PlanDealInput.parse(raw);
  return db.transaction(async (lock) => {
    await lock.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`planner:${input.dealId}`}, 0))`,
    );
    const [row] = await db
      .select({ deal: schema.deal, rateCard: schema.workspace.rateCard })
      .from(schema.deal)
      .innerJoin(schema.workspace, eq(schema.workspace.id, schema.deal.workspaceId))
      .where(eq(schema.deal.id, input.dealId));
    if (!row) throw new Error("deal_not_found");
    if (row.deal.status !== "draft") return { outcome: "skipped" as const };
    const key = `plan:${input.dealId}:${createHash("sha256")
      .update(canonical([input, row.deal.brief, row.deal.title, row.rateCard]))
      .digest("hex")
      .slice(0, 32)}`;
    const [prior] = await db
      .select()
      .from(schema.proposedAction)
      .where(eq(schema.proposedAction.idempotencyKey, key));
    if (prior)
      return {
        outcome: prior.type === "create_plan" ? ("planned" as const) : ("failed" as const),
        proposalId: prior.id,
      };
    async function stillDraft() {
      const [current] = await lock
        .select()
        .from(schema.deal)
        .where(eq(schema.deal.id, input.dealId))
        .for("update");
      return (
        current?.status === "draft" &&
        current.brief === row?.deal.brief &&
        current.title === row?.deal.title
      );
    }
    try {
      const plan = await draftPlan(
        { title: row.deal.title, brief: row.deal.brief, rateCard: row.rateCard, options: input },
        model ?? selectModels().judge,
      );
      if (!(await stillDraft())) return { outcome: "skipped" as const };
      const proposal = await proposeAction(lock, {
        dealId: input.dealId,
        agent: "planner",
        side: "agency",
        evidenceIds: [],
        idempotencyKey: key,
        reasoning: "Validated draft ready for agency review.",
        payload: { type: "create_plan", plan },
      });
      return { outcome: "planned" as const, proposalId: proposal.id };
    } catch (error) {
      if (!(error instanceof InvalidPlanError)) throw error;
      if (!(await stillDraft())) return { outcome: "skipped" as const };
      const proposal = await proposeAction(lock, {
        dealId: input.dealId,
        agent: "planner",
        side: "agency",
        evidenceIds: [],
        idempotencyKey: key,
        reasoning: error.message,
        payload: { type: "flag_risk", milestoneId: null, severity: "high", message: error.message },
      });
      return { outcome: "failed" as const, proposalId: proposal.id };
    }
  });
}

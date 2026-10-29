import type { MonitorSnapshot } from "@tranche/contracts";
import { detectFindings, type PlannedAction, plannedActions } from "@tranche/core";
import { type Db, schema } from "@tranche/db";
import type { LanguageModel } from "ai";
import { eq, sql } from "drizzle-orm";
import { proposeAction, selectModels } from "../runtime";
import { draftReminder } from "./draft";
import { loadSnapshot } from "./snapshot";

export { detectFindings, plannedActions } from "@tranche/core";

async function draft(action: PlannedAction, snapshot: MonitorSnapshot, model?: LanguageModel) {
  if (action.payload.type !== "send_reminder" || !action.draft) return action;
  const milestoneId = action.payload.milestoneId;
  const milestone = snapshot.milestones.find((m) => m.id === milestoneId);
  let selected = model;
  if (!selected) {
    try {
      selected = selectModels().fast;
    } catch {
      return action;
    }
  }
  const text = await draftReminder(
    selected,
    action.draft.finding,
    {
      dealTitle: milestone?.dealTitle ?? "Project",
      milestoneTitle: milestone?.title ?? null,
      amount: null,
    },
    action.payload,
  );
  return { ...action, payload: { ...action.payload, ...text } };
}

export async function assessDeal(snapshot: MonitorSnapshot, now: Date, model?: LanguageModel) {
  const actions: PlannedAction[] = [];
  for (const finding of detectFindings(snapshot, now)) {
    for (const action of plannedActions(finding, now))
      actions.push(await draft(action, snapshot, model));
  }
  return actions;
}

export async function runMonitor(
  db: Db,
  opts: { now?: Date; dealId?: string; model?: LanguageModel } = {},
) {
  const now = opts.now ?? new Date();
  const snapshot = await loadSnapshot(db, opts);
  const plans = detectFindings(snapshot, now).flatMap((finding) => plannedActions(finding, now));
  let inserted = 0;
  for (const plan of plans) {
    inserted += await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${plan.key}, 0))`);
      const [prior] = await tx
        .select({ id: schema.proposedAction.id })
        .from(schema.proposedAction)
        .where(eq(schema.proposedAction.idempotencyKey, plan.key));
      if (prior) return 0;
      const action = await draft(plan, snapshot, opts.model);
      await proposeAction(tx, {
        dealId: action.dealId,
        agent: "monitor",
        side: "agency",
        evidenceIds: [],
        idempotencyKey: action.key,
        reasoning: action.reasoning,
        payload: action.payload,
      });
      return 1;
    });
  }
  return inserted;
}

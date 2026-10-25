import { Id, type Mandate } from "@tranche/contracts";
import { nextSlot, withinMandate } from "@tranche/core";
import { type Db, type DbTransaction, loadNegotiationPlan, schema } from "@tranche/db";
import type { LanguageModel } from "ai";
import { asc, eq } from "drizzle-orm";
import { proposeAction, selectModels } from "../runtime";
import { negotiateTurn } from "./turn";

type Negotiation = typeof schema.negotiation.$inferSelect;
async function escalate(tx: DbTransaction, n: Negotiation, reason: string) {
  await proposeAction(tx, {
    dealId: n.dealId,
    agent: "negotiator",
    side: "agency",
    reasoning: reason,
    evidenceIds: [],
    idempotencyKey: `negotiation:${n.id}:escalate`,
    payload: { type: "escalate", negotiationId: n.id, reason },
  });
  await tx
    .update(schema.negotiation)
    .set({ status: "escalated" })
    .where(eq(schema.negotiation.id, n.id));
  await tx.insert(schema.event).values({
    dealId: n.dealId,
    type: "negotiation.escalated",
    payload: { negotiationId: n.id, reason },
  });
  return "escalated" as const;
}

export async function takeTurn(db: Db, negotiationId: string, model?: LanguageModel) {
  Id.parse(negotiationId);
  return db.transaction(async (tx) => {
    const [n] = await tx
      .select()
      .from(schema.negotiation)
      .where(eq(schema.negotiation.id, negotiationId))
      .for("update");
    if (!n) throw new Error("negotiation_not_found");
    if (n.status !== "open") return n.status;
    const current = await loadNegotiationPlan(tx, n.dealId);
    if (!n.basePlan || !n.startDate || current?.version !== n.basePlanVersion || !current.editable)
      return escalate(tx, n, "The plan changed. Start a new negotiation after reviewing it.");
    const turns = await tx
      .select()
      .from(schema.negotiationTurn)
      .where(eq(schema.negotiationTurn.negotiationId, n.id))
      .orderBy(asc(schema.negotiationTurn.round), asc(schema.negotiationTurn.side));
    const slot = nextSlot(turns, Math.min(n.agencyMandate.maxRounds, n.clientMandate.maxRounds));
    if (!("side" in slot))
      return escalate(tx, n, "The round limit was reached. Human review required.");
    const [deal] = await tx.select().from(schema.deal).where(eq(schema.deal.id, n.dealId));
    if (!deal || !["sent", "negotiating"].includes(deal.status))
      return escalate(tx, n, "The deal is no longer available for negotiation.");
    const mandate: Mandate = slot.side === "agency" ? n.agencyMandate : n.clientMandate;
    const turn = await negotiateTurn(
      {
        side: slot.side,
        mandate,
        base: n.basePlan,
        startDate: n.startDate,
        brief: deal.brief,
        turns,
      },
      model ?? selectModels().judge,
    );
    const [lockedDeal] = await tx
      .select()
      .from(schema.deal)
      .where(eq(schema.deal.id, n.dealId))
      .for("update");
    const fresh = await loadNegotiationPlan(tx, n.dealId);
    if (
      !lockedDeal ||
      !["sent", "negotiating"].includes(lockedDeal.status) ||
      fresh?.version !== n.basePlanVersion ||
      !fresh.editable
    )
      return escalate(tx, n, "The plan changed during negotiation. Human review required.");
    const acceptedPlan = turn.offer?.plan;
    const startDate = n.startDate;
    if (
      turn.kind === "accept" &&
      acceptedPlan &&
      ![n.agencyMandate, n.clientMandate].every((m) => withinMandate(acceptedPlan, m, startDate).ok)
    )
      return escalate(tx, n, "The agreement does not satisfy both mandates.");
    await tx.insert(schema.negotiationTurn).values({ negotiationId: n.id, ...slot, ...turn });
    if (turn.kind === "escalate") return escalate(tx, n, turn.message);
    if (turn.kind === "accept" && turn.offer) {
      await proposeAction(tx, {
        dealId: n.dealId,
        agent: "negotiator",
        side: slot.side,
        reasoning: "Both agents accepted the same terms; policy and approval still apply.",
        evidenceIds: [],
        idempotencyKey: `negotiation:${n.id}:accept`,
        payload: { type: "accept_plan", negotiationId: n.id, plan: turn.offer.plan },
      });
      await tx
        .update(schema.negotiation)
        .set({ status: "agreed" })
        .where(eq(schema.negotiation.id, n.id));
      await tx.insert(schema.event).values({
        dealId: n.dealId,
        type: "negotiation.agreed",
        payload: { negotiationId: n.id, round: slot.round },
      });
      return "agreed" as const;
    }
    return "open" as const;
  });
}
export async function runNegotiation(db: Db, negotiationId: string, model?: LanguageModel) {
  for (let step = 0; step < 25; step++) {
    const outcome = await takeTurn(db, negotiationId, model);
    if (outcome !== "open") return outcome;
  }
  throw new Error("negotiation_step_limit");
}

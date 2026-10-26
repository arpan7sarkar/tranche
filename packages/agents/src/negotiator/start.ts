import { type Mandate, StartNegotiationInput } from "@tranche/contracts";
import { planTotal } from "@tranche/core";
import { type Db, loadNegotiationPlan, schema } from "@tranche/db";
import { and, eq, inArray } from "drizzle-orm";

export async function startNegotiation(db: Db, workspaceId: string, raw: StartNegotiationInput) {
  const input = StartNegotiationInput.parse(raw);
  return db.transaction(async (tx) => {
    const [deal] = await tx
      .select()
      .from(schema.deal)
      .where(and(eq(schema.deal.id, input.dealId), eq(schema.deal.workspaceId, workspaceId)))
      .for("update");
    if (!deal) return { ok: false as const, error: "not_found" };
    if (!["sent", "negotiating"].includes(deal.status))
      return { ok: false as const, error: "send_plan_first" };
    const [existing] = await tx
      .select()
      .from(schema.negotiation)
      .where(and(eq(schema.negotiation.dealId, deal.id), eq(schema.negotiation.status, "open")));
    if (existing) return { ok: true as const, negotiationId: existing.id, existing: true };
    const [pending] = await tx
      .select({ id: schema.proposedAction.id })
      .from(schema.proposedAction)
      .where(
        and(
          eq(schema.proposedAction.dealId, deal.id),
          eq(schema.proposedAction.type, "accept_plan"),
          inArray(schema.proposedAction.status, ["pending", "approved", "needs_approval"]),
        ),
      );
    if (pending) return { ok: false as const, error: "agreement_pending" };
    const snapshot = await loadNegotiationPlan(tx, deal.id);
    if (!snapshot?.editable) return { ok: false as const, error: "plan_not_editable" };
    const [ws] = await tx
      .select()
      .from(schema.workspace)
      .where(eq(schema.workspace.id, workspaceId));
    if (!ws) throw new Error("workspace_not_found");
    const agencyMandate: Mandate = {
      side: "agency",
      limitMinor: Math.max(
        ws.rateCard.minimumProjectMinor,
        input.agencyFloorMinor ?? Math.round(planTotal(snapshot.plan) * 0.85),
      ),
      latestEndDate: null,
      maxRounds: input.agencyMaxRounds ?? input.client.maxRounds,
    };
    const [n] = await tx
      .insert(schema.negotiation)
      .values({
        dealId: deal.id,
        agencyMandate,
        clientMandate: { side: "client", ...input.client },
        basePlan: snapshot.plan,
        basePlanVersion: snapshot.version,
        startDate: snapshot.startDate,
      })
      .returning();
    if (!n) throw new Error("negotiation_insert_failed");
    await tx
      .insert(schema.event)
      .values({ dealId: deal.id, type: "negotiation.started", payload: { negotiationId: n.id } });
    return { ok: true as const, negotiationId: n.id, existing: false };
  });
}

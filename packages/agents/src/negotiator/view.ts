import { planEnd, planTotal } from "@tranche/core";
import { type Db, schema } from "@tranche/db";
import { and, asc, desc, eq } from "drizzle-orm";

export async function latestNegotiation(db: Db, workspaceId: string, dealId: string) {
  const [row] = await db
    .select({ id: schema.negotiation.id })
    .from(schema.negotiation)
    .innerJoin(schema.deal, eq(schema.deal.id, schema.negotiation.dealId))
    .where(and(eq(schema.deal.id, dealId), eq(schema.deal.workspaceId, workspaceId)))
    .orderBy(desc(schema.negotiation.createdAt))
    .limit(1);
  return row?.id ?? null;
}
export async function loadNegotiationView(db: Db, workspaceId: string, id: string) {
  const [row] = await db
    .select({ n: schema.negotiation, currency: schema.deal.currency })
    .from(schema.negotiation)
    .innerJoin(schema.deal, eq(schema.deal.id, schema.negotiation.dealId))
    .where(and(eq(schema.negotiation.id, id), eq(schema.deal.workspaceId, workspaceId)));
  if (!row) return null;
  const turns = await db
    .select()
    .from(schema.negotiationTurn)
    .where(eq(schema.negotiationTurn.negotiationId, id))
    .orderBy(asc(schema.negotiationTurn.round), asc(schema.negotiationTurn.side));
  const [proposal] = await db
    .select({ status: schema.proposedAction.status })
    .from(schema.proposedAction)
    .where(eq(schema.proposedAction.idempotencyKey, `negotiation:${id}:accept`));
  return {
    id,
    dealId: row.n.dealId,
    status: row.n.status,
    currency: row.currency,
    applicationStatus: proposal?.status ?? null,
    startDate: row.n.startDate,
    turns: turns.map((t) => ({
      id: t.id,
      round: t.round,
      side: t.side,
      kind: t.kind,
      message: t.message,
      plan: t.offer?.plan ?? null,
      totalMinor: t.offer ? planTotal(t.offer.plan) : null,
      endDate: t.offer && row.n.startDate ? planEnd(t.offer.plan, row.n.startDate) : null,
    })),
  };
}
export type NegotiationView = NonNullable<Awaited<ReturnType<typeof loadNegotiationView>>>;

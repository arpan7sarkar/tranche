import { EvidenceInput, ProposedActionInput } from "@tranche/contracts";
import { type Db, schema } from "@tranche/db";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)))
      : item,
  );
}
async function validateOwnership(tx: Tx, p: ProposedActionInput) {
  const [deal] = await tx
    .select({ id: schema.deal.id })
    .from(schema.deal)
    .where(eq(schema.deal.id, p.dealId));
  if (!deal) throw new Error("deal_not_found");
  const payload = p.payload;
  const milestoneId = "milestoneId" in payload ? payload.milestoneId : null;
  if (milestoneId) {
    const [milestone] = await tx
      .select()
      .from(schema.milestone)
      .where(and(eq(schema.milestone.id, milestoneId), eq(schema.milestone.dealId, p.dealId)));
    if (!milestone) throw new Error("foreign_milestone");
  }
  const ids = [
    ...new Set([...p.evidenceIds, ...("evidenceIds" in payload ? payload.evidenceIds : [])]),
  ];
  if (ids.length) {
    const rows = await tx
      .select({ milestoneId: schema.evidence.milestoneId })
      .from(schema.evidence)
      .innerJoin(schema.milestone, eq(schema.milestone.id, schema.evidence.milestoneId))
      .where(and(inArray(schema.evidence.id, ids), eq(schema.milestone.dealId, p.dealId)));
    if (
      rows.length !== ids.length ||
      (milestoneId && rows.some((row) => row.milestoneId !== milestoneId))
    )
      throw new Error("foreign_evidence");
  }
  if (payload.type === "reschedule") {
    const ids = [...new Set(payload.shifts.map((shift) => shift.taskId))];
    const rows = await tx
      .select({ id: schema.task.id })
      .from(schema.task)
      .where(and(inArray(schema.task.id, ids), eq(schema.task.dealId, p.dealId)));
    if (rows.length !== ids.length) throw new Error("foreign_task");
  }
  if ("negotiationId" in payload && payload.negotiationId) {
    const [row] = await tx
      .select()
      .from(schema.negotiation)
      .where(
        and(
          eq(schema.negotiation.id, payload.negotiationId),
          eq(schema.negotiation.dealId, p.dealId),
        ),
      );
    if (!row) throw new Error("foreign_negotiation");
  }
  if (payload.type === "submit_dispute_evidence") {
    const [row] = await tx
      .select({ id: schema.event.id })
      .from(schema.event)
      .where(
        and(
          eq(schema.event.dealId, p.dealId),
          eq(schema.event.type, "milestone.disputed"),
          sql`${schema.event.payload}->>'disputeId' = ${payload.disputeId}`,
        ),
      )
      .limit(1);
    if (!row) throw new Error("foreign_dispute");
  }
}
export async function proposeAction(
  db: Db,
  input: ProposedActionInput,
): Promise<{ id: string; created: boolean }> {
  const p = ProposedActionInput.parse(input);
  if (p.agent === "human" || p.agent === "system") throw new Error("agent_identity_required");
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`proposal:${p.idempotencyKey}`}))`,
    );
    await validateOwnership(tx, p);
    const [existing] = await tx
      .select()
      .from(schema.proposedAction)
      .where(eq(schema.proposedAction.idempotencyKey, p.idempotencyKey));
    if (existing) {
      const prior = ProposedActionInput.parse(existing);
      if (canonical(prior) !== canonical(p)) throw new Error("proposal_identity_conflict");
      return { id: existing.id, created: false };
    }
    const [row] = await tx
      .insert(schema.proposedAction)
      .values({ ...p, type: p.payload.type, status: "pending" })
      .returning({ id: schema.proposedAction.id });
    if (!row) throw new Error("proposal_insert_failed");
    return { id: row.id, created: true };
  });
}
export async function recordEvidence(
  db: Db,
  input: EvidenceInput,
  dealId: string,
): Promise<{ id: string; created: boolean }> {
  const e = EvidenceInput.parse(input);
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`evidence:${e.milestoneId}:${e.kind}:${e.checkIndex}:${e.contentHash}`}))`,
    );
    const [milestone] = await tx
      .select()
      .from(schema.milestone)
      .where(and(eq(schema.milestone.id, e.milestoneId), eq(schema.milestone.dealId, dealId)));
    if (!milestone) throw new Error("foreign_milestone");
    const [prior] = await tx
      .select()
      .from(schema.evidence)
      .where(
        and(
          eq(schema.evidence.milestoneId, e.milestoneId),
          eq(schema.evidence.kind, e.kind),
          e.checkIndex === null
            ? isNull(schema.evidence.checkIndex)
            : eq(schema.evidence.checkIndex, e.checkIndex),
          eq(schema.evidence.contentHash, e.contentHash),
        ),
      );
    if (prior) {
      if (canonical(EvidenceInput.parse(prior)) !== canonical(e))
        throw new Error("evidence_identity_conflict");
      return { id: prior.id, created: false };
    }
    const [row] = await tx.insert(schema.evidence).values(e).returning({ id: schema.evidence.id });
    if (!row) throw new Error("evidence_insert_failed");
    return { id: row.id, created: true };
  });
}

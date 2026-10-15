import {
  ACTION_EXECUTOR,
  ACTION_TYPES,
  type PlanDraft,
  type Policy,
  ProposedActionInput,
} from "@tranche/contracts";
import {
  evaluatePolicy,
  milestoneWindows,
  type PolicyDecision,
  schedulePlan,
  verificationGate,
} from "@tranche/core";
import { type Db, schema } from "@tranche/db";
import { and, eq, inArray, max, notInArray, or, sql } from "drizzle-orm";
import type { Tx } from "./db";
import type { Deps } from "./deps";
import { errorMessage, must, PermanentError } from "./errors";
import { appendEvent } from "./events";
import { mustAdvance, StaleMilestoneError } from "./milestones";
import { enqueueOutbox } from "./outbox";

export type ProposedActionRow = typeof schema.proposedAction.$inferSelect;

const pa = schema.proposedAction;
const H_TYPES = ACTION_TYPES.filter(
  (t) => ACTION_EXECUTOR[t] === "money" || ACTION_EXECUTOR[t] === "state",
);
const NO_POLICY: Policy = {
  perActionMaxMinor: 0,
  perMilestoneMaxMinor: 0,
  perDealMaxMinor: 0,
  autoReleaseAfterHours: null,
  cooldownMinutes: 0,
  alwaysAsk: [],
};

export async function processActions(deps: Deps, limit = 20): Promise<number> {
  const seen: string[] = [];
  while (seen.length < limit) {
    const claim: { id: string | null } = { id: null };
    try {
      await deps.db.transaction(async (tx) => {
        const [row] = await tx
          .select()
          .from(pa)
          .where(
            and(
              or(
                eq(pa.status, "pending"),
                and(eq(pa.status, "approved"), inArray(pa.type, H_TYPES)),
              ),
              seen.length > 0 ? notInArray(pa.id, seen) : undefined,
            ),
          )
          .orderBy(pa.createdAt)
          .limit(1)
          .for("update", { skipLocked: true });
        if (!row) return;
        claim.id = row.id;
        await handleAction(tx, deps, row);
      });
    } catch (err) {
      // A concurrent milestone write rolled this action back untouched; the next pass retries it.
      if (!(err instanceof StaleMilestoneError)) throw err;
    }
    if (!claim.id) break;
    seen.push(claim.id);
  }
  return seen.length;
}

async function handleAction(tx: Tx, deps: Deps, row: ProposedActionRow): Promise<void> {
  const now = deps.now();
  if (row.status === "pending") {
    const d = await decide(tx, deps, row);
    if (d.decision === "reject") {
      await tx
        .update(pa)
        .set({ status: "rejected", decisionReason: d.reason, decidedAt: now })
        .where(eq(pa.id, row.id));
      return;
    }
    if (d.decision === "needs_approval") {
      await tx
        .update(pa)
        .set({ status: "needs_approval", decisionReason: d.reason, decidedAt: now })
        .where(eq(pa.id, row.id));
      const [approval] = await tx
        .insert(schema.approval)
        .values({ proposedActionId: row.id, side: d.side })
        .returning({ id: schema.approval.id });
      await appendEvent(tx, {
        type: "approval.requested",
        dealId: row.dealId,
        milestoneId: milestoneIdOf(row),
        payload: { approvalId: must(approval).id, proposedActionId: row.id, side: d.side },
      });
      return;
    }
    await tx
      .update(pa)
      .set({ status: "approved", decisionReason: d.reason, decidedAt: now })
      .where(eq(pa.id, row.id));
    if (!H_TYPES.includes(row.type)) return;
  }
  await execute(tx, deps, row);
}

function approverSide(row: ProposedActionRow): "agency" | "client" {
  if (row.type === "release") return "client";
  return row.side === "client" ? "client" : "agency";
}

function milestoneIdOf(row: { payload: ProposedActionRow["payload"] }): string | null {
  return "milestoneId" in row.payload ? (row.payload.milestoneId ?? null) : null;
}

async function decide(
  tx: Tx,
  deps: Deps,
  row: ProposedActionRow,
): Promise<PolicyDecision & { side: "agency" | "client" }> {
  const side = approverSide(row);
  const parsed = ProposedActionInput.safeParse({
    dealId: row.dealId,
    agent: row.agent,
    side: row.side,
    reasoning: row.reasoning,
    evidenceIds: row.evidenceIds,
    idempotencyKey: row.idempotencyKey,
    payload: row.payload,
  });
  if (!parsed.success) {
    return {
      decision: "reject",
      reason: `invalid proposal: ${parsed.error.issues[0]?.message}`,
      side,
    };
  }
  const action = parsed.data;

  const [deal] = await tx.select().from(schema.deal).where(eq(schema.deal.id, row.dealId));
  if (!deal) return { decision: "reject", reason: "deal not found", side };
  const configured = side === "client" ? deal.clientPolicy : deal.agencyPolicy;
  if (!configured && action.agent !== "human") {
    return { decision: "needs_approval", reason: `no ${side} policy configured`, side };
  }

  const milestoneId = milestoneIdOf(row);
  const [m] = milestoneId
    ? await tx
        .select({
          heldMinor: schema.milestone.heldMinor,
          releasedMinor: schema.milestone.releasedMinor,
        })
        .from(schema.milestone)
        .where(eq(schema.milestone.id, milestoneId))
    : [];
  const [dealTotals] = await tx
    .select({
      released: sql<number>`coalesce(sum(${schema.milestone.releasedMinor}), 0)`.mapWith(Number),
    })
    .from(schema.milestone)
    .where(eq(schema.milestone.dealId, row.dealId));
  const [last] = await tx
    .select({ at: max(pa.executedAt) })
    .from(pa)
    .where(and(eq(pa.dealId, row.dealId), eq(pa.type, row.type), eq(pa.status, "executed")));

  const d = evaluatePolicy({
    action,
    policy: configured ?? NO_POLICY,
    context: {
      now: deps.now().toISOString(),
      heldForMilestoneMinor: m?.heldMinor ?? 0,
      releasedForMilestoneMinor: m?.releasedMinor ?? 0,
      releasedForDealMinor: dealTotals?.released ?? 0,
      lastExecutedAt: last?.at?.toISOString() ?? null,
    },
  });

  // The client's policy delegates to the client's side only; a release from anyone else waits for the client.
  if (d.decision === "approve" && row.type === "release" && row.side !== "client") {
    return { decision: "needs_approval", reason: "release needs the client's approval", side };
  }
  if (d.decision === "approve" && action.payload.type === "mark_verified") {
    const gate = await gateFor(tx, action.payload.milestoneId);
    if (!gate.passed) {
      return {
        decision: "reject",
        reason: `verification gate failed for checks ${gate.failing.join(", ")}`,
        side,
      };
    }
  }
  return { ...d, side };
}

async function gateFor(tx: Tx, milestoneId: string) {
  const [m] = await tx.select().from(schema.milestone).where(eq(schema.milestone.id, milestoneId));
  if (!m) return { passed: false, failing: [] };
  const rows = await tx
    .select()
    .from(schema.evidence)
    .where(eq(schema.evidence.milestoneId, milestoneId));
  return verificationGate(
    m.criteria,
    rows.map((r) => ({
      checkIndex: r.checkIndex,
      passed: r.passed,
      createdAt: r.createdAt.toISOString(),
    })),
  );
}

async function execute(tx: Tx, deps: Deps, row: ProposedActionRow): Promise<void> {
  const now = deps.now();
  const ref = { dealId: row.dealId, milestoneId: milestoneIdOf(row) };
  try {
    await tx.transaction((sp) => runExecutor(sp, deps, row));
    await tx.update(pa).set({ status: "executed", executedAt: now }).where(eq(pa.id, row.id));
    await appendEvent(tx, {
      type: "action.executed",
      ...ref,
      payload: { proposedActionId: row.id, type: row.type },
    });
  } catch (err) {
    if (err instanceof StaleMilestoneError) throw err;
    await tx
      .update(pa)
      .set({ status: "failed", decisionReason: errorMessage(err) })
      .where(eq(pa.id, row.id));
    await appendEvent(tx, {
      type: "action.failed",
      ...ref,
      payload: { proposedActionId: row.id, type: row.type, error: errorMessage(err) },
    });
  }
}

export async function runExecutor(tx: Tx, deps: Deps, row: ProposedActionRow): Promise<void> {
  const now = deps.now();
  const p = row.payload;
  const payload = { proposedActionId: row.id };
  switch (p.type) {
    case "mark_verified":
      return mustAdvance(
        tx,
        p.milestoneId,
        { type: "verification_passed", at: now.toISOString() },
        { now, payload: { ...payload, evidenceIds: p.evidenceIds } },
      );
    case "request_changes":
      return mustAdvance(
        tx,
        p.milestoneId,
        { type: "verification_failed", missing: p.missing },
        { now, payload: { ...payload, missing: p.missing, evidenceIds: p.evidenceIds } },
      );
    case "release": {
      const [m] = await tx
        .select()
        .from(schema.milestone)
        .where(eq(schema.milestone.id, p.milestoneId));
      if (!m) throw new PermanentError(`milestone ${p.milestoneId} not found`);
      if (m.dealId !== row.dealId) throw new PermanentError("milestone belongs to another deal");
      if (p.amount.minor !== m.heldMinor - m.releasedMinor) {
        throw new PermanentError("partial releases are not supported");
      }
      return mustAdvance(
        tx,
        p.milestoneId,
        { type: "release_approved", at: now.toISOString() },
        { now, payload },
      );
    }
    case "create_plan": {
      await writePlan(tx, row.dealId, p.plan, now);
      const [deal] = await tx
        .update(schema.deal)
        .set({ status: "sent", updatedAt: now })
        .where(eq(schema.deal.id, row.dealId))
        .returning({ clientId: schema.deal.clientId });
      await appendEvent(tx, {
        type: "deal.plan_sent",
        dealId: row.dealId,
        milestoneId: null,
        payload: { clientId: must(deal).clientId },
      });
      return;
    }
    case "accept_plan":
      await writePlan(tx, row.dealId, p.plan, now);
      await agreeToPlanTx(tx, row.dealId, now);
      return;
    case "submit_dispute_evidence":
      return enqueueOutbox(
        tx,
        {
          kind: "dispute_evidence",
          request: { disputeId: p.disputeId, notes: p.notes, evidenceIds: p.evidenceIds },
          requestId: `dispute:${row.id}`,
          proposedActionId: row.id,
        },
        now,
      );
    default:
      throw new PermanentError(`no executor for ${p.type}`);
  }
}

export async function writePlan(tx: Tx, dealId: string, plan: PlanDraft, now: Date): Promise<void> {
  const [deal] = await tx.select().from(schema.deal).where(eq(schema.deal.id, dealId));
  if (!deal) throw new PermanentError(`deal ${dealId} not found`);
  if (deal.currency !== plan.currency) {
    throw new PermanentError(`plan currency ${plan.currency} differs from deal ${deal.currency}`);
  }
  const existing = await tx
    .select({ state: schema.milestone.state })
    .from(schema.milestone)
    .where(eq(schema.milestone.dealId, dealId));
  if (existing.some((m) => m.state !== "draft")) {
    throw new PermanentError("a plan can only change before it is agreed");
  }
  await tx.delete(schema.milestone).where(eq(schema.milestone.dealId, dealId));

  const schedule = schedulePlan(plan.tasks, now.toISOString().slice(0, 10));
  const windows = milestoneWindows(plan.tasks, schedule);
  const ms = await tx
    .insert(schema.milestone)
    .values(
      plan.milestones.map((m, i) => ({
        dealId,
        key: m.key,
        position: i,
        title: m.title,
        priceMinor: m.price.minor,
        criteria: m.criteria,
        payees: m.payees,
        startDate: windows.get(m.key)?.start ?? null,
        endDate: windows.get(m.key)?.end ?? null,
      })),
    )
    .returning();
  const msId = new Map(ms.map((m) => [m.key, m.id]));
  const ts = await tx
    .insert(schema.task)
    .values(
      plan.tasks.map((t, i) => ({
        dealId,
        milestoneId: must(msId.get(t.milestoneKey)),
        key: t.key,
        title: t.title,
        durationDays: t.durationDays,
        startDate: must(schedule.get(t.key)).start,
        position: i,
      })),
    )
    .returning();
  const taskId = new Map(ts.map((t) => [t.key, t.id]));
  const edges = plan.tasks.flatMap((t) =>
    t.dependsOn.map((d) => ({
      fromTaskId: must(taskId.get(d)),
      toTaskId: must(taskId.get(t.key)),
    })),
  );
  if (edges.length > 0) await tx.insert(schema.taskDependency).values(edges);
}

async function agreeToPlanTx(tx: Tx, dealId: string, now: Date): Promise<void> {
  const [deal] = await tx
    .select()
    .from(schema.deal)
    .where(eq(schema.deal.id, dealId))
    .for("update");
  if (!deal) throw new PermanentError(`deal ${dealId} not found`);
  if (deal.status !== "sent" && deal.status !== "negotiating") {
    throw new PermanentError(
      `deal is ${deal.status}, a plan can only be agreed when it is sent or negotiating`,
    );
  }
  const ms = await tx
    .select()
    .from(schema.milestone)
    .where(eq(schema.milestone.dealId, dealId))
    .orderBy(schema.milestone.position);
  for (const m of ms) await mustAdvance(tx, m.id, { type: "plan_agreed" }, { now });
  await tx
    .update(schema.deal)
    .set({ status: "agreed", updatedAt: now })
    .where(eq(schema.deal.id, dealId));
  await appendEvent(tx, { type: "deal.agreed", dealId, milestoneId: null, payload: {} });
}

export async function agreeToPlan(db: Db, dealId: string, now = new Date()): Promise<void> {
  await db.transaction((tx) => agreeToPlanTx(tx, dealId, now));
}

export async function decideApproval(
  db: Db,
  input: { approvalId: string; decision: "approved" | "rejected"; decidedBy: string },
  now = new Date(),
): Promise<void> {
  await db.transaction(async (tx) => {
    const [a] = await tx
      .select()
      .from(schema.approval)
      .where(eq(schema.approval.id, input.approvalId))
      .for("update");
    if (!a) throw new Error(`approval ${input.approvalId} not found`);
    if (a.decision) return;
    await tx
      .update(schema.approval)
      .set({ decision: input.decision, decidedBy: input.decidedBy, decidedAt: now })
      .where(eq(schema.approval.id, a.id));
    const [action] = await tx
      .update(pa)
      .set({
        status: input.decision,
        decidedAt: now,
        decisionReason: `${input.decision} by ${input.decidedBy}`,
      })
      .where(and(eq(pa.id, a.proposedActionId), eq(pa.status, "needs_approval")))
      .returning();
    if (!action) return;
    await appendEvent(tx, {
      type: "approval.decided",
      dealId: action.dealId,
      milestoneId: milestoneIdOf(action),
      payload: { approvalId: a.id, proposedActionId: action.id, decision: input.decision },
    });
  });
}

export async function submitHumanAction(
  db: Db,
  input: ProposedActionInput,
): Promise<{ id: string; created: boolean }> {
  const a = ProposedActionInput.parse(input);
  if (a.agent !== "human") throw new Error("submitHumanAction only accepts agent human");
  const rows = await db
    .insert(pa)
    .values({
      dealId: a.dealId,
      agent: a.agent,
      side: a.side,
      type: a.payload.type,
      payload: a.payload,
      reasoning: a.reasoning,
      evidenceIds: a.evidenceIds,
      idempotencyKey: a.idempotencyKey,
    })
    .onConflictDoNothing({ target: pa.idempotencyKey })
    .returning({ id: pa.id });
  if (rows[0]) return { id: rows[0].id, created: true };
  const [existing] = await db
    .select({ id: pa.id })
    .from(pa)
    .where(eq(pa.idempotencyKey, a.idempotencyKey));
  return { id: must(existing).id, created: false };
}

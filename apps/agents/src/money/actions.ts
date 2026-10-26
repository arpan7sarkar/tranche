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
  planVersion,
  schedulePlan,
  verificationGate,
  withinMandate,
} from "@tranche/core";
import { type Db, loadNegotiationPlan, schema } from "@tranche/db";
import { and, desc, eq, inArray, max, notInArray, or, sql } from "drizzle-orm";
import type { Tx } from "./db";
import type { Deps } from "./deps";
import { errorMessage, ForbiddenError, must, PermanentError } from "./errors";
import { appendEvent } from "./events";
import { mustAdvance, StaleMilestoneError } from "./milestones";
import { enqueueOutbox } from "./outbox";
import { applyReschedule } from "./reschedule";

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
      // Anything else fails just this action, so one bad row never stalls the queue.
      if (claim.id && !(err instanceof StaleMilestoneError)) await failAction(deps, claim.id, err);
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

async function failAction(deps: Deps, id: string, err: unknown): Promise<void> {
  await deps.db.transaction(async (tx) => {
    const [row] = await tx
      .update(pa)
      .set({ status: "failed", decisionReason: errorMessage(err), decidedAt: deps.now() })
      .where(eq(pa.id, id))
      .returning();
    if (!row) return;
    await appendEvent(tx, {
      type: "action.failed",
      dealId: row.dealId,
      milestoneId: milestoneIdOf(row),
      payload: { proposedActionId: row.id, type: row.type, error: errorMessage(err) },
    });
  });
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
  const foreign = await ownershipIssue(tx, action);
  if (foreign) return { decision: "reject", reason: foreign, side };
  if (action.payload.type === "accept_plan") {
    const issue = await acceptIssue(tx, action.dealId, action.side, action.payload);
    if (issue) return { decision: "reject", reason: issue, side };
  }
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

// Every id an action names must belong to the action's own deal, whoever proposed it.
async function ownershipIssue(tx: Tx, a: ProposedActionInput): Promise<string | null> {
  const p = a.payload;
  const milestoneId = "milestoneId" in p ? p.milestoneId : null;
  if (milestoneId) {
    const [m] = await tx
      .select({ id: schema.milestone.id })
      .from(schema.milestone)
      .where(and(eq(schema.milestone.id, milestoneId), eq(schema.milestone.dealId, a.dealId)));
    if (!m) return "milestone does not belong to this deal";
  }
  const evidenceIds = [
    ...new Set([...a.evidenceIds, ...("evidenceIds" in p ? p.evidenceIds : [])]),
  ];
  if (evidenceIds.length > 0) {
    const found = await tx
      .select({ milestoneId: schema.evidence.milestoneId })
      .from(schema.evidence)
      .innerJoin(schema.milestone, eq(schema.milestone.id, schema.evidence.milestoneId))
      .where(and(inArray(schema.evidence.id, evidenceIds), eq(schema.milestone.dealId, a.dealId)));
    if (found.length !== evidenceIds.length) return "evidence does not belong to this deal";
    if (milestoneId && found.some((e) => e.milestoneId !== milestoneId)) {
      return "evidence belongs to another milestone";
    }
  }
  if (p.type === "reschedule") {
    const taskIds = [...new Set(p.shifts.map((s) => s.taskId))];
    const found = await tx
      .select({ id: schema.task.id })
      .from(schema.task)
      .where(and(inArray(schema.task.id, taskIds), eq(schema.task.dealId, a.dealId)));
    if (found.length !== taskIds.length) return "task does not belong to this deal";
  }
  const negotiationId = "negotiationId" in p ? p.negotiationId : null;
  if (negotiationId) {
    const [n] = await tx
      .select({ id: schema.negotiation.id })
      .from(schema.negotiation)
      .where(
        and(eq(schema.negotiation.id, negotiationId), eq(schema.negotiation.dealId, a.dealId)),
      );
    if (!n) return "negotiation does not belong to this deal";
  }
  if (p.type === "submit_dispute_evidence") {
    const [d] = await tx
      .select({ id: schema.event.id })
      .from(schema.event)
      .where(
        and(
          eq(schema.event.dealId, a.dealId),
          eq(schema.event.type, "milestone.disputed"),
          sql`${schema.event.payload}->>'disputeId' = ${p.disputeId}`,
        ),
      )
      .limit(1);
    if (!d) return "dispute does not belong to this deal";
  }
  return null;
}

const canonical = (v: unknown) =>
  JSON.stringify(v, (_k, x: unknown) =>
    x && typeof x === "object" && !Array.isArray(x)
      ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1)))
      : x,
  );

// A side may only accept the other side's latest offer, exactly as offered.
async function acceptIssue(
  tx: Tx,
  dealId: string,
  side: ProposedActionRow["side"],
  p: Extract<ProposedActionRow["payload"], { type: "accept_plan" }>,
): Promise<string | null> {
  const t = schema.negotiationTurn;
  const [negotiation] = await tx
    .select()
    .from(schema.negotiation)
    .where(and(eq(schema.negotiation.id, p.negotiationId), eq(schema.negotiation.dealId, dealId)));
  if (!negotiation || ["failed", "escalated"].includes(negotiation.status))
    return "negotiation_closed";
  if (negotiation.basePlanVersion) {
    const current = await loadNegotiationPlan(tx, dealId);
    if (current?.version !== negotiation.basePlanVersion || !current.editable)
      return "plan_changed";
    const start = negotiation.startDate;
    if (
      !start ||
      ![negotiation.agencyMandate, negotiation.clientMandate].every(
        (m) => withinMandate(p.plan, m, start).ok,
      )
    )
      return "negotiation_mandate_changed";
  }
  const [latest] = await tx
    .select({ side: t.side, offer: t.offer })
    .from(t)
    .innerJoin(schema.negotiation, eq(schema.negotiation.id, t.negotiationId))
    .where(
      and(
        eq(t.negotiationId, p.negotiationId),
        eq(schema.negotiation.dealId, dealId),
        eq(t.kind, "offer"),
      ),
    )
    .orderBy(desc(t.round), desc(t.createdAt))
    .limit(1);
  if (!latest?.offer) return "there is no offer to accept";
  if (latest.side === side || side === "system")
    return "only the other side's offer can be accepted";
  if (canonical(latest.offer.plan) !== canonical(p.plan))
    return "plan differs from the latest offer";
  return null;
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
  if ((p.type === "mark_verified" || p.type === "request_changes") && p.deliveryId) {
    await tx
      .select({ id: schema.milestone.id })
      .from(schema.milestone)
      .where(eq(schema.milestone.id, p.milestoneId))
      .for("update");
    const [latest] = await tx
      .select()
      .from(schema.event)
      .where(
        and(
          eq(schema.event.milestoneId, p.milestoneId),
          eq(schema.event.type, "milestone.verification_requested"),
        ),
      )
      .orderBy(desc(schema.event.id))
      .limit(1);
    if (latest?.payload.deliveryId !== p.deliveryId) throw new PermanentError("stale_delivery");
  }
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
    case "accept_plan": {
      await tx.select().from(schema.deal).where(eq(schema.deal.id, row.dealId)).for("update");
      // Re-checked here: the other side may have countered while this waited for approval.
      const issue = await acceptIssue(tx, row.dealId, row.side, p);
      if (issue) throw new PermanentError(issue);
      const [negotiation] = await tx
        .select()
        .from(schema.negotiation)
        .where(eq(schema.negotiation.id, p.negotiationId));
      await writePlan(tx, row.dealId, p.plan, now, negotiation?.startDate ?? undefined);
      const milestones = await tx
        .select()
        .from(schema.milestone)
        .where(eq(schema.milestone.dealId, row.dealId))
        .orderBy(schema.milestone.position);
      const agreed = await agreeToPlanTx(
        tx,
        row.dealId,
        planVersion(p.plan.currency, milestones),
        now,
      );
      if (agreed !== "agreed") throw new PermanentError(`the plan could not be agreed: ${agreed}`);
      return;
    }
    case "reschedule":
      await applyReschedule(tx, row.dealId, p.shifts, p.reason, now);
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

export async function writePlan(
  tx: Tx,
  dealId: string,
  plan: PlanDraft,
  now: Date,
  startDate = now.toISOString().slice(0, 10),
): Promise<void> {
  const [deal] = await tx
    .select()
    .from(schema.deal)
    .where(eq(schema.deal.id, dealId))
    .for("update");
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

  const schedule = schedulePlan(plan.tasks, startDate);
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

export type AgreeToPlanResult = "agreed" | "already_agreed" | "not_agreeable" | "plan_changed";

// Every plan writer (writePlan, applyReschedule) locks the deal row first, so the milestones read
// here cannot change before this transaction commits.
async function agreeToPlanTx(
  tx: Tx,
  dealId: string,
  expectedPlanVersion: string | null,
  now: Date,
): Promise<AgreeToPlanResult> {
  const [deal] = await tx
    .select()
    .from(schema.deal)
    .where(eq(schema.deal.id, dealId))
    .for("update");
  if (deal?.status === "agreed" || deal?.status === "active" || deal?.status === "completed") {
    return "already_agreed";
  }
  if (deal?.status !== "sent" && deal?.status !== "negotiating") return "not_agreeable";
  const ms = await tx
    .select()
    .from(schema.milestone)
    .where(eq(schema.milestone.dealId, dealId))
    .orderBy(schema.milestone.position)
    .for("update");
  if (expectedPlanVersion !== null && planVersion(deal.currency, ms) !== expectedPlanVersion) {
    return "plan_changed";
  }
  for (const m of ms) await mustAdvance(tx, m.id, { type: "plan_agreed" }, { now });
  await tx
    .update(schema.deal)
    .set({ status: "agreed", updatedAt: now })
    .where(eq(schema.deal.id, dealId));
  await appendEvent(tx, { type: "deal.agreed", dealId, milestoneId: null, payload: {} });
  return "agreed";
}

export async function agreeToPlan(
  db: Db,
  dealId: string,
  expectedPlanVersion: string,
  now = new Date(),
): Promise<AgreeToPlanResult> {
  return db.transaction((tx) => agreeToPlanTx(tx, dealId, expectedPlanVersion, now));
}

// The authenticated caller, never a free string: the agency screen passes its workspace, the portal
// passes the deal its magic link grants.
export type Decider =
  | { side: "agency"; workspaceId: string; userId: string }
  | { side: "client"; dealId: string; clientId: string };

export async function decideApproval(
  db: Db,
  input: { approvalId: string; decision: "approved" | "rejected"; decider: Decider },
  now = new Date(),
): Promise<void> {
  const { decider } = input;
  await db.transaction(async (tx) => {
    const [row] = await tx
      .select({ a: schema.approval, dealId: schema.deal.id, workspaceId: schema.deal.workspaceId })
      .from(schema.approval)
      .innerJoin(pa, eq(pa.id, schema.approval.proposedActionId))
      .innerJoin(schema.deal, eq(schema.deal.id, pa.dealId))
      .where(eq(schema.approval.id, input.approvalId))
      .for("update", { of: schema.approval });
    const inScope =
      decider.side === "agency"
        ? row?.workspaceId === decider.workspaceId
        : row?.dealId === decider.dealId;
    if (!row || !inScope) throw new ForbiddenError(`approval ${input.approvalId} not found`);
    const { a } = row;
    if (a.side !== decider.side) {
      throw new ForbiddenError(`this approval is for the ${a.side}, not the ${decider.side}`);
    }
    if (a.decision) return;
    const decidedBy = decider.side === "agency" ? decider.userId : `client:${decider.clientId}`;
    await tx
      .update(schema.approval)
      .set({ decision: input.decision, decidedBy, decidedAt: now })
      .where(eq(schema.approval.id, a.id));
    const [action] = await tx
      .update(pa)
      .set({
        status: input.decision,
        decidedAt: now,
        decisionReason: `${input.decision} by ${decidedBy}`,
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

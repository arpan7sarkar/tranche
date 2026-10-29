import { consumeEvents } from "@tranche/agents";
import { ApprovalRequestedPayload } from "@tranche/contracts";
import { createMagicLink, type Db, schema } from "@tranche/db";
import { and, asc, eq, inArray, lte, sql } from "drizzle-orm";
import type { SendEmail } from "./email";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Store = Db | Tx;
const jobs = schema.notificationJob;
const HOUR = 3_600_000;

async function recipients(db: Store, dealId: string, side: "agency" | "client") {
  if (side === "client") {
    return db
      .select({ id: schema.client.id, email: schema.client.email })
      .from(schema.client)
      .innerJoin(
        schema.deal,
        and(
          eq(schema.deal.clientId, schema.client.id),
          eq(schema.deal.workspaceId, schema.client.workspaceId),
        ),
      )
      .where(eq(schema.deal.id, dealId));
  }
  return db
    .select({ id: schema.user.id, email: schema.user.email })
    .from(schema.user)
    .innerJoin(schema.workspaceMember, eq(schema.workspaceMember.userId, schema.user.id))
    .innerJoin(schema.deal, eq(schema.deal.workspaceId, schema.workspaceMember.workspaceId))
    .where(and(eq(schema.deal.id, dealId), eq(schema.workspaceMember.role, "owner")));
}

export async function enqueueNotification(
  db: Db,
  input: {
    key: string;
    dealId: string;
    side: "agency" | "client";
    subject: string;
    body: string;
    actionId?: string;
  },
) {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`notify:${input.key}`}, 0))`,
    );
    const audience = await recipients(tx, input.dealId, input.side);
    if (!audience.length) throw new Error("notification_recipient_unavailable");
    for (const recipient of audience) {
      const key = `${input.key}:${recipient.id}`;
      const [prior] = await tx.select({ id: jobs.id }).from(jobs).where(eq(jobs.key, key));
      if (prior) continue;
      const [clock] = await tx.execute<{ now: string }>(sql`select now()`);
      if (!clock) throw new Error("notification_clock");
      const now = new Date(clock.now);
      const linkExpiresAt = new Date(now.getTime() + 7 * 24 * HOUR);
      const base = new URL(process.env.APP_URL ?? "http://localhost:3000").origin;
      const url =
        input.side === "client"
          ? (
              await createMagicLink(tx, {
                clientId: recipient.id,
                dealId: input.dealId,
                ttlDays: 7,
                now,
              })
            ).url
          : `${base}/deals/${input.dealId}`;
      await tx.insert(jobs).values({
        ...input,
        actionId: input.actionId ?? null,
        key,
        recipientId: recipient.id,
        to: recipient.email,
        body: `${input.body}\n\nReview in Tranche: ${url}`,
        linkExpiresAt,
        nextAttemptAt: now,
      });
    }
  });
}

export async function queueNotifications(db: Db) {
  await consumeEvents(
    db,
    "notifications:v1",
    ["deal.plan_sent", "approval.requested", "milestone.funding_requested"],
    async (event) => {
      if (!event.dealId) return;
      let side: "agency" | "client" = "client";
      let subject = "Your project plan is ready";
      let body = "Review your project plan and its milestone payment terms.";
      if (event.type === "approval.requested") {
        const parsed = ApprovalRequestedPayload.safeParse(event.payload);
        if (!parsed.success) throw new Error("invalid_approval_notification");
        const [approval] = await db
          .select({
            approval: schema.approval,
            dealId: schema.proposedAction.dealId,
            status: schema.proposedAction.status,
          })
          .from(schema.approval)
          .innerJoin(
            schema.proposedAction,
            eq(schema.proposedAction.id, schema.approval.proposedActionId),
          )
          .where(eq(schema.approval.id, parsed.data.approvalId));
        if (
          !approval ||
          approval.dealId !== event.dealId ||
          approval.approval.proposedActionId !== parsed.data.proposedActionId
        )
          throw new Error("invalid_approval_notification");
        if (approval.approval.decision || approval.status !== "needs_approval") return;
        side = approval.approval.side;
        subject = "A project decision needs your approval";
        body = "Review the proposed action and approve or decline it in Tranche.";
      } else if (event.type === "milestone.funding_requested") {
        subject = "A milestone is ready to fund";
        body = "Review the milestone and continue to PayPal from your project portal.";
      }
      await enqueueNotification(db, {
        key: `event:${event.id}`,
        dealId: event.dealId,
        side,
        subject,
        body,
      });
    },
    50,
    true,
  );
  const actions = await db
    .select()
    .from(schema.proposedAction)
    .where(
      and(
        eq(schema.proposedAction.status, "approved"),
        inArray(schema.proposedAction.type, ["send_reminder", "escalate"]),
      ),
    )
    .orderBy(schema.proposedAction.createdAt)
    .limit(100);
  for (const action of actions) {
    const payload = action.payload;
    if (payload.type === "send_reminder") {
      await enqueueNotification(db, {
        key: `action:${action.id}`,
        actionId: action.id,
        dealId: action.dealId,
        side: payload.to,
        subject: payload.subject,
        body: payload.body,
      });
    } else if (payload.type === "escalate") {
      for (const side of ["agency", "client"] as const)
        await enqueueNotification(db, {
          key: `action:${action.id}:${side}`,
          actionId: action.id,
          dealId: action.dealId,
          side,
          subject: "Your project needs human review",
          body: payload.reason,
        });
    }
  }
}

export async function deliverNotifications(db: Db, send: SendEmail, limit = 20) {
  let sent = 0;
  for (let i = 0; i < limit; i++) {
    const job = await db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(jobs)
        .where(
          and(inArray(jobs.status, ["pending", "sending"]), lte(jobs.nextAttemptAt, sql`now()`)),
        )
        .orderBy(asc(jobs.nextAttemptAt))
        .limit(1)
        .for("update", { skipLocked: true });
      if (!row) return null;
      const [clock] = await tx.execute<{ now: string }>(sql`select now()`);
      if (!clock) throw new Error("notification_clock");
      const now = new Date(clock.now);
      const audience = await recipients(tx, row.dealId, row.side);
      const validRecipient = audience.some((r) => r.id === row.recipientId && r.email === row.to);
      if (
        !validRecipient ||
        row.linkExpiresAt <= now ||
        row.attempts >= 8 ||
        (row.dispatchedAt && now.getTime() - row.dispatchedAt.getTime() >= 23 * HOUR)
      ) {
        await tx
          .update(jobs)
          .set({ status: row.dispatchedAt ? "review" : "cancelled" })
          .where(eq(jobs.id, row.id));
        return { skipped: true } as const;
      }
      await tx
        .update(jobs)
        .set({
          status: "sending",
          attempts: row.attempts + 1,
          dispatchedAt: row.dispatchedAt ?? now,
          nextAttemptAt: new Date(now.getTime() + Math.min(HOUR, 60_000 * 2 ** row.attempts)),
        })
        .where(eq(jobs.id, row.id));
      return row;
    });
    if (!job) break;
    if ("skipped" in job) continue;
    try {
      // This exact payload and key must survive a crash after provider acceptance.
      const providerId = await send({
        to: job.to,
        subject: job.subject,
        body: job.body,
        key: `tranche:${job.id}`,
      });
      await db
        .update(jobs)
        .set({ status: "sent", providerId, sentAt: sql`now()` })
        .where(eq(jobs.id, job.id));
      sent++;
    } catch {
      // Retry the same payload within the provider's idempotency window.
    }
  }
  const actionIds = await db
    .selectDistinct({ id: jobs.actionId })
    .from(jobs)
    .where(and(eq(jobs.status, "sent"), sql`${jobs.actionId} is not null`));
  for (const { id } of actionIds) {
    if (!id) continue;
    await db.transaction(async (tx) => {
      const [action] = await tx
        .select()
        .from(schema.proposedAction)
        .where(eq(schema.proposedAction.id, id))
        .for("update");
      if (action?.status !== "approved") return;
      const deliveries = await tx.select().from(jobs).where(eq(jobs.actionId, id));
      if (!deliveries.length || deliveries.some((j) => j.status !== "sent")) return;
      if (
        action.type === "escalate" &&
        !["agency", "client"].every((side) => deliveries.some((j) => j.side === side))
      )
        return;
      await tx
        .update(schema.proposedAction)
        .set({ status: "executed", executedAt: sql`now()` })
        .where(eq(schema.proposedAction.id, id));
      await tx.insert(schema.event).values({
        type: "action.executed",
        dealId: action.dealId,
        payload: { proposedActionId: id, type: action.type },
      });
    });
  }
  return sent;
}

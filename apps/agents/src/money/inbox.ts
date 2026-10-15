import { InboxMessage } from "@tranche/contracts";
import { schema } from "@tranche/db";
import { and, asc, eq, isNull, lt, notInArray } from "drizzle-orm";
import type { Tx } from "./db";
import type { Deps } from "./deps";
import { errorMessage } from "./errors";
import { appendEvent } from "./events";
import { advanceMilestone, mustAdvance } from "./milestones";
import { enqueueOutbox } from "./outbox";
import { handlePayPalEvent } from "./paypal-events";

const MAX_ATTEMPTS = 10;

export async function processInbox(deps: Deps, limit = 20): Promise<number> {
  const seen: string[] = [];
  while (seen.length < limit) {
    const id = await deps.db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(schema.inbox)
        .where(
          and(
            isNull(schema.inbox.processedAt),
            lt(schema.inbox.attempts, MAX_ATTEMPTS),
            seen.length > 0 ? notInArray(schema.inbox.id, seen) : undefined,
          ),
        )
        .orderBy(asc(schema.inbox.receivedAt))
        .limit(1)
        .for("update", { skipLocked: true });
      if (!row) return null;
      // The savepoint discards everything a failing handler wrote, but keeps the attempt record.
      try {
        await tx.transaction((sp) => handleMessage(sp, deps, InboxMessage.parse(row.message)));
        await tx
          .update(schema.inbox)
          .set({ processedAt: deps.now(), attempts: row.attempts + 1, lastError: null })
          .where(eq(schema.inbox.id, row.id));
      } catch (err) {
        const attempts = row.attempts + 1;
        await tx
          .update(schema.inbox)
          .set({ attempts, lastError: errorMessage(err) })
          .where(eq(schema.inbox.id, row.id));
        if (attempts >= MAX_ATTEMPTS) {
          await appendEvent(tx, {
            type: "alert.raised",
            dealId: null,
            milestoneId: null,
            payload: { kind: "inbox_dead_letter", inboxId: row.id, error: errorMessage(err) },
          });
        }
      }
      return row.id;
    });
    if (!id) break;
    seen.push(id);
  }
  return seen.length;
}

export async function handleMessage(tx: Tx, deps: Deps, message: InboxMessage): Promise<void> {
  switch (message.type) {
    case "paypal.webhook":
      return handlePayPalEvent(tx, deps, message.eventType, message.resource);
    case "delivery.detected":
      return handleDelivery(tx, deps, message);
    case "timer.due":
      return handleTimerDue(tx, deps, message.scheduledActionId);
  }
}

async function handleDelivery(
  tx: Tx,
  deps: Deps,
  m: Extract<InboxMessage, { type: "delivery.detected" }>,
): Promise<void> {
  const now = deps.now();
  const [milestone] = await tx
    .select({ state: schema.milestone.state })
    .from(schema.milestone)
    .where(eq(schema.milestone.id, m.milestoneId));
  if (!milestone) throw new Error(`milestone ${m.milestoneId} not found`);
  const payload = {
    source: m.source,
    repo: m.repo,
    sha: m.sha,
    prNumber: m.prNumber,
    urls: m.urls,
  };
  if (milestone.state === "held") {
    await mustAdvance(tx, m.milestoneId, { type: "work_started" }, { now });
  }
  const delivered = await advanceMilestone(
    tx,
    m.milestoneId,
    { type: "delivered" },
    { now, payload },
  );
  if (!delivered.applied) return;
  await mustAdvance(tx, m.milestoneId, { type: "verification_started" }, { now, payload });
}

async function handleTimerDue(tx: Tx, deps: Deps, scheduledActionId: string): Promise<void> {
  const now = deps.now();
  const [timer] = await tx
    .select()
    .from(schema.scheduledAction)
    .where(eq(schema.scheduledAction.id, scheduledActionId));
  if (timer?.status !== "running") return;
  const ref = { scheduledActionId: timer.id };
  switch (timer.kind) {
    case "auto_release":
      await advanceMilestone(
        tx,
        timer.milestoneId,
        { type: "auto_release_due", at: now.toISOString() },
        { now },
      );
      break;
    case "fund":
      await enqueueOutbox(
        tx,
        {
          kind: "fund",
          request: { milestoneId: timer.milestoneId },
          requestId: `fund:${timer.id}`,
          ...ref,
        },
        now,
      );
      break;
    case "renew_hold":
      await enqueueOutbox(
        tx,
        {
          kind: "renew_hold",
          request: { milestoneId: timer.milestoneId },
          requestId: `renew:${timer.id}`,
          ...ref,
        },
        now,
      );
      break;
    case "remind": {
      const [m] = await tx
        .select()
        .from(schema.milestone)
        .where(eq(schema.milestone.id, timer.milestoneId));
      if (m?.state === "release_pending") {
        await tx
          .insert(schema.proposedAction)
          .values({
            dealId: m.dealId,
            agent: "system",
            side: "system",
            type: "send_reminder",
            payload: {
              type: "send_reminder",
              milestoneId: m.id,
              to: "client",
              subject: `"${m.title.slice(0, 150)}" is waiting for your review`,
              body: `The milestone "${m.title}" passed verification and is waiting for your release.`,
            },
            reasoning: "Scheduled reminder 24 hours after verification",
            idempotencyKey: `remind:${timer.id}`,
          })
          .onConflictDoNothing({ target: schema.proposedAction.idempotencyKey });
      }
      break;
    }
  }
  await tx
    .update(schema.scheduledAction)
    .set({ status: "done" })
    .where(eq(schema.scheduledAction.id, timer.id));
}

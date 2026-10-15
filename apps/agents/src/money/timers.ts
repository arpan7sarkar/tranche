import type { HoldMechanism, ScheduledActionKind } from "@tranche/contracts";
import { DELAYED_ALERT_DAY, fundingDueDate, RENEW_AT_DAY } from "@tranche/core";
import { schema } from "@tranche/db";
import { and, asc, eq, inArray, lte } from "drizzle-orm";
import type { Tx } from "./db";
import type { Deps } from "./deps";

const t = schema.scheduledAction;
const DAY_MS = 86_400_000;

export async function cancelTimers(
  tx: Tx,
  milestoneId: string,
  kinds?: ScheduledActionKind[],
): Promise<void> {
  await tx
    .update(t)
    .set({ status: "cancelled" })
    .where(
      and(
        eq(t.milestoneId, milestoneId),
        eq(t.status, "pending"),
        kinds ? inArray(t.kind, kinds) : undefined,
      ),
    );
}

export async function scheduleTimer(
  tx: Tx,
  timer: { milestoneId: string; kind: ScheduledActionKind; dueAt: Date },
): Promise<void> {
  await cancelTimers(tx, timer.milestoneId, [timer.kind]);
  await tx.insert(t).values(timer);
}

export function fundingDueAt(milestoneStart: string | null, now: Date): Date {
  const today = now.toISOString().slice(0, 10);
  const due = fundingDueDate(milestoneStart ?? today, today);
  return due === today ? now : new Date(`${due}T00:00:00Z`);
}

export async function planRenewal(
  tx: Tx,
  hold: { milestoneId: string; mechanism: HoldMechanism; originalAuthorizedAt: Date | null },
): Promise<void> {
  if (!hold.originalAuthorizedAt) return;
  const day = hold.mechanism === "authorization" ? RENEW_AT_DAY : DELAYED_ALERT_DAY;
  await scheduleTimer(tx, {
    milestoneId: hold.milestoneId,
    kind: "renew_hold",
    dueAt: new Date(hold.originalAuthorizedAt.getTime() + day * DAY_MS),
  });
}

export async function claimDueTimers(deps: Deps, limit = 50): Promise<number> {
  return deps.db.transaction(async (tx) => {
    const due = await tx
      .select()
      .from(t)
      .where(and(eq(t.status, "pending"), lte(t.dueAt, deps.now())))
      .orderBy(asc(t.dueAt))
      .limit(limit)
      .for("update", { skipLocked: true });
    for (const timer of due) {
      await tx
        .insert(schema.inbox)
        .values({
          source: "timer",
          sourceEventId: timer.id,
          message: { type: "timer.due", scheduledActionId: timer.id },
          nextAttemptAt: deps.now(),
        })
        .onConflictDoNothing();
      await tx
        .update(t)
        .set({ status: "running", attempts: timer.attempts + 1 })
        .where(eq(t.id, timer.id));
    }
    return due.length;
  });
}

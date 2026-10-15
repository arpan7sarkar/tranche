import type { MilestoneState } from "@tranche/contracts";
import { milestoneWindows, rescheduleTasks } from "@tranche/core";
import { schema } from "@tranche/db";
import { and, asc, eq, inArray } from "drizzle-orm";
import type { Tx } from "./db";
import { must } from "./errors";
import { appendEvent } from "./events";
import { fundingDueAt, scheduleTimer } from "./timers";

export class RescheduleError extends Error {}

const LOCKED: MilestoneState[] = ["released", "paid_out", "refunded", "cancelled"];

type Dated = { id: string; startDate: string; endDate: string };
export type RescheduleWarning = { milestoneId: string; message: string };

export async function applyReschedule(
  tx: Tx,
  dealId: string,
  moves: Array<{ taskId: string; start: string }>,
  reason: string,
  now: Date,
): Promise<{ tasks: Dated[]; milestones: Dated[]; warnings: RescheduleWarning[] }> {
  const [deal] = await tx
    .select({ id: schema.deal.id })
    .from(schema.deal)
    .where(eq(schema.deal.id, dealId))
    .for("update");
  if (!deal) throw new RescheduleError("deal not found");

  const tasks = await tx
    .select()
    .from(schema.task)
    .where(eq(schema.task.dealId, dealId))
    .orderBy(asc(schema.task.position));
  const milestones = await tx
    .select()
    .from(schema.milestone)
    .where(eq(schema.milestone.dealId, dealId))
    .orderBy(asc(schema.milestone.position));
  const deps =
    tasks.length === 0
      ? []
      : await tx
          .select()
          .from(schema.taskDependency)
          .where(
            inArray(
              schema.taskDependency.toTaskId,
              tasks.map((t) => t.id),
            ),
          );
  const taskById = new Map(tasks.map((t) => [t.id, t]));
  const msById = new Map(milestones.map((m) => [m.id, m]));
  const keyOf = (id: string) => must(taskById.get(id)).key;

  for (const m of moves) {
    if (!taskById.has(m.taskId)) {
      throw new RescheduleError(`task ${m.taskId} is not part of this deal`);
    }
  }

  const result = rescheduleTasks(
    tasks.map((t) => ({
      key: t.key,
      start: t.startDate,
      durationDays: t.durationDays,
      dependsOn: deps.filter((d) => d.toTaskId === t.id).map((d) => keyOf(d.fromTaskId)),
    })),
    moves.map((m) => ({ key: keyOf(m.taskId), start: m.start })),
  );
  if (!result.ok) throw new RescheduleError(result.reason);
  const schedule = result.schedule;

  const changes: Array<{ taskId: string; from: string; to: string }> = [];
  for (const t of tasks) {
    const w = must(schedule.get(t.key));
    if (w.start === t.startDate) continue;
    const state = must(msById.get(t.milestoneId)).state;
    if (LOCKED.includes(state)) {
      throw new RescheduleError(`"${t.title}" belongs to a milestone that is already ${state}`);
    }
    changes.push({ taskId: t.id, from: t.startDate, to: w.start });
  }
  for (const c of changes) {
    await tx.update(schema.task).set({ startDate: c.to }).where(eq(schema.task.id, c.taskId));
  }

  const windows = milestoneWindows(
    tasks.map((t) => ({ key: t.key, milestoneKey: t.milestoneId })),
    schedule,
  );
  const datedMilestones: Dated[] = [];
  const warnings: RescheduleWarning[] = [];
  for (const m of milestones) {
    const w = windows.get(m.id);
    if (!w) continue;
    datedMilestones.push({ id: m.id, startDate: w.start, endDate: w.end });
    if (w.start === m.startDate && w.end === m.endDate) continue;
    await tx
      .update(schema.milestone)
      .set({ startDate: w.start, endDate: w.end, updatedAt: now })
      .where(eq(schema.milestone.id, m.id));
    if (w.end !== m.endDate) {
      const [hold] = await tx
        .select({ expiresAt: schema.hold.expiresAt })
        .from(schema.hold)
        .where(and(eq(schema.hold.milestoneId, m.id), eq(schema.hold.status, "active")))
        .limit(1);
      const deadline = hold?.expiresAt.toISOString().slice(0, 10);
      if (deadline && w.end > deadline) {
        const message = `"${m.title}" now ends ${w.end}, after its hold expires on ${deadline}`;
        warnings.push({ milestoneId: m.id, message });
        await appendEvent(tx, {
          type: "alert.raised",
          dealId,
          milestoneId: m.id,
          payload: {
            kind: "reschedule_past_hold_deadline",
            title: m.title,
            endDate: w.end,
            holdExpiresAt: deadline,
          },
        });
      }
    }
    if (w.start === m.startDate || m.state !== "agreed") continue;
    const pending = await tx
      .select({ id: schema.scheduledAction.id })
      .from(schema.scheduledAction)
      .where(
        and(
          eq(schema.scheduledAction.milestoneId, m.id),
          eq(schema.scheduledAction.kind, "fund"),
          eq(schema.scheduledAction.status, "pending"),
        ),
      );
    if (pending.length > 0) {
      await scheduleTimer(tx, {
        milestoneId: m.id,
        kind: "fund",
        dueAt: fundingDueAt(w.start, now),
      });
    }
  }

  if (changes.length > 0) {
    await appendEvent(tx, {
      type: "task.rescheduled",
      dealId,
      milestoneId: null,
      payload: { reason, changes },
    });
  }

  return {
    tasks: tasks.map((t) => {
      const w = must(schedule.get(t.key));
      return { id: t.id, startDate: w.start, endDate: w.end };
    }),
    milestones: datedMilestones,
    warnings,
  };
}

import type { ScheduledActionKind } from "@tranche/contracts";
import { schema } from "@tranche/db";
import { and, eq, inArray } from "drizzle-orm";
import type { Tx } from "./db";

const t = schema.scheduledAction;

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

import type { Effect, MilestoneSnapshot } from "@tranche/core";
import { schema } from "@tranche/db";
import { eq } from "drizzle-orm";
import type { Tx } from "./db";
import { appendEvent } from "./events";
import { activeHold } from "./holds";
import { enqueueOutbox } from "./outbox";
import { cancelTimers, fundingDueAt, scheduleTimer } from "./timers";

const HOUR_MS = 3_600_000;
const REMIND_AFTER_HOURS = 24;

export type EffectContext = {
  milestone: { id: string; dealId: string; title: string; startDate: string | null };
  cause: string;
  snapshot: MilestoneSnapshot;
  now: Date;
  payload: Record<string, unknown>;
};

export async function applyEffects(tx: Tx, ctx: EffectContext, effects: Effect[]): Promise<void> {
  const { now } = ctx;
  const { id: milestoneId, dealId, title } = ctx.milestone;
  for (const effect of effects) {
    switch (effect.type) {
      case "emit": {
        const base = { ...ctx.payload, title, state: ctx.snapshot.state };
        await appendEvent(tx, {
          type: effect.event,
          dealId,
          milestoneId,
          payload: effect.event === "alert.raised" ? { ...base, kind: ctx.cause } : base,
        });
        break;
      }
      case "schedule_funding":
        await scheduleTimer(tx, {
          milestoneId,
          kind: "fund",
          dueAt: fundingDueAt(ctx.milestone.startDate, now),
        });
        break;
      case "schedule_auto_release": {
        const [d] = await tx
          .select({ clientPolicy: schema.deal.clientPolicy })
          .from(schema.deal)
          .where(eq(schema.deal.id, dealId));
        const hours = d?.clientPolicy?.autoReleaseAfterHours;
        if (hours) {
          await scheduleTimer(tx, {
            milestoneId,
            kind: "auto_release",
            dueAt: new Date(now.getTime() + hours * HOUR_MS),
          });
        }
        await scheduleTimer(tx, {
          milestoneId,
          kind: "remind",
          dueAt: new Date(now.getTime() + REMIND_AFTER_HOURS * HOUR_MS),
        });
        break;
      }
      case "cancel_timers":
        await cancelTimers(tx, milestoneId);
        break;
      case "release_funds": {
        const hold = await activeHold(tx, milestoneId);
        if (!hold) throw new Error(`milestone ${milestoneId} has no active hold to release`);
        await enqueueOutbox(
          tx,
          {
            kind: "release",
            request: { holdId: hold.id, amountMinor: effect.amountMinor },
            requestId: `release:${hold.id}`,
          },
          now,
        );
        break;
      }
      case "void_hold": {
        const hold = await activeHold(tx, milestoneId);
        if (hold) {
          await enqueueOutbox(
            tx,
            { kind: "void_hold", request: { holdId: hold.id }, requestId: `void:${hold.id}` },
            now,
          );
        }
        break;
      }
      case "pay_out":
        await enqueueOutbox(
          tx,
          { kind: "payout", request: { milestoneId }, requestId: `payout:${milestoneId}` },
          now,
        );
        break;
    }
  }
}

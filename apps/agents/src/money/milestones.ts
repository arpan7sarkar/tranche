import { type MilestoneEvent, type MilestoneSnapshot, transition } from "@tranche/core";
import { schema } from "@tranche/db";
import { and, eq } from "drizzle-orm";
import type { Tx } from "./db";
import { applyEffects } from "./effects";

export class StaleMilestoneError extends Error {}

type MilestoneRow = typeof schema.milestone.$inferSelect;

export function toSnapshot(m: MilestoneRow): MilestoneSnapshot {
  return {
    state: m.state,
    priceMinor: m.priceMinor,
    heldMinor: m.heldMinor,
    releasedMinor: m.releasedMinor,
    verifiedAt: m.verifiedAt?.toISOString() ?? null,
    releaseAuthorizedAt: m.releaseAuthorizedAt?.toISOString() ?? null,
  };
}

export type Advance =
  | { applied: true; snapshot: MilestoneSnapshot; dealId: string }
  | { applied: false; reason: string };

type AdvanceOpts = { now: Date; payload?: Record<string, unknown> };

export async function advanceMilestone(
  tx: Tx,
  milestoneId: string,
  event: MilestoneEvent,
  opts: AdvanceOpts,
): Promise<Advance> {
  const [m] = await tx.select().from(schema.milestone).where(eq(schema.milestone.id, milestoneId));
  if (!m) return { applied: false, reason: `milestone ${milestoneId} not found` };
  const result = transition(toSnapshot(m), event);
  if (!result.ok) return { applied: false, reason: result.reason };
  const n = result.next;
  // Optimistic lock: a concurrent writer bumps the version first and this update matches no row.
  const updated = await tx
    .update(schema.milestone)
    .set({
      state: n.state,
      heldMinor: n.heldMinor,
      releasedMinor: n.releasedMinor,
      verifiedAt: n.verifiedAt ? new Date(n.verifiedAt) : null,
      releaseAuthorizedAt: n.releaseAuthorizedAt ? new Date(n.releaseAuthorizedAt) : null,
      version: m.version + 1,
      updatedAt: opts.now,
    })
    .where(and(eq(schema.milestone.id, milestoneId), eq(schema.milestone.version, m.version)))
    .returning({ id: schema.milestone.id });
  if (updated.length === 0) {
    throw new StaleMilestoneError(`milestone ${milestoneId} changed concurrently`);
  }
  await applyEffects(
    tx,
    {
      milestone: m,
      cause: event.type,
      snapshot: n,
      now: opts.now,
      payload: opts.payload ?? {},
    },
    result.effects,
  );
  return { applied: true, snapshot: n, dealId: m.dealId };
}

export async function mustAdvance(
  tx: Tx,
  milestoneId: string,
  event: MilestoneEvent,
  opts: AdvanceOpts,
): Promise<void> {
  const r = await advanceMilestone(tx, milestoneId, event, opts);
  if (!r.applied) throw new Error(`${event.type}: ${r.reason}`);
}

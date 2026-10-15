import { type Db, schema } from "@tranche/db";
import { and, desc, eq, ne } from "drizzle-orm";
import type { Tx } from "./db";
import { PermanentError } from "./errors";
import { appendEvent } from "./events";
import { advanceMilestone } from "./milestones";
import { enqueueOutbox } from "./outbox";
import { completeReplacement } from "./replacement";
import { planRenewal } from "./timers";

export type HoldRow = typeof schema.hold.$inferSelect;

export async function getHold(exec: Db | Tx, holdId: string): Promise<HoldRow> {
  const [h] = await exec.select().from(schema.hold).where(eq(schema.hold.id, holdId));
  if (!h) throw new PermanentError(`hold ${holdId} not found`);
  return h;
}

export async function activeHold(tx: Tx, milestoneId: string): Promise<HoldRow | undefined> {
  const [h] = await tx
    .select()
    .from(schema.hold)
    .where(and(eq(schema.hold.milestoneId, milestoneId), eq(schema.hold.status, "active")))
    .orderBy(desc(schema.hold.createdAt))
    .limit(1);
  return h;
}

export async function holdWhere(
  tx: Tx,
  column: "paypalOrderId" | "paypalCaptureId" | "paypalAuthorizationId",
  value: string,
): Promise<HoldRow | undefined> {
  const [h] = await tx
    .select()
    .from(schema.hold)
    .where(eq(schema.hold[column], value))
    .orderBy(desc(schema.hold.createdAt))
    .limit(1);
  return h;
}

export async function activateHold(
  tx: Tx,
  hold: HoldRow,
  facts: {
    captureId?: string | null;
    authorizationId?: string | null;
    anchorAt: Date;
    expiresAt: Date;
    amountMinor: number;
  },
  now: Date,
): Promise<void> {
  if (hold.status !== "pending") return;
  await tx
    .update(schema.hold)
    .set({
      status: "active",
      paypalCaptureId: facts.captureId ?? hold.paypalCaptureId,
      paypalAuthorizationId: facts.authorizationId ?? hold.paypalAuthorizationId,
      originalAuthorizedAt: facts.anchorAt,
      expiresAt: facts.expiresAt,
    })
    .where(eq(schema.hold.id, hold.id));
  if (hold.replacesHoldId) {
    const [fresh] = await tx.select().from(schema.hold).where(eq(schema.hold.id, hold.id));
    if (fresh) await completeReplacement(tx, fresh, now);
    return;
  }
  const r = await advanceMilestone(
    tx,
    hold.milestoneId,
    { type: "hold_confirmed", amountMinor: facts.amountMinor },
    { now },
  );
  if (r.applied) {
    await planRenewal(tx, {
      milestoneId: hold.milestoneId,
      mechanism: hold.mechanism,
      originalAuthorizedAt: facts.anchorAt,
    });
    return;
  }
  const [m] = await tx
    .select({
      dealId: schema.milestone.dealId,
      title: schema.milestone.title,
      state: schema.milestone.state,
    })
    .from(schema.milestone)
    .where(eq(schema.milestone.id, hold.milestoneId));
  const [kept] = await tx
    .select({ id: schema.hold.id })
    .from(schema.hold)
    .where(
      and(
        eq(schema.hold.milestoneId, hold.milestoneId),
        eq(schema.hold.status, "active"),
        ne(schema.hold.id, hold.id),
      ),
    )
    .limit(1);
  // Funds that land after a cancellation, or a second confirmed order, go straight back.
  if (kept || m?.state === "cancelled") {
    await enqueueOutbox(
      tx,
      { kind: "void_hold", request: { holdId: hold.id }, requestId: `void:${hold.id}` },
      now,
    );
    if (!kept) return;
  }
  await appendEvent(tx, {
    type: "alert.raised",
    dealId: m?.dealId ?? null,
    milestoneId: hold.milestoneId,
    payload: {
      kind: kept ? "duplicate_funding" : "hold_mismatch",
      holdId: hold.id,
      ...(kept ? { keptHoldId: kept.id } : {}),
      reason: r.reason,
      title: m?.title,
    },
  });
}

// A refused transition is fine: the sync PayPal response and the webhook confirm the same release.
export async function confirmRelease(
  tx: Tx,
  hold: HoldRow,
  facts: { captureId: string | null; amountMinor: number },
  now: Date,
): Promise<void> {
  if (hold.status === "pending") {
    const [m] = await tx
      .select({ dealId: schema.milestone.dealId })
      .from(schema.milestone)
      .where(eq(schema.milestone.id, hold.milestoneId));
    await appendEvent(tx, {
      type: "alert.raised",
      dealId: m?.dealId ?? null,
      milestoneId: hold.milestoneId,
      payload: { kind: "release_before_hold", holdId: hold.id, captureId: facts.captureId },
    });
    return;
  }
  if (hold.status !== "released") {
    await tx
      .update(schema.hold)
      .set({ status: "released", paypalCaptureId: facts.captureId ?? hold.paypalCaptureId })
      .where(eq(schema.hold.id, hold.id));
  }
  await advanceMilestone(
    tx,
    hold.milestoneId,
    { type: "release_confirmed", amountMinor: facts.amountMinor },
    { now },
  );
}

import { type Db, schema } from "@tranche/db";
import { and, desc, eq } from "drizzle-orm";
import type { Tx } from "./db";
import { PermanentError } from "./errors";
import { appendEvent } from "./events";
import { advanceMilestone } from "./milestones";
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
  await planRenewal(tx, {
    milestoneId: hold.milestoneId,
    mechanism: hold.mechanism,
    originalAuthorizedAt: facts.anchorAt,
  });
  const r = await advanceMilestone(
    tx,
    hold.milestoneId,
    { type: "hold_confirmed", amountMinor: facts.amountMinor },
    { now },
  );
  if (!r.applied) {
    const [m] = await tx
      .select({ dealId: schema.milestone.dealId })
      .from(schema.milestone)
      .where(eq(schema.milestone.id, hold.milestoneId));
    await appendEvent(tx, {
      type: "alert.raised",
      dealId: m?.dealId ?? null,
      milestoneId: hold.milestoneId,
      payload: { kind: "hold_mismatch", holdId: hold.id, reason: r.reason },
    });
  }
}

// A refused transition is fine: the sync PayPal response and the webhook confirm the same release.
export async function confirmRelease(
  tx: Tx,
  hold: HoldRow,
  facts: { captureId: string | null; amountMinor: number },
  now: Date,
): Promise<void> {
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

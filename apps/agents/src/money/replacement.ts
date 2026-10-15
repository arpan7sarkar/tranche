import type { MilestoneState } from "@tranche/contracts";
import { type Db, schema } from "@tranche/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { Tx } from "./db";
import { PermanentError } from "./errors";
import { appendEvent } from "./events";
import { enqueueOutbox } from "./outbox";
import { planRenewal } from "./timers";

const RENEWABLE: MilestoneState[] = [
  "held",
  "in_progress",
  "delivered",
  "verifying",
  "changes_requested",
  "release_pending",
];

type HoldRow = typeof schema.hold.$inferSelect;
export type Gate = "ok" | "cancelled" | "inactive" | "in_flight";
export type MilestoneGate = {
  gate: Gate;
  dealId: string;
  title: string;
  state: MilestoneState;
};

// A renewal must not outlive its milestone, nor race a release or void already on its way to PayPal.
export async function gate(
  exec: Db | Tx,
  milestoneId: string,
  holdId: string,
  lock: boolean,
): Promise<MilestoneGate> {
  const query = exec
    .select({
      state: schema.milestone.state,
      dealId: schema.milestone.dealId,
      title: schema.milestone.title,
    })
    .from(schema.milestone)
    .where(eq(schema.milestone.id, milestoneId));
  const [m] = await (lock ? query.for("update") : query);
  if (!m) throw new PermanentError(`milestone ${milestoneId} not found`);
  const ref = { dealId: m.dealId, title: m.title, state: m.state };
  if (m.state === "cancelled") return { gate: "cancelled", ...ref };
  if (!RENEWABLE.includes(m.state)) return { gate: "inactive", ...ref };
  const inFlight = await exec
    .select({ id: schema.outbox.id })
    .from(schema.outbox)
    .where(
      and(
        inArray(schema.outbox.kind, ["release", "void_hold"]),
        inArray(schema.outbox.status, ["pending", "sent"]),
        sql`${schema.outbox.request}->>'holdId' = ${holdId}`,
      ),
    )
    .limit(1);
  return { gate: inFlight.length > 0 ? "in_flight" : "ok", ...ref };
}

export function enqueueVoid(tx: Tx, holdId: string, now: Date): Promise<void> {
  return enqueueOutbox(
    tx,
    { kind: "void_hold", request: { holdId }, requestId: `void:${holdId}` },
    now,
  );
}

// `fresh` is already active at PayPal and in our table. The old hold is voided only once the
// replacement is live, and the replacement is voided when the milestone no longer wants it.
export async function completeReplacement(tx: Tx, fresh: HoldRow, now: Date): Promise<void> {
  const [old] = fresh.replacesHoldId
    ? await tx.select().from(schema.hold).where(eq(schema.hold.id, fresh.replacesHoldId))
    : [];
  const g = await gate(tx, fresh.milestoneId, old?.id ?? fresh.id, true);
  const oldLive = old?.status === "active";
  if (g.gate === "cancelled" && oldLive) await enqueueVoid(tx, old.id, now);
  if (!old || !oldLive || g.gate !== "ok") {
    await enqueueVoid(tx, fresh.id, now);
    return;
  }
  await enqueueVoid(tx, old.id, now);
  await planRenewal(tx, fresh);
  await appendEvent(tx, {
    type: "milestone.held",
    dealId: g.dealId,
    milestoneId: fresh.milestoneId,
    payload: {
      title: g.title,
      state: g.state,
      renewed: true,
      holdId: fresh.id,
      replacedHoldId: old.id,
    },
  });
}

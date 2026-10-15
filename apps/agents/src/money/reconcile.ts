import type { HoldMechanism, HoldStatus } from "@tranche/contracts";
import { schema } from "@tranche/db";
import { PayPalError } from "@tranche/paypal";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import type { Deps, PayPal } from "./deps";
import { errorMessage } from "./errors";
import { appendEvent } from "./events";
import type { HoldRow } from "./holds";

const EXPECTED: Record<HoldMechanism, Partial<Record<HoldStatus, string[]>>> = {
  authorization: { active: ["CREATED", "PENDING"], released: ["COMPLETED", "PENDING"] },
  delayed_disbursement: { active: ["COMPLETED"], released: ["COMPLETED"] },
};
const REFUNDED = ["REFUNDED", "PARTIALLY_REFUNDED"];
// PayPal's buyer-protection window; after it a released capture no longer changes.
const SETTLED_AFTER_MS = 180 * 86_400_000;

async function remoteStatus(paypal: PayPal, h: HoldRow): Promise<string | null> {
  if (h.mechanism === "authorization" && h.status === "active") {
    return h.paypalAuthorizationId
      ? (await paypal.getAuthorization(h.paypalAuthorizationId)).status
      : null;
  }
  return h.paypalCaptureId ? (await paypal.getCapture(h.paypalCaptureId)).status : null;
}

// PayPal being down or rejecting our credentials says nothing about any single hold.
const unreachable = (err: unknown) =>
  !(err instanceof PayPalError) || err.retryable || err.status === 401;

export async function reconcile(deps: Deps): Promise<{ checked: number; mismatches: number }> {
  const now = deps.now();
  const rows = await deps.db
    .select({
      hold: schema.hold,
      dealId: schema.milestone.dealId,
      state: schema.milestone.state,
      updatedAt: schema.milestone.updatedAt,
    })
    .from(schema.hold)
    .innerJoin(schema.milestone, eq(schema.hold.milestoneId, schema.milestone.id))
    .where(inArray(schema.hold.status, ["active", "released"]));
  // A hold with outbox work in flight (release, void, renewal, refunding) is mid-change on purpose.
  const inFlight = await deps.db
    .select({ request: schema.outbox.request })
    .from(schema.outbox)
    .where(inArray(schema.outbox.status, ["pending", "sent", "called"]));
  const busy = new Set(
    inFlight.flatMap((r) => [r.request.holdId, r.request.milestoneId]).filter(Boolean),
  );

  let checked = 0;
  let mismatches = 0;
  const unreachableHolds: string[] = [];
  let lastError = "";
  for (const { hold, dealId, state, updatedAt } of rows) {
    if (busy.has(hold.id) || busy.has(hold.milestoneId)) continue;
    const settled = now.getTime() - updatedAt.getTime() > SETTLED_AFTER_MS;
    if (hold.status === "released" && (state === "refunded" || settled)) continue;
    checked++;
    let theirs: string | null;
    try {
      theirs = await remoteStatus(deps.paypal, hold);
    } catch (err) {
      if (unreachable(err)) {
        unreachableHolds.push(hold.id);
        lastError = errorMessage(err);
        continue;
      }
      theirs = `ERROR: ${errorMessage(err)}`;
    }
    if (theirs === null || EXPECTED[hold.mechanism][hold.status]?.includes(theirs)) continue;
    mismatches++;
    if (await alreadyAlerted(deps, hold.id, theirs)) continue;
    await deps.db.transaction((tx) =>
      appendEvent(tx, {
        type: "alert.raised",
        dealId,
        milestoneId: hold.milestoneId,
        payload: { kind: "reconciliation", holdId: hold.id, ours: hold.status, theirs },
      }),
    );
  }
  if (unreachableHolds.length > 0) {
    await deps.db.transaction((tx) =>
      appendEvent(tx, {
        type: "alert.raised",
        dealId: null,
        milestoneId: null,
        payload: {
          kind: "reconciliation_unavailable",
          holds: unreachableHolds.length,
          error: lastError,
        },
      }),
    );
  }
  return { checked, mismatches };
}

// One alert per hold and PayPal status; a refund the webhook already reported counts too.
async function alreadyAlerted(deps: Deps, holdId: string, theirs: string): Promise<boolean> {
  const p = schema.event.payload;
  const [e] = await deps.db
    .select({ id: schema.event.id })
    .from(schema.event)
    .where(
      and(
        eq(schema.event.type, "alert.raised"),
        sql`${p}->>'holdId' = ${holdId}`,
        or(
          sql`${p}->>'theirs' = ${theirs}`,
          REFUNDED.includes(theirs) ? sql`${p}->>'kind' = 'refund_received'` : undefined,
        ),
      ),
    )
    .limit(1);
  return Boolean(e);
}

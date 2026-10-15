import type { HoldMechanism, HoldStatus } from "@tranche/contracts";
import { schema } from "@tranche/db";
import { eq, inArray } from "drizzle-orm";
import type { Deps, PayPal } from "./deps";
import { errorMessage } from "./errors";
import { appendEvent } from "./events";
import type { HoldRow } from "./holds";

const EXPECTED: Record<HoldMechanism, Partial<Record<HoldStatus, string[]>>> = {
  authorization: { active: ["CREATED", "PENDING"], released: ["COMPLETED", "PENDING"] },
  delayed_disbursement: { active: ["COMPLETED"], released: ["COMPLETED"] },
};

async function remoteStatus(paypal: PayPal, h: HoldRow): Promise<string | null> {
  if (h.mechanism === "authorization" && h.status === "active") {
    return h.paypalAuthorizationId
      ? (await paypal.getAuthorization(h.paypalAuthorizationId)).status
      : null;
  }
  return h.paypalCaptureId ? (await paypal.getCapture(h.paypalCaptureId)).status : null;
}

// ponytail: alerts repeat every hour until the mismatch is fixed; dedupe per hold if it gets noisy.
export async function reconcile(deps: Deps): Promise<{ checked: number; mismatches: number }> {
  const rows = await deps.db
    .select({ hold: schema.hold, dealId: schema.milestone.dealId })
    .from(schema.hold)
    .innerJoin(schema.milestone, eq(schema.hold.milestoneId, schema.milestone.id))
    .where(inArray(schema.hold.status, ["active", "released"]));
  let mismatches = 0;
  for (const { hold, dealId } of rows) {
    let theirs: string | null;
    try {
      theirs = await remoteStatus(deps.paypal, hold);
    } catch (err) {
      theirs = `ERROR: ${errorMessage(err)}`;
    }
    if (theirs === null || EXPECTED[hold.mechanism][hold.status]?.includes(theirs)) continue;
    mismatches++;
    await deps.db.transaction((tx) =>
      appendEvent(tx, {
        type: "alert.raised",
        dealId,
        milestoneId: hold.milestoneId,
        payload: { kind: "reconciliation", holdId: hold.id, ours: hold.status, theirs },
      }),
    );
  }
  return { checked: rows.length, mismatches };
}

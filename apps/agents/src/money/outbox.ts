import { schema } from "@tranche/db";
import { PayPalError } from "@tranche/paypal";
import { and, asc, eq, inArray, lte } from "drizzle-orm";
import type { Tx } from "./db";
import type { Deps } from "./deps";
import { errorMessage, PermanentError } from "./errors";
import { appendEvent } from "./events";
import { type OutboxRow, outboxHandlers } from "./outbox-handlers";

export type OutboxKind =
  | "place_hold"
  | "release"
  | "void_hold"
  | "payout"
  | "dispute_evidence"
  | "fund"
  | "renew_hold";

const LEASE_MS = 5 * 60_000;
const MAX_ATTEMPTS = 8;

export async function enqueueOutbox(
  tx: Tx,
  o: {
    kind: OutboxKind;
    request: Record<string, unknown>;
    requestId: string;
    proposedActionId?: string;
    scheduledActionId?: string;
  },
  now: Date,
): Promise<void> {
  await tx
    .insert(schema.outbox)
    .values({ ...o, nextAttemptAt: now })
    .onConflictDoNothing({ target: schema.outbox.requestId });
}

export function backoffMs(attempt: number): number {
  return Math.min(60_000 * 2 ** (attempt - 1), 3_600_000);
}

// Claims due rows under a lease, calls PayPal outside any transaction, then settles in a new one.
// A crash between call and settle leaves the row `sent`; once the lease expires it is retried
// with the same PayPal-Request-Id, so PayPal replays the original result.
export async function executeOutbox(deps: Deps, limit = 10): Promise<number> {
  const now = deps.now();
  // Rows of a kind nobody handles yet stay pending instead of failing.
  const kinds = Object.keys(outboxHandlers);
  const claimed = await deps.db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(schema.outbox)
      .where(
        and(
          inArray(schema.outbox.status, ["pending", "sent"]),
          inArray(schema.outbox.kind, kinds),
          lte(schema.outbox.nextAttemptAt, now),
        ),
      )
      .orderBy(asc(schema.outbox.createdAt))
      .limit(limit)
      .for("update", { skipLocked: true });
    for (const r of rows) {
      await tx
        .update(schema.outbox)
        .set({
          status: "sent",
          attempts: r.attempts + 1,
          nextAttemptAt: new Date(now.getTime() + LEASE_MS),
        })
        .where(eq(schema.outbox.id, r.id));
    }
    return rows.map((r) => ({ ...r, attempts: r.attempts + 1 }));
  });
  for (const row of claimed) await runOne(deps, row);
  return claimed.length;
}

async function runOne(deps: Deps, row: OutboxRow): Promise<void> {
  const handler = outboxHandlers[row.kind as OutboxKind];
  try {
    if (!handler) throw new PermanentError(`no outbox handler for ${row.kind}`);
    const response = await handler.call(deps, row);
    await deps.db.transaction(async (tx) => {
      await handler.settle(tx, deps, row, response);
      await tx
        .update(schema.outbox)
        .set({ status: "succeeded", response, completedAt: deps.now(), lastError: null })
        .where(eq(schema.outbox.id, row.id));
    });
  } catch (err) {
    // If even recording fails, the lease expires and the row is retried with the same request id.
    await recordFailure(deps, row, err).catch((e: unknown) =>
      console.error(`outbox ${row.id}: recording failure failed`, e),
    );
  }
}

async function recordFailure(deps: Deps, row: OutboxRow, err: unknown): Promise<void> {
  const now = deps.now();
  const message = errorMessage(err);
  const permanent = err instanceof PermanentError || (err instanceof PayPalError && !err.retryable);
  await deps.db.transaction(async (tx) => {
    if (!permanent && row.attempts < MAX_ATTEMPTS) {
      await tx
        .update(schema.outbox)
        .set({
          status: "pending",
          lastError: message,
          nextAttemptAt: new Date(now.getTime() + backoffMs(row.attempts)),
        })
        .where(eq(schema.outbox.id, row.id));
      return;
    }
    await tx
      .update(schema.outbox)
      .set({ status: "failed", lastError: message, completedAt: now })
      .where(eq(schema.outbox.id, row.id));
    let dealId: string | null = null;
    if (row.proposedActionId) {
      const [a] = await tx
        .update(schema.proposedAction)
        .set({ status: "failed", decisionReason: message })
        .where(eq(schema.proposedAction.id, row.proposedActionId))
        .returning({ dealId: schema.proposedAction.dealId });
      dealId = a?.dealId ?? null;
    }
    await outboxHandlers[row.kind as OutboxKind]?.fail?.(tx, deps, row, err);
    await appendEvent(tx, {
      type: "alert.raised",
      dealId,
      milestoneId: null,
      payload: { kind: "outbox_failed", outboxId: row.id, outboxKind: row.kind, error: message },
    });
  });
}

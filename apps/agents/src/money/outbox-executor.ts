import { schema } from "@tranche/db";
import { PayPalError } from "@tranche/paypal";
import { and, asc, eq, inArray, lte, notInArray } from "drizzle-orm";
import type { Tx } from "./db";
import type { Deps } from "./deps";
import { errorMessage, PermanentError } from "./errors";
import { appendEvent } from "./events";
import type { OutboxHandler, OutboxKind, OutboxRow } from "./outbox";
import { outboxHandlers } from "./outbox-handlers";

const o = schema.outbox;
const LEASE_MS = 5 * 60_000;
// After this many attempts a row raises one alert, then keeps retrying hourly with the same
// request id; it is never compensated without a definite answer from PayPal.
const ALERT_AFTER_ATTEMPTS = 8;

export function backoffMs(attempt: number): number {
  return Math.min(60_000 * 2 ** (attempt - 1), 3_600_000);
}

// `attempts` is bumped on every claim, so it doubles as a fencing token: a worker whose lease
// expired and was re-claimed by another can no longer write the row.
const fence = (row: OutboxRow) => and(eq(o.id, row.id), eq(o.attempts, row.attempts));

class LeaseLost extends Error {}

// Rows are claimed one at a time, each under its own lease, so a slow batch cannot outlive it.
export async function executeOutbox(deps: Deps, limit = 10): Promise<number> {
  const seen: string[] = [];
  while (seen.length < limit) {
    const row = await claim(deps, seen);
    if (!row) break;
    seen.push(row.id);
    await runOne(deps, row).catch((err: unknown) =>
      // The lease expires and the row is retried with the same request id.
      console.error(`outbox ${row.id}: could not record the outcome`, err),
    );
  }
  return seen.length;
}

async function claim(deps: Deps, seen: string[]): Promise<OutboxRow | null> {
  const now = deps.now();
  // Rows of a kind nobody handles yet stay pending instead of failing.
  const kinds = Object.keys(outboxHandlers);
  return deps.db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(o)
      .where(
        and(
          inArray(o.status, ["pending", "sent", "called"]),
          inArray(o.kind, kinds),
          lte(o.nextAttemptAt, now),
          seen.length > 0 ? notInArray(o.id, seen) : undefined,
        ),
      )
      .orderBy(asc(o.createdAt))
      .limit(1)
      .for("update", { skipLocked: true });
    if (!row) return null;
    const [claimed] = await tx
      .update(o)
      .set({
        status: row.status === "called" ? "called" : "sent",
        attempts: row.attempts + 1,
        nextAttemptAt: new Date(now.getTime() + LEASE_MS),
      })
      .where(eq(o.id, row.id))
      .returning();
    return claimed ?? null;
  });
}

type Verdict = "retry" | "fail" | "recover";

// Only a definite, non-retryable answer fails a row. Timeouts, network errors and 5xx may have
// moved money, so they are replayed with the same PayPal-Request-Id instead.
function classify(err: unknown, handler: OutboxHandler): Verdict {
  if (err instanceof PermanentError) return "fail";
  if (!(err instanceof PayPalError)) return "retry";
  if (err.issue && handler.alreadyDone?.includes(err.issue)) return "recover";
  // 401 after the transport's one token refresh: rotated credentials or a PayPal auth incident.
  if (err.retryable || err.status === 401 || err.issue === "DUPLICATE_REQUEST_ID") return "retry";
  return "fail";
}

async function runOne(deps: Deps, row: OutboxRow): Promise<void> {
  const handler = outboxHandlers[row.kind as OutboxKind];
  if (!handler) return;
  let response = row.status === "called" ? row.response : null;
  if (!response) {
    try {
      response = await handler.call(deps, row);
    } catch (err) {
      const verdict = classify(err, handler);
      // A replay outside PayPal's idempotency window says "already done"; read the result back.
      if (verdict === "recover") {
        response = (await handler.recover?.(deps, row).catch(() => null)) ?? null;
      }
      if (!response) return verdict === "fail" ? failRow(deps, row, err) : retryRow(deps, row, err);
    }
    // Kept before settling, so a settle that fails is retried without calling PayPal again.
    const kept = await deps.db
      .update(o)
      .set({ status: "called", response })
      .where(fence(row))
      .returning({ id: o.id });
    if (kept.length === 0) return;
  }
  const result = response;
  try {
    await deps.db.transaction(async (tx) => {
      const done = await tx
        .update(o)
        .set({ status: "succeeded", completedAt: deps.now(), lastError: null })
        .where(fence(row))
        .returning({ id: o.id });
      if (done.length === 0) throw new LeaseLost();
      await handler.settle(tx, deps, row, result);
    });
  } catch (err) {
    if (!(err instanceof LeaseLost)) await retryRow(deps, row, err, true);
  }
}

async function retryRow(deps: Deps, row: OutboxRow, err: unknown, called = false): Promise<void> {
  const now = deps.now();
  await deps.db.transaction(async (tx) => {
    const kept = await tx
      .update(o)
      .set({
        status: called || row.status === "called" ? "called" : "pending",
        lastError: errorMessage(err),
        nextAttemptAt: new Date(now.getTime() + backoffMs(row.attempts)),
      })
      .where(fence(row))
      .returning({ id: o.id });
    if (kept.length === 0 || row.attempts !== ALERT_AFTER_ATTEMPTS) return;
    await alert(tx, row, "outbox_stuck", err);
  });
}

async function failRow(deps: Deps, row: OutboxRow, err: unknown): Promise<void> {
  const message = errorMessage(err);
  await deps.db.transaction(async (tx) => {
    const failed = await tx
      .update(o)
      .set({ status: "failed", lastError: message, completedAt: deps.now() })
      .where(fence(row))
      .returning({ id: o.id });
    if (failed.length === 0) return;
    if (row.proposedActionId) {
      await tx
        .update(schema.proposedAction)
        .set({ status: "failed", decisionReason: message })
        .where(eq(schema.proposedAction.id, row.proposedActionId));
    }
    await outboxHandlers[row.kind as OutboxKind]?.fail?.(tx, deps, row, err);
    await alert(tx, row, "outbox_failed", err);
  });
}

async function alert(tx: Tx, row: OutboxRow, kind: string, err: unknown): Promise<void> {
  const [a] = row.proposedActionId
    ? await tx
        .select({ dealId: schema.proposedAction.dealId })
        .from(schema.proposedAction)
        .where(eq(schema.proposedAction.id, row.proposedActionId))
    : [];
  await appendEvent(tx, {
    type: "alert.raised",
    dealId: a?.dealId ?? null,
    milestoneId: null,
    payload: {
      kind,
      outboxId: row.id,
      outboxKind: row.kind,
      attempts: row.attempts,
      error: errorMessage(err),
    },
  });
}

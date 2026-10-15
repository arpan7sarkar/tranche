import { schema } from "@tranche/db";
import type { Tx } from "./db";
import type { Deps } from "./deps";
import { PermanentError } from "./errors";

export type OutboxKind =
  | "place_hold"
  | "release"
  | "void_hold"
  | "payout"
  | "dispute_evidence"
  | "fund"
  | "renew_hold";

export type OutboxRow = typeof schema.outbox.$inferSelect;
export type OutboxHandler = {
  call: (deps: Deps, row: OutboxRow) => Promise<Record<string, unknown>>;
  settle: (tx: Tx, deps: Deps, row: OutboxRow, response: Record<string, unknown>) => Promise<void>;
  // Runs when PayPal definitely refused, in the same transaction that marks the row failed.
  fail?: (tx: Tx, deps: Deps, row: OutboxRow, err: unknown) => Promise<void>;
  // PayPal issues meaning the work is already done; `recover` reads the result back instead.
  alreadyDone?: readonly string[];
  recover?: (deps: Deps, row: OutboxRow) => Promise<Record<string, unknown> | null>;
};

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

export function requestedMilestoneId(row: OutboxRow): string {
  const id = row.request.milestoneId;
  if (typeof id !== "string") throw new PermanentError(`outbox ${row.id} has no milestoneId`);
  return id;
}

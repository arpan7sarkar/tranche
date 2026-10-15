import { schema } from "@tranche/db";
import type { Tx } from "./db";

export type OutboxKind =
  | "place_hold"
  | "release"
  | "void_hold"
  | "payout"
  | "dispute_evidence"
  | "fund"
  | "renew_hold";

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

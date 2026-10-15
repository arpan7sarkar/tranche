import type { schema } from "@tranche/db";
import type { Tx } from "./db";
import type { Deps } from "./deps";
import { PermanentError } from "./errors";

// Same shape as the executor's handler contract; swap for its export once outbox-handlers.ts lands.
export type OutboxRow = typeof schema.outbox.$inferSelect;
export type OutboxHandler = {
  call: (deps: Deps, row: OutboxRow) => Promise<Record<string, unknown>>;
  settle: (tx: Tx, deps: Deps, row: OutboxRow, response: Record<string, unknown>) => Promise<void>;
};

export function requestedMilestoneId(row: OutboxRow): string {
  const id = row.request.milestoneId;
  if (typeof id !== "string") throw new PermanentError(`outbox ${row.id} has no milestoneId`);
  return id;
}

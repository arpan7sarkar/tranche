import type { DomainEventType } from "@tranche/contracts";
import { type Db, schema } from "@tranche/db";
import { and, asc, eq, inArray, notExists, sql } from "drizzle-orm";
import { ModelDisabledError } from "./models";
export type EventRow = typeof schema.event.$inferSelect;

export async function consumeEvents(
  db: Db,
  consumer: string,
  types: readonly DomainEventType[],
  handler: (event: EventRow) => Promise<void>,
  batchSize = 50,
  independent = false,
): Promise<number> {
  if (
    !consumer ||
    consumer.length > 150 ||
    !Number.isInteger(batchSize) ||
    batchSize < 1 ||
    batchSize > 200
  )
    throw new Error("invalid_consumer");
  if (!types.length) return 0;
  await db.insert(schema.eventCursor).values({ consumer }).onConflictDoNothing();
  return db.transaction(async (tx) => {
    const [cursor] = await tx
      .select()
      .from(schema.eventCursor)
      .where(eq(schema.eventCursor.consumer, consumer))
      .for("update", { skipLocked: true });
    if (!cursor) return 0;
    // Receipts, not a high-water ID, preserve events whose transactions commit out of order.
    const rows = await tx
      .select()
      .from(schema.event)
      .where(
        and(
          inArray(schema.event.type, [...types]),
          notExists(
            tx
              .select({ id: schema.agentEventReceipt.eventId })
              .from(schema.agentEventReceipt)
              .where(
                and(
                  eq(schema.agentEventReceipt.consumer, consumer),
                  eq(schema.agentEventReceipt.eventId, schema.event.id),
                ),
              ),
          ),
        ),
      )
      .orderBy(
        ...(independent
          ? [sql`${schema.event.id} <= ${cursor.lastEventId}`, asc(schema.event.id)]
          : [asc(schema.event.id)]),
      )
      .limit(batchSize);
    let done = 0;
    for (const event of rows) {
      if (independent)
        await tx
          .update(schema.eventCursor)
          .set({ lastEventId: event.id })
          .where(eq(schema.eventCursor.consumer, consumer));
      try {
        await handler(event);
      } catch (error) {
        if (!(error instanceof ModelDisabledError))
          console.error(
            JSON.stringify({ msg: "agent.consumer_failed", consumer, eventId: event.id }),
          );
        if (independent) continue;
        break;
      }
      await tx.insert(schema.agentEventReceipt).values({ consumer, eventId: event.id });
      await tx
        .update(schema.eventCursor)
        .set({ lastEventId: sql`greatest(${schema.eventCursor.lastEventId}, ${event.id})` })
        .where(eq(schema.eventCursor.consumer, consumer));
      done++;
    }
    return done;
  });
}
